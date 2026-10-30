export type {
  ParseOptions,
  RenderOptions,
  SpicyOptions,
  StepKind,
  ToolStat,
  Trace,
  TraceFormat,
  TraceStats,
  TraceStep,
} from "./types.js";

export { parseTrace } from "./parse/index.js";
export { parseOpenAI } from "./parse/openai.js";
export { parseAnthropic } from "./parse/anthropic.js";
export { parseClaudeCode } from "./parse/claude-code.js";
export { parseCodex } from "./parse/codex.js";
export { parseLangChain } from "./parse/langchain.js";
export { parseJsonl } from "./parse/jsonl.js";
export { parseGeneric } from "./parse/generic.js";
export { renderTimeline, summaryLine, statsReport } from "./render/timeline.js";
export { renderMarkdown } from "./render/markdown.js";
export { renderHtml, escapeHtml } from "./render/html.js";
export { renderMermaid } from "./render/mermaid.js";
export { spicyNarrative, localSpicy } from "./render/spicy.js";
export { computeStats } from "./stats.js";
export { filterTrace, parseKindList, parseToolList } from "./filter.js";
export type { FilterOptions } from "./filter.js";

export { compareTraces, compareMarkdown, toolSequence, diffToolSequences } from "./compare.js";
export type { CompareResult } from "./compare.js";
export { appendGithubSummary, resolveGithubSummaryPath, DEFAULT_GITHUB_SUMMARY } from "./github-summary.js";
export { renderGithubSummary } from "./summary-md.js";

export { redactText, redactValue, redactTrace, REDACTED } from "./redact.js";
export { renderTap } from "./tap.js";
export type { TapResult } from "./tap.js";
export { parseDurationMs } from "./duration.js";
