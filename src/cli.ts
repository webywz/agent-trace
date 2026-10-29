#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { helpText, parseArgs } from "./args.js";
import { createPalette, shouldColor } from "./color.js";
import { parseTrace } from "./parse/index.js";
import { readInput } from "./read-input.js";
import { spicyNarrative } from "./render/spicy.js";
import { renderTimeline } from "./render/timeline.js";

const VERSION = readVersion();

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    printErr(error);
    return 1;
  }

  if (args.help) {
    process.stdout.write(helpText(VERSION));
    return 0;
  }
  if (args.version) {
    process.stdout.write(`agent-trace ${VERSION}\n`);
    return 0;
  }

  let text: string;
  let source: string;
  try {
    ({ text, source } = await readInput(args.file));
  } catch (error) {
    printErr(error);
    return 1;
  }

  let trace;
  try {
    trace = parseTrace(text, { format: args.format, source });
  } catch (error) {
    printErr(error);
    return 1;
  }

  if (args.json) {
    const payload = {
      format: trace.format,
      source: trace.source,
      stats: trace.stats,
      warnings: trace.warnings,
      steps: trace.steps,
      ...(args.spicy ? { spicy: await spicyNarrative(trace) } : {}),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  const timeline = renderTimeline(trace, {
    color: args.color,
    ascii: args.ascii,
    width: args.width,
    maxContent: args.maxContent,
  });
  process.stdout.write(timeline);

  if (args.spicy) {
    const color = createPalette(shouldColor(args.color));
    const narrative = await spicyNarrative(trace);
    process.stdout.write(`\n${color.bold("spicy")}  ${narrative}\n`);
  }

  return 0;
}

function printErr(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agent-trace: ${message}\n`);
}

function isCliEntry(argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(argvPath) === self || realpathSync(argvPath) === realpathSync(self);
  } catch {
    return /(cli\.(js|ts)|agent-trace)$/.test(argvPath);
  }
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

if (isCliEntry(process.argv[1])) {
  main(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      printErr(error);
      process.exitCode = 1;
    },
  );
}

export { main };
