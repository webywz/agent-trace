import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseArgs, UsageError } from "../src/args.js";
import { main } from "../src/cli.js";
import { parseTrace, renderSarif } from "../src/index.js";
import { fixture } from "./helpers.ts";

describe("parseArgs 0.8 flags", () => {
  it("parses --max-tokens and --sarif", () => {
    const args = parseArgs([
      "node",
      "agent-trace",
      "--max-tokens",
      "100",
      "--sarif",
      "out.sarif",
      "--demo",
    ]);
    assert.equal(args.maxTokens, 100);
    assert.equal(args.sarif, "out.sarif");
  });

  it("rejects bad --max-tokens", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--max-tokens", "0", "--demo"]),
      UsageError,
    );
  });

  it("rejects bare --sarif", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--sarif", "--demo"]),
      UsageError,
    );
  });
});

describe("renderSarif", () => {
  it("emits SARIF 2.1.0 with results for demo failures", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), { source: "examples/run.jsonl" });
    const sarif = renderSarif(trace, "0.8.0");
    assert.equal(sarif.version, "2.1.0");
    assert.ok(sarif.runs[0]!.results.length >= 1);
    assert.equal(sarif.runs[0]!.tool.driver.name, "agent-trace");
  });

  it("emits zero results for clean traces", () => {
    const clean = parseTrace(
      JSON.stringify({ role: "user", content: "hi" }) +
        "\n" +
        JSON.stringify({ role: "assistant", content: "hello" }),
      { format: "openai", source: "clean.jsonl" },
    );
    const sarif = renderSarif(clean, "0.8.0");
    assert.equal(sarif.runs[0]!.results.length, 0);
  });
});

describe("CLI --max-tokens / --sarif", () => {
  it("exits 1 when tokens exceed --max-tokens", async () => {
    const prev = process.exitCode;
    process.exitCode = undefined;
    const code = await main([
      "node",
      "agent-trace",
      "--demo",
      "--stats",
      "--max-tokens",
      "1",
    ]);
    process.exitCode = prev;
    assert.equal(code, 1);
  });

  it("writes sarif file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-sarif-"));
    const path = join(dir, "out.sarif");
    try {
      const prev = process.exitCode;
      process.exitCode = undefined;
      const code = await main(["node", "agent-trace", "--demo", "--sarif", path, "--stats"]);
      process.exitCode = prev;
      // demo has failures but we didn't pass --fail-on-error; sarif write should succeed
      assert.equal(typeof code, "number");
      const body = JSON.parse(readFileSync(path, "utf8")) as { version: string; runs: unknown[] };
      assert.equal(body.version, "2.1.0");
      assert.equal(body.runs.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
