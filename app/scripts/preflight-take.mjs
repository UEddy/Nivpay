// Checks, read only, that the chain is in the starting state a recording take
// expects. From app/:
//
//   node scripts/preflight-take.mjs <take-name> [--config <path>]
//   node scripts/preflight-take.mjs --list
//
// Reads addresses and pot numbers from scripts/preflight.config.json (not
// committed; copy preflight.config.example.json). Exit code 0 when every check
// passes, 1 when any fails, 2 when the take or the config is wrong. See
// docs/SEEDING.md.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, failed, findTake, formatReport, liveDeps, parseArgs, parseConfig, runTake, TAKES } from "./preflight.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const configPath = args.configPath !== undefined ? resolve(args.configPath) : resolve(here, "preflight.config.json");
const name = args.name;

const list = () => TAKES.map((t) => `  ${t.name.padEnd(12)} ${t.title}`).join("\n");

if (args.list || !name) {
  console.log(`Takes, in the order of docs/DEMO.md:\n${list()}`);
  process.exit(args.list ? 0 : 2);
}

const take = findTake(name);
if (!take) {
  console.error(`No take called "${name}". Takes:\n${list()}`);
  process.exit(2);
}

let config;
try {
  config = parseConfig(readFileSync(configPath, "utf8"));
} catch (error) {
  if (error instanceof ConfigError) console.error(`Config: ${error.message}`);
  else console.error(`Can't read ${configPath}: copy scripts/preflight.config.example.json to scripts/preflight.config.json and fill it in (docs/SEEDING.md, "The cast").`);
  process.exit(2);
}

try {
  const report = await runTake(take, config, liveDeps(config));
  console.log(formatReport(report));
  process.exit(failed(report).length ? 1 : 0);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Config: ${error.message}`);
    process.exit(2);
  }
  console.error(`The chain could not be read: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  process.exit(1);
}
