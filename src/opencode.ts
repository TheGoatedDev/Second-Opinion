import { killGracefully, readCapped } from "./utils.ts";
import type { AgentOptions, AgentResult } from "./types.ts";

const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

export async function runOpencode(options: AgentOptions): Promise<AgentResult> {
  const { prompt, workingDirectory, timeoutMs } = options;
  const start = Date.now();

  const args = [
    "run",
    prompt,
    "--format", "json",
    "--dangerously-skip-permissions",
  ];

  if (workingDirectory) {
    args.push("--dir", workingDirectory);
  }

  const proc = Bun.spawn(["opencode", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    ...(workingDirectory ? { cwd: workingDirectory } : {}),
  });

  // Cap both streams — stops reading after MAX_OUTPUT_BYTES, cancels the rest
  const stdoutPromise = readCapped(proc.stdout, MAX_OUTPUT_BYTES);
  const stderrPromise = readCapped(proc.stderr, MAX_OUTPUT_BYTES);

  let timedOut = false;
  const timeoutHandle = setTimeout(async () => {
    timedOut = true;
    await killGracefully(proc);
  }, timeoutMs);

  try {
    await proc.exited;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const exitCode = proc.exitCode;
  const durationMs = Date.now() - start;
  const [rawStdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  const parsed = parseOpencodeOutput(rawStdout);

  let response: string;
  if (parsed) {
    response = parsed;
  } else if (rawStdout.trim()) {
    response = `[opencode raw output — JSONL parse failed]:\n${rawStdout.trim()}`;
  } else if (stderr.trim()) {
    response = `[opencode error (exit ${exitCode})]: ${stderr.trim()}`;
  } else if (exitCode !== 0 && !timedOut) {
    response = `[opencode exited with code ${exitCode} and no output]`;
  } else {
    response = "";
  }

  return { agent: "opencode", response, durationMs, timedOut, exitCode };
}

function parseOpencodeOutput(raw: string): string {
  const parts: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (
      event !== null &&
      typeof event === "object" &&
      "type" in event &&
      event.type === "text" &&
      "part" in event &&
      event.part !== null &&
      typeof event.part === "object" &&
      "text" in event.part &&
      typeof event.part.text === "string"
    ) {
      parts.push(event.part.text);
    }
  }

  return parts.join("").trim();
}
