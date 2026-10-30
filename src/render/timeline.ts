import { createPalette, shouldColor, type Palette } from "../color.js";
import type { RenderOptions, StepKind, Trace, TraceStep } from "../types.js";
import { collapseWs, compactJson, formatDuration, timestampMs, truncate } from "../util.js";

const KIND_COL = 10;

export function renderTimeline(trace: Trace, options: RenderOptions = {}): string {
  const color = createPalette(shouldColor(options.color));
  const ascii = Boolean(options.ascii);
  const width = Math.max(48, options.width ?? process.stdout.columns ?? 88);
  const maxContent = options.maxContent ?? Math.min(160, Math.max(64, width - 18));
  const glyphs = ascii
    ? { pipe: "|", bar: "-", ellipsis: "...", dot: "*" }
    : { pipe: "│", bar: "─", ellipsis: "…", dot: "·" };

  const lines: string[] = [];
  const source = trace.source ?? "stdin";
  const header = `${color.bold("agent-trace")}  ${glyphs.dot}  ${source}`;
  lines.push(header);
  lines.push(color.dim(metaLine(trace, glyphs.dot)));
  lines.push(color.dim(glyphs.bar.repeat(Math.min(width, 72))));

  if (!trace.steps.length) {
    lines.push(color.dim("  (no steps)"));
  } else {
    const t0 = firstTime(trace.steps);
    const showTimes = t0 != null || trace.steps.some((step) => step.durationMs != null);
    for (let i = 0; i < trace.steps.length; i += 1) {
      const step = trace.steps[i];
      if (!step) continue;
      const next = trace.steps[i + 1];
      lines.push(renderStep(step, { color, ascii, glyphs, maxContent, t0, next, showTimes }));
      if (i !== trace.steps.length - 1) {
        lines.push(color.dim(`     ${glyphs.pipe}`));
      }
    }
  }

  lines.push(color.dim(glyphs.bar.repeat(Math.min(width, 72))));
  lines.push(`  ${color.bold(summaryLine(trace, glyphs.dot))}`);

  if (trace.warnings.length) {
    lines.push("");
    for (const warning of trace.warnings.slice(0, 8)) {
      lines.push(color.dim(`  warn  ${warning}`));
    }
    if (trace.warnings.length > 8) {
      lines.push(color.dim(`  warn  +${trace.warnings.length - 8} more`));
    }
  }

  return lines.join("\n") + "\n";
}

function metaLine(trace: Trace, dot: string): string {
  const bits = [
    trace.format,
    plural(trace.stats.steps, "step"),
    plural(trace.stats.toolCalls, "tool call"),
    plural(trace.stats.failures, "failure"),
  ];
  if (trace.stats.durationMs != null) bits.push(formatDuration(trace.stats.durationMs));
  return bits.join(`  ${dot}  `);
}

export function summaryLine(trace: Trace, dot = "·"): string {
  const { stats } = trace;
  const bits = [
    plural(stats.steps, "step"),
    plural(stats.toolCalls, "tool call"),
    plural(stats.failures, "failure"),
  ];
  if (stats.tokensIn != null || stats.tokensOut != null) {
    bits.push(`~${fmtNum(stats.tokensIn ?? 0)} in / ${fmtNum(stats.tokensOut ?? 0)} out`);
  }
  if (stats.durationMs != null) bits.push(formatDuration(stats.durationMs));
  return bits.join(` ${dot} `);
}

/** One-line summary plus optional per-tool breakdown (for --stats). */
export function statsReport(trace: Trace, dot = "·"): string {
  const lines = [summaryLine(trace, dot)];
  const tools = trace.stats.tools;
  if (!tools?.length) return lines.join("\n");
  const parts = tools.slice(0, 12).map((tool) => {
    const fail = tool.failures ? ` ${tool.failures} fail` : "";
    const dur = tool.durationMs != null ? ` ${formatDuration(tool.durationMs)}` : "";
    return `${tool.name}×${tool.calls}${dur}${fail}`;
  });
  const more = tools.length > 12 ? ` +${tools.length - 12} more` : "";
  lines.push(`  tools: ${parts.join(", ")}${more}`);
  return lines.join("\n");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function renderStep(
  step: TraceStep,
  ctx: {
    color: Palette;
    ascii: boolean;
    glyphs: { pipe: string; bar: string; ellipsis: string; dot: string };
    maxContent: number;
    t0?: number;
    next?: TraceStep;
    showTimes: boolean;
  },
): string {
  const { color, glyphs, maxContent, t0, showTimes } = ctx;
  const num = String(step.index).padStart(2, " ");
  const kind = paintKind(step.kind, padKind(step.kind), color);
  const when = showTimes ? color.dim(relTime(step, t0).padStart(7)) : "";
  const dur = stepDuration(step, ctx.next);
  const durText = showTimes ? color.dim((dur != null ? formatDuration(dur) : "").padStart(6)) : "";
  const showName =
    Boolean(step.name) &&
    step.kind !== "user" &&
    step.kind !== "assistant" &&
    step.kind !== "thought" &&
    step.kind !== "system";
  const label = showName ? color.bold(step.name as string) : "";
  const timeCols = showTimes ? `${when} ${durText}` : "";

  const head = ` ${num}  ${kind}${timeCols ? ` ${timeCols}` : ""}${label ? `  ${label}` : ""}`.replace(
    / +$/g,
    "",
  );

  const detail = detailLine(step, maxContent, glyphs.ellipsis);
  if (!detail) return head;
  const painted = step.kind === "error" || step.error ? color.red(detail) : color.dim(detail);
  return `${head}\n     ${color.dim(glyphs.pipe)}  ${painted}`;
}

function detailLine(step: TraceStep, max: number, ellipsis: string): string {
  if (step.kind === "tool_call") {
    const args = step.args != null ? compactJson(step.args) : collapseWs(step.content ?? "");
    return clip(args, max, ellipsis);
  }
  if (step.kind === "tool_result") {
    const body = step.content ?? (step.result != null ? compactJson(step.result) : "");
    return clip(body, max, ellipsis);
  }
  if (step.kind === "error") {
    return clip(step.error ?? step.content ?? "", max, ellipsis);
  }
  return clip(collapseWs(step.content ?? step.error ?? ""), max, ellipsis);
}

function clip(text: string, max: number, ellipsis: string): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const keep = Math.max(0, max - ellipsis.length);
  return text.slice(0, keep) + ellipsis;
}

function padKind(kind: StepKind): string {
  const labels: Record<StepKind, string> = {
    user: "user",
    system: "system",
    thought: "thought",
    assistant: "assistant",
    tool_call: "tool",
    tool_result: "result",
    error: "error",
    other: "event",
  };
  return labels[kind].padEnd(KIND_COL);
}

function paintKind(kind: StepKind, label: string, color: Palette): string {
  switch (kind) {
    case "user":
      return color.cyan(label);
    case "system":
      return color.dim(label);
    case "thought":
      return color.magenta(label);
    case "assistant":
      return color.bold(label);
    case "tool_call":
      return color.yellow(label);
    case "tool_result":
      return color.green(label);
    case "error":
      return color.red(color.bold(label));
    default:
      return color.dim(label);
  }
}

function firstTime(steps: TraceStep[]): number | undefined {
  for (const step of steps) {
    const ms = timestampMs(step.ts);
    if (ms != null) return ms;
  }
  return undefined;
}

function relTime(step: TraceStep, t0?: number): string {
  const ms = timestampMs(step.ts);
  if (ms == null || t0 == null) return "";
  return "+" + formatDuration(ms - t0);
}

function stepDuration(step: TraceStep, next?: TraceStep): number | undefined {
  if (step.durationMs != null) return step.durationMs;
  const a = timestampMs(step.ts);
  const b = timestampMs(next?.ts);
  if (a == null || b == null) return undefined;
  const delta = b - a;
  return delta >= 0 ? delta : undefined;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
