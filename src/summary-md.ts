import type { Trace } from "./types.js";
import { formatDuration } from "./util.js";
import { summaryLine } from "./render/timeline.js";

/** Concise Markdown for GitHub Actions step summary (shorter than full --markdown). */
export function renderGithubSummary(trace: Trace): string {
  const source = trace.source ?? "stdin";
  const lines: string[] = [];
  lines.push(`### agent-trace · ${escape(source)}`);
  lines.push("");
  lines.push(`**${summaryLine(trace)}**`);
  lines.push("");
  lines.push(`Format: \`${trace.format}\` · steps ${trace.stats.steps} · tools ${trace.stats.toolCalls} · failures ${trace.stats.failures}`);
  if (trace.stats.durationMs != null) {
    lines.push(`Duration: ${formatDuration(trace.stats.durationMs)}`);
  }
  lines.push("");

  const tools = trace.steps.filter((s) => s.kind === "tool_call");
  if (tools.length) {
    lines.push("| # | Tool | Duration |");
    lines.push("| ---: | --- | ---: |");
    for (const step of tools.slice(0, 40)) {
      const name = step.name ? `\`${escape(step.name)}\`` : "—";
      const dur = step.durationMs != null ? formatDuration(step.durationMs) : "";
      lines.push(`| ${step.index} | ${name} | ${dur} |`);
    }
    if (tools.length > 40) {
      lines.push(`| … | _${tools.length - 40} more_ | |`);
    }
    lines.push("");
  }

  if (trace.stats.failures > 0) {
    lines.push("**Failures**");
    lines.push("");
    for (const step of trace.steps.filter((s) => s.kind === "error" || s.error)) {
      const label = step.name ? `\`${escape(step.name)}\`` : `step ${step.index}`;
      const detail = escape((step.error ?? step.content ?? "").replace(/\s+/g, " ").slice(0, 120));
      lines.push(`- ${label}: ${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function escape(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
