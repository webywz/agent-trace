import type { Trace, TraceStep } from "./types.js";
import { isRecord } from "./util.js";

export const REDACTED = "[redacted]";

/** Common secret shapes — dependency-free, share-safe scrubbing. */
const PATTERNS: RegExp[] = [
  // PEM private keys (BEGIN … PRIVATE KEY … END)
  /-----BEGIN [A-Z0-9][A-Z0-9 ]{0,80}PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9][A-Z0-9 ]{0,80}PRIVATE KEY-----/g,
  // JWT-ish (header.payload.sig, both header+payload often start with eyJ)
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // OpenAI / Anthropic / OpenAI-project style API keys
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,
  // GitHub tokens
  /\bgh[po]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Slack bot / user tokens
  /\bxox[bp]-[A-Za-z0-9-]{10,}\b/g,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Authorization: Bearer / Basic
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
];

/** Scrub secret-looking substrings in a string. Idempotent. */
export function redactText(input: string): string {
  let out = input;
  for (const pattern of PATTERNS) {
    // Reset lastIndex for global patterns reused across calls
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Deep-scrub strings inside JSON-ish values (objects / arrays / primitives). */
export function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = redactValue(child);
    }
    return next;
  }
  return value;
}

function redactStep(step: TraceStep): TraceStep {
  const next: TraceStep = { ...step };
  if (next.title) next.title = redactText(next.title);
  if (next.content != null) next.content = redactText(next.content);
  if (next.error != null) next.error = redactText(next.error);
  if (next.name != null) next.name = redactText(next.name);
  if (next.args !== undefined) next.args = redactValue(next.args);
  if (next.result !== undefined) next.result = redactValue(next.result);
  return next;
}

/** Return a new Trace with secrets scrubbed from step content/args/results/errors. */
export function redactTrace(trace: Trace): Trace {
  return {
    ...trace,
    steps: trace.steps.map(redactStep),
    warnings: trace.warnings.map((w) => redactText(w)),
  };
}
