import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/args.js";
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
    assert.equal(args.file, "run.jsonl");
  });

  it("treats '-' as stdin", () => {
    const args = parseArgs(["node", "agent-trace", "-"]);
    assert.equal(args.file, "-");
  });

  it("rejects unknown formats", () => {
    assert.throws(() => parseArgs(["node", "agent-trace", "--format", "protobuf"]), /unknown format/);
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
  });

  it("fails on a missing file", async () => {
    const { code, stderr } = await run(["no-such-trace.jsonl"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /agent-trace:/);
  });
});
