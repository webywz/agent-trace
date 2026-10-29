import type { TraceFormat } from "./types.js";

export interface CliArgs {
  file?: string;
  format: TraceFormat;
  json: boolean;
  spicy: boolean;
  color?: boolean;
  ascii: boolean;
  width?: number;
  maxContent?: number;
  help: boolean;
  version: boolean;
}

const FORMATS = new Set<TraceFormat>(["auto", "openai", "langchain", "jsonl", "generic"]);

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    format: "auto",
    json: false,
    spicy: false,
    ascii: false,
    help: false,
    version: false,
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
      if (args.file) throw new Error("unexpected extra argument '-'");
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

    const eq = token.indexOf("=");
    const [flag, inline] = eq === -1 ? [token, undefined] : [token.slice(0, eq), token.slice(eq + 1)];

    if (flag === "-f" || flag === "--format") {
      const value = inline ?? rest[++i];
      if (!value || !FORMATS.has(value as TraceFormat)) {
        throw new Error(`unknown format '${value ?? ""}' (expected auto|openai|langchain|jsonl)`);
      }
      args.format = value as TraceFormat;
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
    if (token.startsWith("-")) {
      throw new Error(`unknown option '${token}'`);
    }
    if (args.file) {
      throw new Error(`unexpected extra argument '${token}'`);
    }
    args.file = token;
  }

  return args;
}

function toInt(value: string | undefined, flag: string): number {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} expects a positive integer`);
  }
  return n;
}

export function helpText(version: string): string {
  return `\
agent-trace  v${version}
Turn messy agent run logs into a readable timeline.

Usage:
  agent-trace <file>
  agent-trace -                          Read from stdin
  cat run.jsonl | agent-trace

Options:
  -f, --format auto|openai|langchain|jsonl   Parser (default: auto)
      --json                                 Machine-readable normalized trace
      --spicy                                Add a narrative recap (offline, or
                                             LLM if OPENAI_API_KEY / ANTHROPIC_API_KEY)
      --ascii                                ASCII-only timeline
      --no-color                             Disable ANSI colors
      --width <n>                            Wrap width (default: terminal)
      --max-content <n>                      Truncate args/results (default: 160)
  -h, --help                                 Show this help
  -v, --version                              Print version

Formats:
  openai      Chat Completions, messages[], Responses API, streaming deltas
  langchain   LangSmith run trees, callback events, AgentAction dumps
  jsonl       Role/tool/content events, Cursor-ish traces, generic objects
  auto        Sniff the file, then fall through the parsers above
`;
}
