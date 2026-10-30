#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { helpText, parseArgs, UsageError } from "./args.js";
import { createPalette, shouldColor } from "./color.js";
import { compareMarkdown, compareTraces } from "./compare.js";
import { filterTrace } from "./filter.js";
import { appendGithubSummary, resolveGithubSummaryPath } from "./github-summary.js";
import { parseTrace } from "./parse/index.js";
import { readInput, wrapIoError } from "./read-input.js";
import { redactTrace } from "./redact.js";
import { renderHtml } from "./render/html.js";
import { renderMarkdown } from "./render/markdown.js";
import { renderMermaid } from "./render/mermaid.js";
import { spicyNarrative } from "./render/spicy.js";
import { renderTimeline, statsReport } from "./render/timeline.js";
import { renderGithubSummary } from "./summary-md.js";
import { formatSarif } from "./sarif.js";
import { renderTap } from "./tap.js";
import { formatDuration } from "./util.js";

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
    trace = filterTrace(trace, {
      only: args.only,
      tools: args.tools,
      failures: args.failures,
    });
    if (args.redact) {
      trace = redactTrace(trace);
    }
  } catch (error) {
    printErr(error);
    return 1;
  }

  let compareResult: ReturnType<typeof compareTraces> | undefined;
  if (args.compare) {
    try {
      const otherRaw = await readFile(args.compare, "utf8").catch((error) => {
        throw wrapIoError(error, args.compare!);
      });
      let other = parseTrace(otherRaw, { format: args.format, source: args.compare });
      other = filterTrace(other, {
        only: args.only,
        tools: args.tools,
        failures: args.failures,
      });
      if (args.redact) {
        other = redactTrace(other);
      }
      compareResult = compareTraces(trace, other);
      process.stdout.write(compareResult.report);
    } catch (error) {
      printErr(error);
      return 1;
    }
  }

  let tapExit: number | undefined;

  // Normal outputs skipped when --compare is the focus, unless an export flag is also set.
  if (!args.compare) {
    if (args.json) {
      const payload = {
        format: trace.format,
        source: trace.source,
        stats: trace.stats,
        warnings: trace.warnings,
        steps: trace.steps,
        ...(args.spicy
          ? { spicy: await spicyNarrative(trace, { localOnly: !args.spicyLlm }) }
          : {}),
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else if (args.markdown) {
      process.stdout.write(renderMarkdown(trace, { maxContent: args.maxContent }));
    } else if (args.html) {
      const html = renderHtml(trace, { maxContent: args.maxContent });
      if (typeof args.html === "string") {
        writeFileSync(args.html, html, "utf8");
      } else {
        process.stdout.write(html.endsWith("\n") ? html : `${html}\n`);
      }
    } else if (args.mermaid) {
      process.stdout.write(renderMermaid(trace, { maxContent: args.maxContent }));
    } else if (args.tap) {
      const tap = renderTap(trace);
      process.stdout.write(tap.text);
      tapExit = tap.exitCode;
      if (args.stats) {
        process.stderr.write(`${statsReport(trace)}\n`);
      }
    } else if (args.stats) {
      process.stdout.write(`${statsReport(trace)}\n`);
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

    if (args.spicy && !args.tap) {
      const color = createPalette(shouldColor(args.color));
      const narrative = await spicyNarrative(trace, { localOnly: !args.spicyLlm });
      process.stdout.write(`\n${color.bold("spicy")}  ${narrative}\n`);
    } else if (args.spicy && args.tap) {
      // Keep TAP stdout clean; spicy goes to stderr.
      const narrative = await spicyNarrative(trace, { localOnly: !args.spicyLlm });
      process.stderr.write(`spicy  ${narrative}\n`);
    }
  } else if (args.json || args.markdown || args.html || args.mermaid || args.stats || args.tap) {
    // Allow exporting the primary alongside compare
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ format: trace.format, source: trace.source, stats: trace.stats, steps: trace.steps }, null, 2)}\n`,
      );
    } else if (args.markdown) {
      process.stdout.write(renderMarkdown(trace, { maxContent: args.maxContent }));
    } else if (args.html) {
      const html = renderHtml(trace, { maxContent: args.maxContent });
      if (typeof args.html === "string") {
        writeFileSync(args.html, html, "utf8");
      } else {
        process.stdout.write(html.endsWith("\n") ? html : `${html}\n`);
      }
    } else if (args.mermaid) {
      process.stdout.write(renderMermaid(trace, { maxContent: args.maxContent }));
    } else if (args.tap) {
      const tap = renderTap(trace);
      process.stdout.write(tap.text);
      tapExit = tap.exitCode;
      if (args.stats) {
        process.stderr.write(`${statsReport(trace)}\n`);
      }
    } else if (args.stats) {
      process.stdout.write(`${statsReport(trace)}\n`);
    }
  }

  const outSummary = resolveSummaryTarget(args.githubSummary);
  if (outSummary) {
    try {
      const md = compareResult ? compareMarkdown(compareResult) : renderGithubSummary(trace);
      appendGithubSummary(outSummary, md);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`agent-trace: could not write github summary: ${message}\n`);
    }
  }

  if (args.sarif) {
    try {
      writeFileSync(args.sarif, formatSarif(trace, VERSION), "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`agent-trace: could not write sarif: ${message}\n`);
      return 1;
    }
  }

  if (compareResult) {
    return compareResult.equivalent ? 0 : 1;
  }

  const overDuration = maxDurationCode(args.maxDurationMs, trace.stats.durationMs);
  if (overDuration !== 0) return overDuration;

  const overTokens = maxTokensCode(args.maxTokens, trace.stats.tokensIn, trace.stats.tokensOut);
  if (overTokens !== 0) return overTokens;

  if (tapExit != null && tapExit !== 0) return tapExit;

  return failOnErrorCode(args.failOnError, trace.stats.failures);
}

function maxDurationCode(budget: number | undefined, actual: number | undefined): number {
  if (budget == null) return 0;
  if (actual == null) {
    process.stderr.write(
      `agent-trace: warn: --max-duration ${formatDuration(budget)} set but run has no measurable duration\n`,
    );
    return 0;
  }
  if (actual <= budget) return 0;
  process.stderr.write(
    `agent-trace: duration ${formatDuration(actual)} exceeds --max-duration ${formatDuration(budget)}\n`,
  );
  return 1;
}

function maxTokensCode(
  budget: number | undefined,
  tokensIn: number | undefined,
  tokensOut: number | undefined,
): number {
  if (budget == null) return 0;
  const hasIn = tokensIn != null;
  const hasOut = tokensOut != null;
  if (!hasIn && !hasOut) {
    process.stderr.write(
      `agent-trace: warn: --max-tokens ${budget} set but run has no measurable tokens\n`,
    );
    return 0;
  }
  const actual = (tokensIn ?? 0) + (tokensOut ?? 0);
  if (actual <= budget) return 0;
  process.stderr.write(
    `agent-trace: tokens ${actual} (in ${tokensIn ?? 0} + out ${tokensOut ?? 0}) exceeds --max-tokens ${budget}\n`,
  );
  return 1;
}

function resolveSummaryTarget(flag: string | true | undefined): string | undefined {
  // Flag passed → always write (env, explicit path, or local default).
  // Flag omitted → write only when GITHUB_STEP_SUMMARY is set (Actions).
  if (flag === undefined) {
    return resolveGithubSummaryPath(undefined);
  }
  return resolveGithubSummaryPath(flag);
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
    return parsed.version ?? "0.2.2";
  } catch {
    return "0.2.2";
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
