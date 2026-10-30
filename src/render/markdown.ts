import type { Trace, TraceStep } from "../types.js";
import { collapseWs, compactJson, formatDuration } from "../util.js";
import { summaryLine } from "./timeline.js";

export interface MarkdownOptions {
  maxContent?: number;
}

/** Render a GitHub-friendly Markdown report of the trace. */
export function renderMarkdown(trace: Trace, options: MarkdownOptions = {}): string {
  const max = options.maxContent ?? 240;
  const source = trace.source ?? "stdin";
  const lines: string[] = [];

  lines.push(`# agent-trace · ${source}`);
  lines.push("");
  lines.push(`**${summaryLine(trace)}**`);
  lines.push("");
  lines.push(`Format: \`${trace.format}\``);
  lines.push("");

  if (trace.stats.tools?.length) {
    lines.push("## Tools");
    lines.push("");
    lines.push("| Tool | Calls | Failures | Duration |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const tool of trace.stats.tools) {
      const dur = tool.durationMs != null ? formatDuration(tool.durationMs) : "—";
      lines.push(`| \`${escapeCell(tool.name)}\` | ${tool.calls} | ${tool.failures} | ${dur} |`);
    }
    lines.push("");
  }

  lines.push("## Timeline");
  lines.push("");
  lines.push("| # | Kind | Name | Detail | Duration |");
  lines.push("| ---: | --- | --- | --- | ---: |");

  if (!trace.steps.length) {
    lines.push("| — | — | — | _(no steps)_ | — |");
  } else {
    for (const step of trace.steps) {
      const name = step.name ? `\`${escapeCell(step.name)}\`` : "";
      const detail = escapeCell(clip(detailText(step), max));
      const dur = step.durationMs != null ? formatDuration(step.durationMs) : "";
      lines.push(`| ${step.index} | ${kindLabel(step)} | ${name} | ${detail} | ${dur} |`);
    }
  }

  if (trace.warnings.length) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const warning of trace.warnings) {
      lines.push(`- ${escapeCell(warning)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function kindLabel(step: TraceStep): string {
  const labels: Record<string, string> = {
    user: "user",
    system: "system",
    thought: "thought",
    assistant: "assistant",
    tool_call: "tool",
    tool_result: "result",
    error: "error",
    other: "event",
  };
  return labels[step.kind] ?? step.kind;
}

function detailText(step: TraceStep): string {
  if (step.kind === "tool_call") {
    return step.args != null ? compactJson(step.args) : collapseWs(step.content ?? "");
  }
  if (step.kind === "tool_result") {
    return step.content ?? (step.result != null ? compactJson(step.result) : "");
  }
  if (step.kind === "error") {
    return step.error ?? step.content ?? "";
  }
  return collapseWs(step.content ?? step.error ?? "");
}

function clip(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
