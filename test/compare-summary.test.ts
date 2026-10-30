import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseArgs } from "../src/args.js";
import { compareTraces, diffToolSequences, toolSequence } from "../src/compare.js";
import { appendGithubSummary, resolveGithubSummaryPath } from "../src/github-summary.js";
import { parseTrace } from "../src/parse/index.js";
import { renderGithubSummary } from "../src/summary-md.js";
import { fixture, fixturePath } from "./helpers.ts";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.ts");
const tsx = join(root, "node_modules", ".bin", "tsx");

function run(
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [cli, ...args], {
      cwd: opts.cwd ?? root,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("parseArgs compare / github-summary", () => {
  it("parses --compare and bare --github-summary", () => {
    const args = parseArgs([
      "node",
      "agent-trace",
      "--compare",
      "other.jsonl",
      "--github-summary",
      "run.jsonl",
    ]);
    assert.equal(args.compare, "other.jsonl");
    // next non-flag after bare --github-summary is consumed as path
    assert.equal(args.githubSummary, "run.jsonl");
    assert.equal(args.file, undefined);
  });

  it("parses --github-summary=path and leaves file free", () => {
    const args = parseArgs([
      "node",
      "agent-trace",
      "--github-summary=out.md",
      "run.jsonl",
    ]);
    assert.equal(args.githubSummary, "out.md");
    assert.equal(args.file, "run.jsonl");
  });

  it("bare --github-summary before --demo stays true", () => {
    const args = parseArgs(["node", "agent-trace", "--github-summary", "--demo"]);
    assert.equal(args.githubSummary, true);
    assert.equal(args.demo, true);
  });
});

describe("resolveGithubSummaryPath", () => {
  it("uses env when flag is true", () => {
    assert.equal(
      resolveGithubSummaryPath(true, { GITHUB_STEP_SUMMARY: "/tmp/gs.md" }, "/cwd"),
      "/tmp/gs.md",
    );
  });

  it("falls back to local file when flag true and no env", () => {
    assert.equal(
      resolveGithubSummaryPath(true, {}, "/cwd"),
      join("/cwd", "github-step-summary.md"),
    );
  });

  it("returns undefined when flag omitted and no env", () => {
    assert.equal(resolveGithubSummaryPath(undefined, {}, "/cwd"), undefined);
  });

  it("returns env when flag omitted but env set", () => {
    assert.equal(
      resolveGithubSummaryPath(undefined, { GITHUB_STEP_SUMMARY: "/tmp/a.md" }, "/cwd"),
      "/tmp/a.md",
    );
  });
});

describe("compareTraces", () => {
  it("marks identical tool sequences equivalent", () => {
    const text = fixture("examples/run.jsonl");
    const a = parseTrace(text, { format: "jsonl", source: "a" });
    const b = parseTrace(text, { format: "jsonl", source: "b" });
    const result = compareTraces(a, b);
    assert.equal(result.equivalent, true);
    assert.deepEqual(toolSequence(a), toolSequence(b));
    assert.match(result.report, /equivalent/);
  });

  it("detects changed tool at same index", () => {
    const { changed } = diffToolSequences(["read_file", "run_tests"], ["read_file", "edit_file"]);
    assert.equal(changed.length, 1);
    assert.equal(changed[0]?.from, "run_tests");
    assert.equal(changed[0]?.to, "edit_file");
  });

  it("detects added/removed when lengths differ", () => {
    const { added, removed } = diffToolSequences(["a", "b"], ["a", "b", "c"]);
    assert.deepEqual(added, ["c"]);
    assert.deepEqual(removed, []);
  });

  it("fails equivalence when failure counts differ", () => {
    const text = fixture("examples/run.jsonl");
    const a = parseTrace(text, { format: "jsonl", source: "a" });
    const b = parseTrace(text, { format: "jsonl", source: "b" });
    // Drop error steps from b
    b.steps = b.steps.filter((s) => s.kind !== "error");
    b.stats = { ...b.stats, failures: 0, steps: b.steps.length };
    const result = compareTraces(a, b);
    assert.equal(result.equivalent, false);
    assert.match(result.report, /failures/);
  });
});

describe("CLI --compare / --github-summary", () => {
  it("--compare identical files exits 0", async () => {
    const path = fixturePath("examples/run.jsonl");
    const { code, stdout, stderr } = await run(["--compare", path, path]);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /equivalent/);
  });

  it("--compare different tool sequences exits 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-trace-cmp-"));
    try {
      const primary = join(dir, "a.jsonl");
      const other = join(dir, "b.jsonl");
      writeFileSync(
        primary,
        [
          JSON.stringify({ type: "tool_call", name: "read_file", ts: "2026-01-01T00:00:00Z" }),
          JSON.stringify({ type: "tool_call", name: "run_tests", ts: "2026-01-01T00:00:01Z" }),
        ].join("\n") + "\n",
      );
      writeFileSync(
        other,
        [
          JSON.stringify({ type: "tool_call", name: "read_file", ts: "2026-01-01T00:00:00Z" }),
          JSON.stringify({ type: "tool_call", name: "edit_file", ts: "2026-01-01T00:00:01Z" }),
        ].join("\n") + "\n",
      );
      const { code, stdout } = await run(["--compare", other, primary]);
      assert.equal(code, 1);
      assert.match(stdout, /DIFFERS|changed/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--github-summary appends markdown to a local file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-trace-gs-"));
    try {
      const out = join(dir, "summary.md");
      const { code, stderr } = await run(
        ["--demo", `--github-summary=${out}`, "--no-color"],
        { cwd: dir },
      );
      assert.equal(code, 0, stderr);
      const body = readFileSync(out, "utf8");
      assert.match(body, /agent-trace/);
      assert.match(body, /tool/i);
      // append again
      const again = await run(["--demo", `--github-summary=${out}`, "--stats", "--no-color"], {
        cwd: dir,
      });
      assert.equal(again.code, 0, again.stderr);
      const twice = readFileSync(out, "utf8");
      assert.ok(twice.length > body.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GITHUB_STEP_SUMMARY env alone triggers append", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-trace-env-"));
    try {
      const out = join(dir, "from-env.md");
      const { code, stderr } = await run(["--demo", "--no-color"], {
        cwd: dir,
        env: { GITHUB_STEP_SUMMARY: out },
      });
      assert.equal(code, 0, stderr);
      assert.match(readFileSync(out, "utf8"), /agent-trace/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderGithubSummary", () => {
  it("renders a short markdown block", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), {
      format: "jsonl",
      source: "examples/run.jsonl",
    });
    const md = renderGithubSummary(trace);
    assert.match(md, /^### agent-trace/);
    assert.match(md, /read_file/);
  });
});

describe("appendGithubSummary", () => {
  it("creates and appends", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-trace-append-"));
    try {
      const file = join(dir, "nested", "s.md");
      appendGithubSummary(file, "# one\n");
      appendGithubSummary(file, "# two\n");
      assert.equal(readFileSync(file, "utf8"), "# one\n# two\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
