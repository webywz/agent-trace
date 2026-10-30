export type TraceFormat = "auto" | "openai" | "anthropic" | "langchain" | "jsonl" | "generic";

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

export interface ToolStat {
  name: string;
  calls: number;
  failures: number;
  durationMs?: number;
}

export interface TraceStats {
  steps: number;
  toolCalls: number;
  failures: number;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  /** Per-tool breakdown (calls, failures, total duration). Present when any named tool ran. */
  tools?: ToolStat[];
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
  /** Offline by default. Pass `false` to allow OpenAI/Anthropic when keys exist. */
  localOnly?: boolean;
  timeoutMs?: number;
  model?: string;
}
