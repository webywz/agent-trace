import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, UsageError } from "../src/args.js";
import { fixturePath } from "./helpers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.ts");
const tsx = join(root, "node_modules", ".bin", "tsx");

function run(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [cli, ...args], {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

describe("parseArgs", () => {
  it("parses flags and the file", () => {
    const args = parseArgs(["node", "agent-trace", "--format", "openai", "--spicy", "run.jsonl"]);
    assert.equal(args.format, "openai");
    assert.equal(args.spicy, true);
    assert.equal(args.spicyLlm, false);
    assert.equal(args.file, "run.jsonl");
  });

  it("treats --spicy-llm as spicy + LLM opt-in", () => {
    const args = parseArgs(["node", "agent-trace", "--spicy-llm", "run.jsonl"]);
    assert.equal(args.spicy, true);
    assert.equal(args.spicyLlm, true);
    assert.equal(args.file, "run.jsonl");
  });

  it("treats '-' as stdin", () => {
    const args = parseArgs(["node", "agent-trace", "-"]);
    assert.equal(args.file, "-");
  });

  it("accepts generic as a format", () => {
    const args = parseArgs(["node", "agent-trace", "--format", "generic", "run.json"]);
    assert.equal(args.format, "generic");
  });

  it("accepts anthropic as a format", () => {
    const args = parseArgs(["node", "agent-trace", "--format", "anthropic", "run.json"]);
    assert.equal(args.format, "anthropic");
  });

  it("parses product flags", () => {
    const args = parseArgs(["node", "agent-trace", "--demo", "--fail-on-error", "--stats"]);
    assert.equal(args.demo, true);
    assert.equal(args.failOnError, true);
    assert.equal(args.stats, true);
  });

  it("rejects unknown formats", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--format", "protobuf"]),
      (error: unknown) => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /unknown format/);
        assert.match(error.message, /generic/);
        return true;
      },
    );
  });

  it("suggests a close flag", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--formt", "jsonl"]),
      (error: unknown) => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /did you mean --format/);
        return true;
      },
    );
  });

  it("rejects a file together with --demo", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--demo", "run.jsonl"]),
      /do not pass a file with --demo/,
    );
  });
});

describe("package", () => {
  it("uses npm 11 canonical bin path", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };
    assert.equal(pkg.bin["agent-trace"], "dist/cli.js");
    assert.ok(!pkg.bin["agent-trace"]?.startsWith("./"));
  });
});

describe("CLI", () => {
  it("renders examples/run.jsonl", async () => {
    const { code, stdout, stderr } = await run(["--no-color", fixturePath("examples/run.jsonl")]);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /agent-trace/);
    assert.match(stdout, /read_file/);
    assert.match(stdout, /run_tests/);
    assert.match(stdout, /1 failure/);
  });

  it("emits normalized JSON", async () => {
    const { code, stdout } = await run(["--json", fixturePath("examples/generic.json")]);
    assert.equal(code, 0);
    const payload = JSON.parse(stdout) as { format: string; steps: unknown[]; stats: { steps: number } };
    assert.equal(payload.format, "generic");
    assert.ok(payload.steps.length >= 4);
    assert.equal(payload.stats.steps, payload.steps.length);
  });

  it("prints a spicy recap without any API key", async () => {
    const { code, stdout } = await run(["--spicy", "--no-color", fixturePath("examples/run.jsonl")]);
    assert.equal(code, 0);
    assert.match(stdout, /spicy/);
    assert.match(stdout, /run_tests/);
  });

  it("keeps --spicy local even when API keys are set", async () => {
    const prevOpenAI = process.env.OPENAI_API_KEY;
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-should-not-be-used";
    process.env.ANTHROPIC_API_KEY = "ant-test-should-not-be-used";
    try {
      const { code, stdout } = await run(["--spicy", "--no-color", fixturePath("examples/run.jsonl")]);
      assert.equal(code, 0);
      assert.match(stdout, /spicy/);
      assert.match(stdout, /run_tests/);
      assert.doesNotMatch(stdout, /spicy LLM call failed/);
    } finally {
      if (prevOpenAI === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAI;
      if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    }
  });

  it("reads stdin", async () => {
    const { code, stdout } = await run(["-"], JSON.stringify([{ type: "user", content: "ping" }]));
    assert.equal(code, 0);
    assert.match(stdout, /ping/);
  });

  it("prints help", async () => {
    const { code, stdout } = await run(["--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
    assert.match(stdout, /--spicy/);
    assert.match(stdout, /--spicy-llm/);
    assert.match(stdout, /--demo/);
    assert.match(stdout, /--fail-on-error/);
    assert.match(stdout, /--stats/);
    assert.match(stdout, /--markdown/);
    assert.match(stdout, /--mermaid/);
    assert.match(stdout, /--only/);
    assert.match(stdout, /--failures/);
    assert.match(stdout, /generic/);
    assert.match(stdout, /Exit codes:/);
  });

  it("fails on a missing file", async () => {
    const { code, stderr } = await run(["no-such-trace.jsonl"]);
    assert.equal(code, 1);
    assert.match(stderr, /agent-trace: file not found: no-such-trace\.jsonl/);
  });

  it("exits 2 on a usage error and points at --help", async () => {
    const { code, stderr } = await run(["--nope"]);
    assert.equal(code, 2);
    assert.match(stderr, /unknown option '--nope'/);
    assert.match(stderr, /try 'agent-trace --help'/);
  });

  it("renders the bundled demo", async () => {
    const { code, stdout, stderr } = await run(["--demo", "--no-color"]);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /examples\/run\.jsonl/);
    assert.match(stdout, /run_tests/);
    assert.match(stdout, /1 failure/);
  });

  it("prints a summary with per-tool breakdown via --stats", async () => {
    const { code, stdout } = await run(["--stats", "--no-color", fixturePath("examples/run.jsonl")]);
    assert.equal(code, 0);
    assert.match(stdout, /19 steps/);
    assert.match(stdout, /7 tool calls/);
    assert.match(stdout, /1 failure/);
    assert.match(stdout, /tools:/);
    assert.match(stdout, /run_tests/);
  });

  it("exports markdown", async () => {
    const { code, stdout } = await run(["--markdown", "--no-color", "--demo"]);
    assert.equal(code, 0);
    assert.match(stdout, /# agent-trace/);
    assert.match(stdout, /\| # \| Kind \|/);
    assert.match(stdout, /run_tests/);
  });

  it("exports mermaid", async () => {
    const { code, stdout } = await run(["--mermaid", "--demo"]);
    assert.equal(code, 0);
    assert.match(stdout, /flowchart TD/);
    assert.match(stdout, /S1/);
  });

  it("filters with --only and --failures", async () => {
    const only = await run(["--only", "error", "--no-color", "--demo"]);
    assert.equal(only.code, 0);
    assert.match(only.stdout, /error/);
    assert.doesNotMatch(only.stdout, /  user/);

    const fails = await run(["--failures", "--stats", "--no-color", "--demo"]);
    assert.equal(fails.code, 0);
    assert.match(fails.stdout, /failure/);
    assert.match(fails.stdout, /run_tests/);
  });

  it("rejects combining output modes", async () => {
    const { code, stderr } = await run(["--json", "--stats", "--demo"]);
    assert.equal(code, 2);
    assert.match(stderr, /only one of/);
  });

  it("exits 1 with --fail-on-error when the run had failures", async () => {
    const { code, stdout, stderr } = await run([
      "--fail-on-error",
      "--stats",
      "--no-color",
      fixturePath("examples/run.jsonl"),
    ]);
    assert.equal(code, 1);
    assert.match(stdout, /1 failure/);
    assert.match(stderr, /1 failure \(--fail-on-error\)/);
  });


  it("parses Anthropic dump with --format anthropic", async () => {
    const { code, stdout, stderr } = await run([
      "--format",
      "anthropic",
      "--json",
      fixturePath("test/fixtures/anthropic-messages.json"),
    ]);
    assert.equal(code, 0, stderr);
    const payload = JSON.parse(stdout) as {
      format: string;
      steps: { kind: string; name?: string }[];
      stats: { toolCalls: number; tokensIn?: number };
    };
    assert.equal(payload.format, "anthropic");
    assert.ok(payload.stats.toolCalls >= 2);
    assert.ok(payload.steps.some((s) => s.kind === "tool_call" && s.name === "get_weather"));
    assert.ok(payload.steps.some((s) => s.kind === "tool_result"));
    assert.equal(payload.stats.tokensIn, 420);
  });

  it("exits 0 with --fail-on-error on a clean run", async () => {
    const { code, stderr } = await run([
      "--fail-on-error",
      "--stats",
      "--no-color",
      fixturePath("examples/generic.json"),
    ]);
    assert.equal(code, 0, stderr);
  });
});
