import type { Trace, TraceStep } from "../types.js";
import { collapseWs, compactJson, formatDuration } from "../util.js";
import { summaryLine } from "./timeline.js";

export interface HtmlOptions {
  maxContent?: number;
}

/** Escape text for safe insertion into HTML text/attr contexts. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function kindClass(kind: string): string {
  return `kind-${kind.replace(/_/g, "-")}`;
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

function prettyBlock(step: TraceStep, max: number): string | undefined {
  const parts: string[] = [];
  if (step.args != null) {
    try {
      parts.push(`args:\n${JSON.stringify(step.args, null, 2)}`);
    } catch {
      parts.push(`args:\n${String(step.args)}`);
    }
  }
  if (step.result != null) {
    try {
      parts.push(`result:\n${JSON.stringify(step.result, null, 2)}`);
    } catch {
      parts.push(`result:\n${String(step.result)}`);
    }
  }
  if (step.content && (step.args == null || step.kind !== "tool_call")) {
    parts.push(step.content);
  }
  if (step.error) {
    parts.push(step.error);
  }
  if (!parts.length) return undefined;
  let text = parts.join("\n\n");
  if (text.length > max * 8) {
    text = `${text.slice(0, max * 8)}…`;
  }
  return text;
}

function clip(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Self-contained dark HTML timeline (inline CSS + JS, no CDN).
 * Safe for untrusted traces: all user/content fields are HTML-escaped.
 */
export function renderHtml(trace: Trace, options: HtmlOptions = {}): string {
  const max = options.maxContent ?? 240;
  const source = escapeHtml(trace.source ?? "stdin");
  const summary = escapeHtml(summaryLine(trace));
  const format = escapeHtml(trace.format);
  const failed = trace.stats.failures > 0;

  const toolRows =
    trace.stats.tools
      ?.map((tool) => {
        const dur = tool.durationMs != null ? formatDuration(tool.durationMs) : "—";
        const failClass = tool.failures > 0 ? ' class="fail"' : "";
        return `<tr${failClass}><td><code>${escapeHtml(tool.name)}</code></td><td>${tool.calls}</td><td>${tool.failures}</td><td>${escapeHtml(dur)}</td></tr>`;
      })
      .join("\n") ?? "";

  const stepsHtml = trace.steps.length
    ? trace.steps
        .map((step) => {
          const label = kindLabel(step);
          const name = step.name ? escapeHtml(step.name) : "";
          const preview = escapeHtml(clip(detailText(step), max));
          const dur =
            step.durationMs != null ? escapeHtml(formatDuration(step.durationMs)) : "";
          const fail = step.kind === "error" || Boolean(step.error);
          const block = prettyBlock(step, max);
          const details = block
            ? `<details><summary>expand</summary><pre>${escapeHtml(block)}</pre></details>`
            : "";
          return `\
<article class="step ${kindClass(step.kind)}${fail ? " is-fail" : ""}">
  <header>
    <span class="idx">${step.index}</span>
    <span class="kind">${escapeHtml(label)}</span>
    ${name ? `<span class="name">${name}</span>` : ""}
    ${dur ? `<span class="dur">${dur}</span>` : ""}
  </header>
  ${preview ? `<p class="preview">${preview}</p>` : ""}
  ${details}
</article>`;
        })
        .join("\n")
    : `<p class="empty">no steps</p>`;

  const warnings = trace.warnings.length
    ? `<section class="warnings"><h2>Warnings</h2><ul>${trace.warnings
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join("")}</ul></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>agent-trace · ${source}</title>
<style>
:root {
  --bg: #0a0a0a;
  --panel: #111111;
  --border: #222222;
  --text: #eeeeee;
  --muted: #888888;
  --fail: #ff5555;
  --user: #6cb6ff;
  --system: #9a9a9a;
  --thought: #c9a0ff;
  --assistant: #7ee787;
  --tool: #79c0ff;
  --result: #56d4dd;
  --error: #ff7b72;
  --event: #d2a8ff;
  --font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--bg); color: var(--text);
  font: 13px/1.45 var(--font);
}
body { padding: 24px 20px 48px; max-width: 920px; margin: 0 auto; }
header.top {
  border: 1px solid var(--border); background: var(--panel);
  padding: 16px 18px; margin-bottom: 16px;
}
header.top h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
header.top .meta { color: var(--muted); font-size: 12px; }
header.top .summary { margin-top: 10px; font-size: 13px; }
header.top.is-fail .summary { color: var(--fail); }
.stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px; margin: 16px 0;
}
.stat {
  border: 1px solid var(--border); background: var(--panel);
  padding: 10px 12px;
}
.stat .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.stat .value { margin-top: 4px; font-size: 16px; }
table.tools {
  width: 100%; border-collapse: collapse; margin: 0 0 18px;
  border: 1px solid var(--border); background: var(--panel);
}
table.tools th, table.tools td {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border);
}
table.tools th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; }
table.tools tr.fail td { color: var(--fail); }
table.tools td:nth-child(2),
table.tools td:nth-child(3),
table.tools td:nth-child(4) { text-align: right; }
h2 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 18px 0 10px; font-weight: 600; }
.timeline { display: flex; flex-direction: column; gap: 8px; }
.step {
  border: 1px solid var(--border); background: var(--panel); padding: 10px 12px;
}
.step.is-fail { border-color: #5a1d1d; background: #140a0a; }
.step header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.step .idx { color: var(--muted); min-width: 2ch; }
.step .kind {
  display: inline-block; min-width: 5.5em;
  padding: 1px 6px; border: 1px solid var(--border);
  text-transform: lowercase;
}
.kind-user .kind { color: var(--user); border-color: #1e3a5f; }
.kind-system .kind { color: var(--system); }
.kind-thought .kind { color: var(--thought); border-color: #3a2a55; }
.kind-assistant .kind { color: var(--assistant); border-color: #1e3d28; }
.kind-tool-call .kind { color: var(--tool); border-color: #1e3a5f; }
.kind-tool-result .kind { color: var(--result); border-color: #1a3d40; }
.kind-error .kind { color: var(--error); border-color: #5a1d1d; }
.kind-other .kind { color: var(--event); }
.step .name { color: var(--text); }
.step .dur { margin-left: auto; color: var(--muted); }
.step .preview { margin: 8px 0 0; color: #cccccc; word-break: break-word; }
.step details { margin-top: 8px; }
.step summary { cursor: pointer; color: var(--muted); user-select: none; }
.step pre {
  margin: 8px 0 0; padding: 10px; overflow: auto;
  background: #050505; border: 1px solid var(--border);
  white-space: pre-wrap; word-break: break-word; color: #d8d8d8;
}
.empty, .warnings { color: var(--muted); }
.warnings ul { padding-left: 18px; }
.toolbar { margin: 0 0 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.toolbar button {
  background: var(--panel); color: var(--text); border: 1px solid var(--border);
  padding: 6px 10px; font: inherit; cursor: pointer;
}
.toolbar button:hover { border-color: #444; }
footer {
  margin-top: 28px; color: var(--muted); font-size: 11px;
  border-top: 1px solid var(--border); padding-top: 12px;
}
code { font: inherit; }
@media (max-width: 640px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
</head>
<body>
<header class="top${failed ? " is-fail" : ""}">
  <h1>agent-trace · ${source}</h1>
  <div class="meta">format: ${format}</div>
  <div class="summary">${summary}</div>
</header>
<section class="stats" aria-label="stats">
  <div class="stat"><div class="label">steps</div><div class="value">${trace.stats.steps}</div></div>
  <div class="stat"><div class="label">tool calls</div><div class="value">${trace.stats.toolCalls}</div></div>
  <div class="stat"><div class="label">failures</div><div class="value">${trace.stats.failures}</div></div>
  <div class="stat"><div class="label">duration</div><div class="value">${escapeHtml(
    trace.stats.durationMs != null ? formatDuration(trace.stats.durationMs) : "—",
  )}</div></div>
</section>
${
  toolRows
    ? `<h2>Tools</h2>
<table class="tools">
<thead><tr><th>Tool</th><th>Calls</th><th>Failures</th><th>Duration</th></tr></thead>
<tbody>
${toolRows}
</tbody>
</table>`
    : ""
}
<div class="toolbar">
  <button type="button" id="expand-all">Expand all</button>
  <button type="button" id="collapse-all">Collapse all</button>
</div>
<h2>Timeline</h2>
<div class="timeline">
${stepsHtml}
</div>
${warnings}
<footer>Generated by agent-trace · self-contained · works offline (file://)</footer>
<script>
(function () {
  var expand = document.getElementById("expand-all");
  var collapse = document.getElementById("collapse-all");
  function setAll(open) {
    document.querySelectorAll("details").forEach(function (d) { d.open = open; });
  }
  if (expand) expand.addEventListener("click", function () { setAll(true); });
  if (collapse) collapse.addEventListener("click", function () { setAll(false); });
})();
</script>
</body>
</html>
`;
}
