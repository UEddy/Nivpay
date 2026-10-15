import type { Deployment } from "./config.ts";

/**
 * Reporting a pot that named you (Home, "New pots that name you"). The report
 * goes to /api/report, which writes one log line and stores nothing; the
 * server logs are read by hand. Only the deployment, the pot number and the
 * reason are sent: nothing about who is reporting.
 *
 * app/api/report/index.ts has a copy of REASONS; app/src/api-tests/report.test.ts
 * keeps the two the same.
 */
export const REASONS = ["scam", "impersonation", "spam", "not-for-me"] as const;
export type Reason = (typeof REASONS)[number];

export type ReportBody = { deployment: Deployment; potId: string; reason: Reason };

/** Sends the report. Throws when it didn't reach the server or the server refused it. */
export async function sendReport(body: ReportBody, post: typeof fetch = fetch): Promise<void> {
  const res = await post("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deployment: body.deployment, potId: body.potId, reason: body.reason }),
  });
  if (!res.ok) throw new Error(`report refused: ${res.status}`);
}
