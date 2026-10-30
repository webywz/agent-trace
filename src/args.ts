import type { StepKind, TraceFormat } from "./types.js";
import { parseDurationMs } from "./duration.js";
import { parseKindList, parseToolList } from "./filter.js";

export interface CliArgs {
  file?: string;
  format: TraceFormat;
  json: boolean;
  spicy: boolean;
  spicyLlm: boolean;
  color?: boolean;
  ascii: boolean;
  width?: number;
  maxContent?: number;
  help: boolean;
  version: boolean;
  demo: boolean;
  failOnError: boolean;
  stats: boolean;
  markdown: boolean;
  mermaid: boolean;
  only?: StepKind[];
  tools?: string[];
  failures: boolean;
  /** Other trace file for structural compare. */
  compare?: string;
  /**
   * GitHub step summary: `true` = auto path (env or ./github-step-summary.md),
   * string = explicit path. Undefined = only write when GITHUB_STEP_SUMMARY is set.
   */
  githubSummary?: string | true;
  /** HTML report: true = stdout; string = write to path. */
  html?: string | true;
  /** Scrub common secret shapes from step content before render/export. */
  redact: boolean;
  /** Fail if trace.stats.durationMs exceeds this (milliseconds). */
  maxDurationMs?: number;
  /** Fail if (tokensIn + tokensOut) exceeds this. */
  maxTokens?: number;
  /** Write SARIF 2.1.0 report for failures / tool errors to this path. */
  sarif?: string;
  /** Emit TAP version 13 to stdout (CI-friendly). */
  tap: boolean;
}

export class UsageError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const FORMATS = new Set<string>([
  "auto",
  "openai",
  "anthropic",
  "claude-code",
  "claude_code",
  "claude",
  "codex",
  "langchain",
  "jsonl",
  "generic",
]);
const FORMAT_LIST = "auto|openai|anthropic|claude-code|codex|langchain|jsonl|generic";

function normalizeFormat(value: string): TraceFormat {
  const key = value.toLowerCase();
  if (key === "claude_code" || key === "claude") return "claude-code";
  return key as TraceFormat;
}

const FLAGS = [
  "-h",
  "--help",
  "-v",
  "--version",
  "--json",
  "-j",
  "--spicy",
  "--spicy-llm",
  "--ascii",
  "--no-color",
  "--color",
  "-f",
  "--format",
  "--width",
  "--max-content",
  "--demo",
  "--fail-on-error",
  "--stats",
  "--markdown",
  "--md",
  "--mermaid",
  "--only",
  "--tool",
  "--failures",
  "--compare",
  "--github-summary",
  "--html",
  "--redact",
  "--max-duration",
  "--max-tokens",
  "--sarif",
  "--tap",
];

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    format: "auto",
    json: false,
    spicy: false,
    spicyLlm: false,
    ascii: false,
    help: false,
    version: false,
    demo: false,
    failOnError: false,
    stats: false,
    markdown: false,
    mermaid: false,
    failures: false,
    redact: false,
    tap: false,
  };

  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token) continue;

    if (token === "--") {
      const file = rest[i + 1];
      if (file) args.file = file;
      break;
    }
    if (token === "-") {
      if (args.file) throw new UsageError("unexpected extra argument '-'");
      args.file = "-";
      continue;
    }
    if (token === "-h" || token === "--help") {
      args.help = true;
      continue;
    }
    if (token === "-v" || token === "--version") {
      args.version = true;
      continue;
    }
    if (token === "--json" || token === "-j") {
      args.json = true;
      continue;
    }
    if (token === "--spicy") {
      args.spicy = true;
      continue;
    }
    if (token === "--spicy-llm") {
      args.spicy = true;
      args.spicyLlm = true;
      continue;
    }
    if (token === "--ascii") {
      args.ascii = true;
      continue;
    }
    if (token === "--no-color") {
      args.color = false;
      continue;
    }
    if (token === "--color") {
      args.color = true;
      continue;
    }
    if (token === "--demo") {
      args.demo = true;
      continue;
    }
    if (token === "--fail-on-error") {
      args.failOnError = true;
      continue;
    }
    if (token === "--stats") {
      args.stats = true;
      continue;
    }
    if (token === "--markdown" || token === "--md") {
      args.markdown = true;
      continue;
    }
    if (token === "--mermaid") {
      args.mermaid = true;
      continue;
    }
    if (token === "--failures") {
      args.failures = true;
      continue;
    }
    if (token === "--redact") {
      args.redact = true;
      continue;
    }
    if (token === "--tap") {
      args.tap = true;
      continue;
    }
    if (token === "--html") {
      // Bare flag: stdout. Peek next token if it looks like a path.
      const next = rest[i + 1];
      if (next && !next.startsWith("-")) {
        args.html = next;
        i += 1;
      } else {
        args.html = true;
      }
      continue;
    }
    if (token === "--github-summary") {
      // Bare flag: auto path. Peek next token if it looks like a path.
      const next = rest[i + 1];
      if (next && !next.startsWith("-")) {
        args.githubSummary = next;
        i += 1;
      } else {
        args.githubSummary = true;
      }
      continue;
    }

    const eq = token.indexOf("=");
    const [flag, inline] = eq === -1 ? [token, undefined] : [token.slice(0, eq), token.slice(eq + 1)];

    if (flag === "-f" || flag === "--format") {
      const value = inline ?? rest[++i];
      if (!value || value.startsWith("-") || !FORMATS.has(value.toLowerCase())) {
        throw new UsageError(`unknown format '${value ?? ""}' (expected ${FORMAT_LIST})`);
      }
      args.format = normalizeFormat(value);
      continue;
    }
    if (flag === "--width") {
      args.width = toInt(inline ?? rest[++i], "--width");
      continue;
    }
    if (flag === "--max-content") {
      args.maxContent = toInt(inline ?? rest[++i], "--max-content");
      continue;
    }
    if (flag === "--only") {
      const value = inline ?? rest[++i];
      if (!value || value.startsWith("-")) {
        throw new UsageError("--only expects a comma-separated kind list");
      }
      try {
        args.only = parseKindList(value);
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    if (flag === "--tool") {
      const value = inline ?? rest[++i];
      if (!value || value.startsWith("-")) {
        throw new UsageError("--tool expects a tool name (or comma-separated list)");
      }
      try {
        const next = parseToolList(value);
        args.tools = [...(args.tools ?? []), ...next];
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    if (flag === "--compare") {
      const value = inline ?? rest[++i];
      if (!value || value.startsWith("-")) {
        throw new UsageError("--compare expects a path to another trace file");
      }
      args.compare = value;
      continue;
    }
    if (flag === "--max-duration") {
      const value = inline ?? rest[++i];
      if (!value || value.startsWith("-")) {
        throw new UsageError("--max-duration expects a duration (e.g. 5000, 30s, 2m)");
      }
      try {
        args.maxDurationMs = parseDurationMs(value);
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    if (flag === "--max-tokens") {
      args.maxTokens = toInt(inline ?? rest[++i], "--max-tokens");
      continue;
    }
    if (flag === "--sarif") {
      const value = inline ?? rest[++i];
      if (!value || value.startsWith("-")) {
        throw new UsageError("--sarif expects a path to write the SARIF report");
      }
      args.sarif = value;
      continue;
    }
    if (flag === "--html") {
      args.html = inline === undefined || inline === "" ? true : inline;
      continue;
    }
    if (flag === "--github-summary") {
      // --github-summary=path form (bare handled above)
      args.githubSummary = inline === undefined || inline === "" ? true : inline;
      continue;
    }
    if (token.startsWith("-")) {
      const hint = suggestFlag(token);
      throw new UsageError(
        hint ? `unknown option '${token}' (did you mean ${hint}?)` : `unknown option '${token}'`,
      );
    }
    if (args.file) {
      throw new UsageError(`unexpected extra argument '${token}'`);
    }
    args.file = token;
  }

  if (args.demo && args.file) {
    throw new UsageError("do not pass a file with --demo (the bundled sample is used)");
  }

  const exclusive = [args.json, args.markdown, args.mermaid, args.html, args.tap].filter(Boolean).length;
  if (exclusive > 1) {
    throw new UsageError("use only one of --json, --markdown, --mermaid, --html, --tap");
  }
  // --stats alone is fine; with --tap it prints on stderr. Not combined with other exports.
  if (args.stats && (args.json || args.markdown || args.mermaid || args.html)) {
    throw new UsageError("use only one of --json, --stats, --markdown, --mermaid, --html");
  }

  return args;
}

function toInt(value: string | undefined, flag: string): number {
  const n = Number(value);
  if (!value || value.startsWith("-") || !Number.isInteger(n) || n <= 0) {
    throw new UsageError(`${flag} expects a positive integer`);
  }
  return n;
}

function suggestFlag(token: string): string | undefined {
  if (token.startsWith("--") && token.length >= 4) {
    const prefixes = FLAGS.filter((flag) => flag.startsWith(token));
    if (prefixes.length === 1) return prefixes[0];
  }
  let best: string | undefined;
  let bestDist = 3;
  for (const flag of FLAGS) {
    const dist = levenshtein(token, flag);
    if (dist < bestDist) {
      bestDist = dist;
      best = flag;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(rows * cols);
  for (let i = 0; i < rows; i += 1) dp[i * cols] = i;
  for (let j = 0; j < cols; j += 1) dp[j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        (dp[(i - 1) * cols + j] ?? 0) + 1,
        (dp[i * cols + j - 1] ?? 0) + 1,
        (dp[(i - 1) * cols + j - 1] ?? 0) + cost,
      );
    }
  }
  return dp[a.length * cols + b.length] ?? 0;
}

export function helpText(version: string): string {
  return `\
agent-trace  v${version}
Turn messy agent run logs into a readable timeline.

Usage:
  agent-trace [options] <file>
  agent-trace [options] -                 Read from stdin
  cat run.jsonl | agent-trace
  agent-trace --demo                      Bundled sample (no file needed)

Options:
  -f, --format <fmt>     ${FORMAT_LIST} (default: auto)
  -j, --json             Normalized trace as JSON
      --stats            Summary + per-tool breakdown
      --markdown, --md   GitHub-friendly Markdown report
      --html [path]      Self-contained HTML report (stdout, or write to path)
      --mermaid          Mermaid flowchart (paste into a \`\`\`mermaid fence)
      --only <kinds>     Keep kinds: user,tool,result,error,assistant,…
      --tool <name>      Keep steps for this tool (repeatable / comma list)
      --failures         Keep only failures (+ paired tool calls)
      --spicy            Local narrative recap (no network)
      --spicy-llm        Narrative via OpenAI/Anthropic (needs API key)
      --fail-on-error    Exit 1 if the run had failures
      --max-duration <n> Exit 1 if run duration exceeds N (ms, or 30s / 2m)
      --max-tokens <n>   Exit 1 if stats in+out tokens exceed N
      --sarif <path>     Write SARIF 2.1.0 for failures / tool errors (Code Scanning)
      --redact           Scrub secrets (PEM, JWT, sk-, ghp_, Slack, AWS, Bearer…)
      --tap              TAP version 13 on stdout (CI; exit 1 on failures)
      --compare <file>   Diff tool sequence vs another trace (exit 1 on differ)
      --github-summary [path]  Append Markdown to GITHUB_STEP_SUMMARY or path
      --demo             Render bundled examples/run.jsonl
      --ascii            ASCII-only timeline
      --color            Force ANSI colors
      --no-color         Disable ANSI colors (or set NO_COLOR)
      --width <n>        Wrap width (default: terminal)
      --max-content <n>  Truncate args/results (default: 160)
  -h, --help             Show this help
  -v, --version          Print version

Formats:
  openai       Chat Completions, messages[], Responses API, streaming deltas
  anthropic    Claude Messages API, content blocks (text / tool_use / tool_result)
  claude-code  Claude Code stream-json (aliases: claude_code, claude)
  codex        Codex CLI JSONL ({ type, payload } / msg envelopes)
  langchain    LangSmith run trees, callback events, AgentAction dumps
  jsonl        Role/tool/content events, Cursor-ish traces, generic objects
  generic      JSON array (or { events: [...] }) of { type, name, content, ts }
  auto         Sniff the file, then fall through the parsers above

Exit codes:
  0  ok (or --compare with equivalent structure)
  1  I/O or parse error; --fail-on-error / --tap with failures; --max-duration / --max-tokens exceeded; --compare differs
  2  usage error (bad flag, missing file)

Examples:
  agent-trace --demo
  agent-trace run.jsonl
  agent-trace --format openai dump.json
  agent-trace --json run.jsonl | jq .stats
  agent-trace --stats --demo
  agent-trace --only tool,error --demo
  agent-trace --failures --demo
  agent-trace --tool run_tests --demo
  agent-trace --markdown --demo > report.md
  agent-trace --html --demo > trace.html
  agent-trace --html /tmp/at.html --demo
  agent-trace --mermaid --demo
  agent-trace --fail-on-error --stats traces/ci.jsonl
  agent-trace --max-duration 30s --stats traces/ci.jsonl
  agent-trace --max-tokens 8000 --stats traces/ci.jsonl
  agent-trace --sarif results.sarif --demo
  agent-trace --redact --markdown run.jsonl
  agent-trace --tap --demo
  agent-trace --compare baseline.jsonl traces/ci.jsonl
  agent-trace --github-summary --demo
`;
}
