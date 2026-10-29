export type TraceFormat = "auto" | "openai" | "langchain" | "jsonl" | "generic";

export type StepKind =
  | "user"
  | "system"
  | "thought"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "error"
  | "other";

export interface TraceStep {
  index: number;
  kind: StepKind;
  title: string;
  name?: string;
  content?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  ts?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  toolCallId?: string;
}

export interface TraceStats {
  steps: number;
  toolCalls: number;
  failures: number;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
}

export interface Trace {
  format: Exclude<TraceFormat, "auto">;
  source?: string;
  steps: TraceStep[];
  stats: TraceStats;
  warnings: string[];
}

export interface ParseOptions {
  format?: TraceFormat;
  source?: string;
}

export interface RenderOptions {
  color?: boolean;
  ascii?: boolean;
  width?: number;
  maxContent?: number;
}

export interface SpicyOptions {
  /** Skip network even if keys exist. */
  localOnly?: boolean;
  timeoutMs?: number;
  model?: string;
}
