/**
 * video:denylist-lint. Reads privacy-denylist.txt at run time and reports
 * the lines that would not work as the privacy check matches them: each
 * line, trimmed, is one entry matched whole.
 *
 * Prints line numbers and reasons only: never a line's contents, never what
 * it matched. The file is not opened anywhere else in this script.
 *
 *   node scripts/denylist-lint.ts [path]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FACTS } from "../src/facts.ts";

export type Finding = { line: number; reason: string };

export const MIN_LENGTH = 4;
const CAST = [FACTS.cast.eddy.name, FACTS.cast.maya.name, FACTS.cast.daniel.name].map((n) => n.toLowerCase());

/** Findings per line, and how many blank lines there are. Never returns a line's text. */
export function lint(text: string): { findings: Finding[]; blank: number } {
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  let blank = 0;
  const lines = text.split(/\r?\n/);
  // A final newline leaves an empty last piece; it is not a blank line.
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((raw, i) => {
    const line = i + 1;
    const entry = raw.trim();
    if (entry === "") {
      blank++;
      return;
    }
    if (entry.startsWith("#")) return;
    const lower = entry.toLowerCase();
    if (entry.length < MIN_LENGTH) findings.push({ line, reason: `shorter than ${MIN_LENGTH} characters, so it matches inside ordinary words` });
    if (/^[^:]+:\s+\S/.test(entry)) findings.push({ line, reason: 'looks like a label ("something: value"); only the whole line is matched, so the value alone never is' });
    if (entry.includes(";")) findings.push({ line, reason: "holds a ';', so it reads as a description or a list; put one entry per line" });
    if (CAST.includes(lower)) findings.push({ line, reason: "equals a cast name, so every caption and screen showing that name fails" });
    const first = seen.get(lower);
    if (first !== undefined) findings.push({ line, reason: `duplicate of line ${first}` });
    else seen.set(lower, line);
  });
  return { findings, blank };
}

const isMain = process.argv[1] && import.meta.filename === process.argv[1];
if (isMain) {
  const file = process.argv[2] ?? join(import.meta.dirname, "..", "privacy-denylist.txt");
  if (!existsSync(file)) {
    console.log("SKIP denylist lint: no privacy-denylist.txt on this PC");
    process.exit(0);
  }
  const { findings, blank } = lint(readFileSync(file, "utf8"));
  for (const f of findings) console.log(`line ${f.line}: ${f.reason}`);
  console.log(`${blank} blank line${blank === 1 ? "" : "s"}`);
  console.log(findings.length ? `FAIL denylist lint: ${findings.length} finding${findings.length === 1 ? "" : "s"}` : "PASS denylist lint");
  process.exit(findings.length ? 1 : 0);
}
