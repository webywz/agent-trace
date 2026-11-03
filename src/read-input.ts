import { readFile, stat, open } from "node:fs/promises";
import { UsageError } from "./args.js";

export async function readInput(file: string | undefined): Promise<{ text: string; source: string }> {
  if (!file || file === "-") {
    if (process.stdin.isTTY && file !== "-") {
      throw new UsageError("missing file (pass a path, '-' for stdin, or --demo for the bundled sample)");
    }
    const text = await readStdin();
    return { text, source: "stdin" };
  }
  try {
    const text = await readFile(file, "utf8");
    return { text, source: file };
  } catch (error) {
    throw wrapIoError(error, file);
  }
}

export interface FollowOptions {
  pollMs?: number;
  onLine: (line: string) => void;
  signal?: AbortSignal;
}

export async function followFile(file: string, options: FollowOptions): Promise<void> {
  const { pollMs = 100, onLine, signal } = options;

  let fileHandle;
  try {
    fileHandle = await open(file, "r");
  } catch (error) {
    throw wrapIoError(error, file);
  }

  let position = 0;
  let buffer = "";

  const cleanup = () => {
    if (fileHandle) {
      fileHandle.close().catch(() => {});
    }
  };

  if (signal) {
    signal.addEventListener("abort", cleanup);
  }

  try {
    while (!signal?.aborted) {
      try {
        const stats = await stat(file);
        const fileSize = stats.size;

        if (fileSize > position) {
          const readBuffer = Buffer.allocUnsafe(fileSize - position);
          const { bytesRead } = await fileHandle.read(readBuffer, 0, fileSize - position, position);

          if (bytesRead > 0) {
            const chunk = readBuffer.subarray(0, bytesRead).toString("utf8");
            buffer += chunk;
            position += bytesRead;

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.trim()) {
                onLine(line);
              }
            }
          }
        }

        await sleep(pollMs);
      } catch (error) {
        if (signal?.aborted) break;
        throw error;
      }
    }
  } finally {
    cleanup();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function wrapIoError(error: unknown, file: string): Error {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
  if (code === "ENOENT") return new Error(`file not found: ${file}`);
  if (code === "EISDIR") return new Error(`expected a file, got a directory: ${file}`);
  if (code === "EACCES") return new Error(`permission denied: ${file}`);
  return error instanceof Error ? error : new Error(String(error));
}
