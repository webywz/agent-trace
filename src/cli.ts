#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { helpText, parseArgs, UsageError } from "./args.js";
import { createPalette, shouldColor } from "./color.js";
import { parseTrace } from "./parse/index.js";
import { readInput, wrapIoError } from "./read-input.js";
import { spicyNarrative } from "./render/spicy.js";
import { renderTimeline, summaryLine } from "./render/timeline.js";

const VERSION = readVersion();

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    printErr(error);
    return exitCodeFor(error);
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
    ({ text, source } = args.demo ? await readDemo() : await readInput(args.file));
  } catch (error) {
    printErr(error);
    return exitCodeFor(error);
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
    return failOnErrorCode(args.failOnError, trace.stats.failures);
  }

  if (args.stats) {
    process.stdout.write(`${summaryLine(trace)}\n`);
    for (const warning of trace.warnings) {
      process.stderr.write(`agent-trace: warn: ${warning}\n`);
    }
  } else {
    const timeline = renderTimeline(trace, {
      color: args.color,
      ascii: args.ascii,
      width: args.width,
      maxContent: args.maxContent,
    });
    process.stdout.write(timeline);
  }

  if (args.spicy) {
    const color = createPalette(shouldColor(args.color));
    const narrative = await spicyNarrative(trace);
    process.stdout.write(`\n${color.bold("spicy")}  ${narrative}\n`);
  }

  return failOnErrorCode(args.failOnError, trace.stats.failures);
}

function failOnErrorCode(enabled: boolean, failures: number): number {
  if (!enabled || failures <= 0) return 0;
  const noun = failures === 1 ? "failure" : "failures";
  process.stderr.write(`agent-trace: ${failures} ${noun} (--fail-on-error)\n`);
  return 1;
}

function printErr(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agent-trace: ${message}\n`);
  if (error instanceof UsageError) {
    process.stderr.write("try 'agent-trace --help'\n");
  }
}

function exitCodeFor(error: unknown): number {
  return error instanceof UsageError ? 2 : 1;
}

async function readDemo(): Promise<{ text: string; source: string }> {
  const file = join(packageRoot(), "examples", "run.jsonl");
  try {
    const text = await readFile(file, "utf8");
    return { text, source: "examples/run.jsonl" };
  } catch (error) {
    const wrapped = wrapIoError(error, file);
    if (wrapped.message.startsWith("file not found")) {
      throw new Error("bundled demo missing (expected examples/run.jsonl in the package)");
    }
    throw wrapped;
  }
}

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
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
    const raw = readFileSync(join(packageRoot(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.1.1";
  } catch {
    return "0.1.1";
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
