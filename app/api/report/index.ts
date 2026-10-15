// POST /api/report: someone reports a pot that named them. Vercel function,
// Web API signature.
//
// It takes { deployment, potId, reason }, with the reason from REASONS only,
// writes one log line and stores nothing. Reports reach the server logs and
// nowhere else, and are read by hand (README, "Protecting people from bad
// actors"). Nothing about the person reporting is sent or logged: no account,
// no name, no IP. A report changes nothing about the pot.
//
// Abuse limits, in the style of /api/fund:
//  * Same origin only, by the Origin header. That stops other websites, not
//    scripts.
//  * Request bodies over MAX_BODY_BYTES are refused unread.
//  * At most REPORTS_PER_MINUTE reports a minute on one server instance, from
//    everyone together, so a script can't flood the log. Counted in memory
//    only; each instance counts its own.
//
// REASONS is a copy of app/src/lib/report.ts: this folder builds with
// NodeNext and doesn't import from src. app/src/api-tests/report.test.ts
// fails if the two ever differ.

export const REASONS = ["scam", "impersonation", "spam", "not-for-me"] as const;
export type Reason = (typeof REASONS)[number];
export const DEPLOYMENTS = ["ausd", "testusd"] as const;
/** A request is three short fields in JSON: far under this. */
export const MAX_BODY_BYTES = 512;
export const REPORTS_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

export type ReportEnv = {
  /** Optional, comma separated. For local testing, for example http://localhost:5173. */
  ALLOWED_ORIGINS?: string;
};

export type Logger = (entry: Record<string, string>) => void;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** As in /api/fund. */
export function originAllowed(request: Request, env: ReportEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return origin === own || extra.includes(origin);
}

let recent: number[] = [];
/** Clears this instance's count. For tests. */
export function forgetRecentReports(): void {
  recent = [];
}

export async function handleReport(
  request: Request,
  env: ReportEnv,
  log: Logger = (e) => console.log(JSON.stringify(e)),
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "use POST" });
  if (!originAllowed(request, env)) return json(403, { error: "same origin only" });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "request too large" });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: "request too large" });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "send JSON with a deployment, potId and reason" });
  }
  const { deployment, potId, reason } = (body ?? {}) as Record<string, unknown>;
  if (typeof deployment !== "string" || !(DEPLOYMENTS as readonly string[]).includes(deployment)) return json(400, { error: "unknown deployment" });
  if (typeof potId !== "string" || !/^\d{1,20}$/.test(potId)) return json(400, { error: "not a pot number" });
  if (typeof reason !== "string" || !(REASONS as readonly string[]).includes(reason)) return json(400, { error: "unknown reason" });

  const t = now();
  recent = recent.filter((at) => t - at < MINUTE_MS);
  if (recent.length >= REPORTS_PER_MINUTE) return json(429, { error: "too many reports, try again in a minute" });
  recent.push(t);

  log({ event: "report", deployment, potId, reason });
  return json(200, { ok: true });
}

export function POST(request: Request): Promise<Response> {
  return handleReport(request, process.env as ReportEnv);
}

export function GET(): Response {
  return json(405, { error: "use POST" });
}
