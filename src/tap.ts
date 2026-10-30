import type { Trace, TraceStep } from "./types.js";

export interface TapResult {
  /** Full TAP version 13 document (trailing newline). */
  text: string;
  /** Number of not-ok assertions. */
  failures: number;
  /** Suggested process exit code: 1 if any not-ok, else 0. */
  exitCode: number;
}

function isFailureStep(step: TraceStep): boolean {
  return step.kind === "error" || Boolean(step.error);
}

function describe(step: TraceStep): string {
  const bits: string[] = [`step #${step.index}`];
  if (step.kind) bits.push(step.kind);
  if (step.name) bits.push(step.name);
  const detail = step.error ?? step.title;
  if (detail && detail !== step.name) {
    const oneLine = detail.replace(/\s+/g, " ").trim();
    if (oneLine) bits.push(oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine);
  }
  return bits.join(" - ").replace(/#/g, "\\#");
}

/**
 * Emit TAP version 13 for CI (`prove` / `tap`).
 * One `not ok` per error / failed step; clean runs get `1..0`.
 */
export function renderTap(trace: Trace): TapResult {
  const failed = trace.steps.filter(isFailureStep);
  const lines: string[] = ["TAP version 13"];

  if (failed.length === 0) {
    lines.push("1..0");
    lines.push(`# agent-trace: 0 failures · ${trace.stats.steps} steps`);
    return { text: `${lines.join("\n")}\n`, failures: 0, exitCode: 0 };
  }

  lines.push(`1..${failed.length}`);
  failed.forEach((step, i) => {
    lines.push(`not ok ${i + 1} - ${describe(step)}`);
  });
  lines.push(`# agent-trace: ${failed.length} failure${failed.length === 1 ? "" : "s"}`);
  return {
    text: `${lines.join("\n")}\n`,
    failures: failed.length,
    exitCode: 1,
  };
}
