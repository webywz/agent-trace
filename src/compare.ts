import type { Trace } from "./types.js";
import { formatDuration } from "./util.js";

export interface CompareResult {
  equivalent: boolean;
  primarySource: string;
  otherSource: string;
  primarySteps: number;
  otherSteps: number;
  primaryFailures: number;
  otherFailures: number;
  primaryDurationMs?: number;
  otherDurationMs?: number;
  primaryTools: string[];
  otherTools: string[];
  /** Tool names present in other but not at the same index sequence (LCS-based). */
  added: string[];
  /** Tool names present in primary but not at the same index sequence. */
  removed: string[];
  /** Positions where both have a tool but names differ (after aligning). */
  changed: Array<{ index: number; from: string; to: string }>;
  report: string;
}

/** Ordered tool-call names from a trace (empty string if unnamed). */
export function toolSequence(trace: Trace): string[] {
  return trace.steps
    .filter((step) => step.kind === "tool_call")
    .map((step) => step.name ?? "");
}

function lcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0);
      }
    }
  }
  return dp;
}

/** Diff two ordered tool-name sequences (primary = baseline/old, other = new). */
export function diffToolSequences(
  primary: string[],
  other: string[],
): { added: string[]; removed: string[]; changed: Array<{ index: number; from: string; to: string }> } {
  // Fast path: identical
  if (primary.length === other.length && primary.every((name, i) => name === other[i])) {
    return { added: [], removed: [], changed: [] };
  }

  // Positional compare when lengths match — clearer "changed" for CI.
  if (primary.length === other.length) {
    const changed: Array<{ index: number; from: string; to: string }> = [];
    for (let i = 0; i < primary.length; i += 1) {
      if (primary[i] !== other[i]) {
        changed.push({ index: i, from: primary[i]!, to: other[i]! });
      }
    }
    return { added: [], removed: [], changed };
  }

  // Different lengths: LCS-based added/removed.
  const dp = lcsTable(primary, other);
  const added: string[] = [];
  const removed: string[] = [];
  let i = primary.length;
  let j = other.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && primary[i - 1] === other[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || (dp[i]![j - 1] ?? 0) >= (dp[i - 1]![j] ?? 0))) {
      added.unshift(other[j - 1]!);
      j -= 1;
    } else {
      removed.unshift(primary[i - 1]!);
      i -= 1;
    }
  }
  return { added, removed, changed: [] };
}

export function compareTraces(primary: Trace, other: Trace): CompareResult {
  const primaryTools = toolSequence(primary);
  const otherTools = toolSequence(other);
  const { added, removed, changed } = diffToolSequences(primaryTools, otherTools);
  const seqDiffer =
    added.length > 0 || removed.length > 0 || changed.length > 0 || primaryTools.length !== otherTools.length;
  // Also treat identical names but different step counts (non-tool) as non-blocking for sequence;
  // exit 1 only when tool sequences differ OR failure counts differ (per product brief).
  const failuresDiffer = primary.stats.failures !== other.stats.failures;
  const equivalent = !seqDiffer && !failuresDiffer;

  const primarySource = primary.source ?? "primary";
  const otherSource = other.source ?? "other";
  const lines: string[] = [];
  lines.push(`agent-trace compare`);
  lines.push(`  primary: ${primarySource}`);
  lines.push(`  other:   ${otherSource}`);
  lines.push("");
  lines.push(
    `  steps:     ${primary.stats.steps} → ${other.stats.steps}${
      primary.stats.steps === other.stats.steps ? "" : "  (differ)"
    }`,
  );
  lines.push(
    `  tools:     ${primaryTools.length} → ${otherTools.length}${
      primaryTools.length === otherTools.length ? "" : "  (differ)"
    }`,
  );
  lines.push(
    `  failures:  ${primary.stats.failures} → ${other.stats.failures}${
      failuresDiffer ? "  (differ)" : ""
    }`,
  );
  const pd = primary.stats.durationMs;
  const od = other.stats.durationMs;
  if (pd != null || od != null) {
    lines.push(
      `  duration:  ${pd != null ? formatDuration(pd) : "—"} → ${od != null ? formatDuration(od) : "—"}`,
    );
  }
  lines.push("");
  lines.push(`  tool sequence (primary): ${formatSeq(primaryTools)}`);
  lines.push(`  tool sequence (other):   ${formatSeq(otherTools)}`);

  if (removed.length) {
    lines.push(`  removed:  ${removed.map(q).join(", ")}`);
  }
  if (added.length) {
    lines.push(`  added:    ${added.map(q).join(", ")}`);
  }
  if (changed.length) {
    for (const c of changed) {
      lines.push(`  changed[${c.index}]: ${q(c.from)} → ${q(c.to)}`);
    }
  }
  lines.push("");
  lines.push(equivalent ? "  result: equivalent" : "  result: DIFFERS");
  lines.push("");

  return {
    equivalent,
    primarySource,
    otherSource,
    primarySteps: primary.stats.steps,
    otherSteps: other.stats.steps,
    primaryFailures: primary.stats.failures,
    otherFailures: other.stats.failures,
    primaryDurationMs: primary.stats.durationMs,
    otherDurationMs: other.stats.durationMs,
    primaryTools,
    otherTools,
    added,
    removed,
    changed,
    report: lines.join("\n"),
  };
}

function formatSeq(tools: string[]): string {
  if (!tools.length) return "(none)";
  return tools.map(q).join(" → ");
}

function q(name: string): string {
  return name ? name : "(unnamed)";
}

/** Short Markdown block for GitHub step summary when comparing. */
export function compareMarkdown(result: CompareResult): string {
  const lines: string[] = [];
  lines.push(`### agent-trace compare`);
  lines.push("");
  lines.push(`| | Primary | Other |`);
  lines.push(`| --- | --- | --- |`);
  lines.push(`| Source | \`${escapeMd(result.primarySource)}\` | \`${escapeMd(result.otherSource)}\` |`);
  lines.push(`| Steps | ${result.primarySteps} | ${result.otherSteps} |`);
  lines.push(`| Tool calls | ${result.primaryTools.length} | ${result.otherTools.length} |`);
  lines.push(`| Failures | ${result.primaryFailures} | ${result.otherFailures} |`);
  if (result.primaryDurationMs != null || result.otherDurationMs != null) {
    lines.push(
      `| Duration | ${result.primaryDurationMs != null ? formatDuration(result.primaryDurationMs) : "—"} | ${result.otherDurationMs != null ? formatDuration(result.otherDurationMs) : "—"} |`,
    );
  }
  lines.push("");
  lines.push(`**Sequence (primary):** ${result.primaryTools.map((t) => `\`${t || "?"}\``).join(" → ") || "_(none)_"}`);
  lines.push("");
  lines.push(`**Sequence (other):** ${result.otherTools.map((t) => `\`${t || "?"}\``).join(" → ") || "_(none)_"}`);
  lines.push("");
  if (result.removed.length) lines.push(`- Removed: ${result.removed.map((t) => `\`${t}\``).join(", ")}`);
  if (result.added.length) lines.push(`- Added: ${result.added.map((t) => `\`${t}\``).join(", ")}`);
  for (const c of result.changed) {
    lines.push(`- Changed[${c.index}]: \`${c.from}\` → \`${c.to}\``);
  }
  lines.push("");
  lines.push(result.equivalent ? "**Result:** equivalent ✅" : "**Result:** DIFFERS ❌");
  lines.push("");
  return lines.join("\n");
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
