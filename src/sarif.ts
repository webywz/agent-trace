import type { Trace, TraceStep } from "./types.js";

/** Minimal SARIF 2.1.0 document suitable for GitHub Code Scanning upload. */
export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri?: string;
      rules: Array<{
        id: string;
        shortDescription: { text: string };
        helpUri?: string;
      }>;
    };
  };
  results: SarifResult[];
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri: string };
      region?: { startLine?: number };
    };
  }>;
  properties?: Record<string, unknown>;
}

function isFailureStep(step: TraceStep): boolean {
  return step.kind === "error" || Boolean(step.error);
}

function oneLine(text: string, max = 200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

/**
 * Build SARIF 2.1.0 for trace failures / tool errors (Code Scanning upload).
 * Clean runs still emit a valid log with zero results.
 */
export function renderSarif(trace: Trace, version: string): SarifLog {
  const failed = trace.steps.filter(isFailureStep);
  const uri = trace.source ?? "trace";
  const results: SarifResult[] = failed.map((step) => {
    const detail = step.error ?? step.title ?? step.name ?? "failure";
    const ruleId =
      step.kind === "error" || step.error
        ? step.name
          ? "tool-error"
          : "trace-error"
        : "trace-error";
    return {
      ruleId,
      level: "error",
      message: {
        text: oneLine(
          [
            step.name ? `tool ${step.name}` : `step #${step.index}`,
            step.kind,
            detail,
          ]
            .filter(Boolean)
            .join(": "),
        ),
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri },
            region: { startLine: step.index + 1 },
          },
        },
      ],
      properties: {
        stepIndex: step.index,
        kind: step.kind,
        ...(step.name ? { tool: step.name } : {}),
      },
    };
  });

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "agent-trace",
            version,
            informationUri: "https://github.com/webywz/agent-trace",
            rules: [
              {
                id: "trace-error",
                shortDescription: { text: "Agent trace reported an error step" },
                helpUri: "https://github.com/webywz/agent-trace#ci-gate",
              },
              {
                id: "tool-error",
                shortDescription: { text: "A tool call failed in the agent trace" },
                helpUri: "https://github.com/webywz/agent-trace#ci-gate",
              },
            ],
          },
        },
        results,
      },
    ],
  };
}

export function formatSarif(trace: Trace, version: string): string {
  return `${JSON.stringify(renderSarif(trace, version), null, 2)}\n`;
}
