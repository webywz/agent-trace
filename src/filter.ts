import { computeStats } from "./stats.js";
import type { StepKind, Trace, TraceStep } from "./types.js";

export interface FilterOptions {
  /** Keep only these kinds (aliases: tool→tool_call, result→tool_result). */
  only?: StepKind[];
  /** Keep tool_call / tool_result / error steps whose name matches (case-insensitive). */
  tools?: string[];
  /** Keep failure steps and their paired tool calls/results. */
  failures?: boolean;
}

const KIND_ALIASES: Record<string, StepKind> = {
  user: "user",
  system: "system",
  thought: "thought",
  assistant: "assistant",
  tool: "tool_call",
  tool_call: "tool_call",
  toolcall: "tool_call",
  result: "tool_result",
  tool_result: "tool_result",
  toolresult: "tool_result",
  error: "error",
  fail: "error",
  failure: "error",
  other: "other",
  event: "other",
};

export function parseKindList(raw: string): StepKind[] {
  const kinds: StepKind[] = [];
  const seen = new Set<StepKind>();
  for (const part of raw.split(",")) {
    const key = part.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!key) continue;
    const kind = KIND_ALIASES[key];
    if (!kind) {
      throw new Error(
        `unknown kind '${part.trim()}' (expected user|system|thought|assistant|tool|result|error|other)`,
      );
    }
    if (!seen.has(kind)) {
      seen.add(kind);
      kinds.push(kind);
    }
  }
  if (!kinds.length) {
    throw new Error("expected at least one kind (user|system|thought|assistant|tool|result|error|other)");
  }
  return kinds;
}

export function parseToolList(raw: string): string[] {
  const tools = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!tools.length) {
    throw new Error("expected at least one tool name");
  }
  return tools;
}

/** Return a new Trace with filtered steps and recomputed stats. */
export function filterTrace(trace: Trace, options: FilterOptions): Trace {
  if (!options.only?.length && !options.tools?.length && !options.failures) {
    return trace;
  }

  let steps = trace.steps.slice();

  if (options.failures) {
    steps = keepFailures(steps);
  }

  if (options.only?.length) {
    const allowed = new Set(options.only);
    steps = steps.filter((step) => allowed.has(step.kind));
  }

  if (options.tools?.length) {
    const names = new Set(options.tools.map((name) => name.toLowerCase()));
    steps = steps.filter((step) => {
      if (!step.name) return false;
      return names.has(step.name.toLowerCase());
    });
  }

  const renumbered = steps.map((step, index) => ({ ...step, index: index + 1 }));
  return {
    ...trace,
    steps: renumbered,
    stats: computeStats(renumbered),
  };
}

function keepFailures(steps: TraceStep[]): TraceStep[] {
  const failedIds = new Set<string>();
  const failedNames = new Set<string>();
  for (const step of steps) {
    if (step.kind === "error" || step.error) {
      if (step.toolCallId) failedIds.add(step.toolCallId);
      if (step.name) failedNames.add(step.name.toLowerCase());
    }
  }

  if (!failedIds.size && !failedNames.size) {
    return steps.filter((step) => step.kind === "error" || Boolean(step.error));
  }

  return steps.filter((step) => {
    if (step.kind === "error" || step.error) return true;
    if (step.toolCallId && failedIds.has(step.toolCallId)) return true;
    if (
      step.name &&
      failedNames.has(step.name.toLowerCase()) &&
      (step.kind === "tool_call" || step.kind === "tool_result")
    ) {
      return true;
    }
    return false;
  });
}
