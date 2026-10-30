import type { Trace, TraceStep } from "./types.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isFailureStep(step: TraceStep): boolean {
  return step.kind === "error" || Boolean(step.error);
}

function oneLine(text: string, max = 200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function describe(step: TraceStep): string {
  const bits: string[] = [`step #${step.index}`];
  if (step.kind) bits.push(step.kind);
  if (step.name) bits.push(step.name);
  const detail = step.error ?? step.title;
  if (detail && detail !== step.name) bits.push(oneLine(detail, 80));
  return bits.join(" - ");
}

function msToSeconds(ms: number | undefined): string {
  return (Math.max(0, ms ?? 0) / 1000).toFixed(3);
}

/**
 * Hand-written JUnit XML for CI (Jenkins, GitHub Actions, etc.).
 * One testcase per failure step; clean runs emit a single passing suite with 0 failures.
 */
export function formatJUnit(trace: Trace): string {
  const suiteName = trace.source?.trim() || "agent-trace";
  const failed = trace.steps.filter(isFailureStep);
  const duration = msToSeconds(trace.stats.durationMs);
  const timestamp = new Date().toISOString();

  if (failed.length === 0) {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<testsuites name="${escapeXml(suiteName)}" tests="1" failures="0" skipped="0" time="${duration}">`,
      `  <testsuite name="${escapeXml(suiteName)}" tests="1" failures="0" skipped="0" time="${duration}" hostname="agent-trace" timestamp="${timestamp}">`,
      `    <testcase name="trace" classname="${escapeXml(suiteName)}" time="${duration}"/>`,
      `  </testsuite>`,
      `</testsuites>`,
      ``,
    ].join("\n");
  }

  const cases = failed
    .map((step, i) => {
      const name = escapeXml(step.name ? `${step.name}#${step.index}` : `step-${step.index}`);
      const message = escapeXml(oneLine(describe(step)));
      const body = escapeXml(step.error ?? step.content ?? describe(step));
      const time = msToSeconds(step.durationMs);
      return `    <testcase name="${name}" classname="${escapeXml(suiteName)}" time="${time}">\n      <failure message="${message}">${body}</failure>\n    </testcase>`;
    })
    .join("\n");

  const n = failed.length;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="${escapeXml(suiteName)}" tests="${n}" failures="${n}" skipped="0" time="${duration}">`,
    `  <testsuite name="${escapeXml(suiteName)}" tests="${n}" failures="${n}" skipped="0" time="${duration}" hostname="agent-trace" timestamp="${timestamp}">`,
    cases,
    `  </testsuite>`,
    `</testsuites>`,
    ``,
  ].join("\n");
}
