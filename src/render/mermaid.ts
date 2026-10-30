import type { Trace, TraceStep } from "../types.js";
import { collapseWs, compactJson, formatDuration } from "../util.js";
import { summaryLine } from "./timeline.js";

export interface MermaidOptions {
  maxContent?: number;
}

/**
 * Render a Mermaid flowchart of the agent run.
 * Paste into a ```mermaid fence in GitHub / Notion / Obsidian.
 */
export function renderMermaid(trace: Trace, options: MermaidOptions = {}): string {
  const max = options.maxContent ?? 48;
  const source = trace.source ?? "stdin";
  const lines: string[] = [];

  lines.push(`%% agent-trace · ${source}`);
  lines.push(`%% ${summaryLine(trace)}`);
  lines.push("flowchart TD");

  if (!trace.steps.length) {
    lines.push('  empty["(no steps)"]');
    return lines.join("\n") + "\n";
  }

  for (const step of trace.steps) {
    const id = `S${step.index}`;
    const label = nodeLabel(step, max);
    lines.push(`  ${nodeShape(step, id, label)}`);
    if (step.kind === "error" || step.error) {
      lines.push(`  style ${id} fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d`);
    } else if (step.kind === "tool_call") {
      lines.push(`  style ${id} fill:#fef9c3,stroke:#a16207,color:#713f12`);
    } else if (step.kind === "assistant") {
      lines.push(`  style ${id} fill:#e0e7ff,stroke:#4338ca,color:#312e81`);
    }
  }

  for (let i = 0; i < trace.steps.length - 1; i += 1) {
    const a = trace.steps[i];
    const b = trace.steps[i + 1];
    if (!a || !b) continue;
    const edge = a.kind === "error" || a.error ? "-.->|fail|" : "-->";
    lines.push(`  S${a.index} ${edge} S${b.index}`);
  }

  return lines.join("\n") + "\n";
}

function nodeLabel(step: TraceStep, max: number): string {
  const kind = kindShort(step);
  const name = step.name ? ` ${step.name}` : "";
  const dur = step.durationMs != null ? ` (${formatDuration(step.durationMs)})` : "";
  const detail = clip(detailText(step), max);
  const body = detail ? `<br/>${escapeMermaid(detail)}` : "";
  return escapeMermaid(`${step.index}. ${kind}${name}${dur}`) + body;
}

function nodeShape(step: TraceStep, id: string, label: string): string {
  if (step.kind === "error" || step.error) return `${id}{"${label}"}`;
  if (step.kind === "tool_call" || step.kind === "tool_result") return `${id}["${label}"]`;
  if (step.kind === "user" || step.kind === "system") return `${id}(["${label}"])`;
  return `${id}("${label}")`;
}

function kindShort(step: TraceStep): string {
  switch (step.kind) {
    case "tool_call":
      return "tool";
    case "tool_result":
      return "result";
    case "other":
      return "event";
    default:
      return step.kind;
  }
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

function escapeMermaid(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\r?\n/g, " ");
}
