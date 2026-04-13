import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { unlink, open } from "node:fs/promises";
import { killGracefully, readCapped } from "./utils.ts";
import type { AgentOptions, AgentResult } from "./types.ts";

const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

export async function runCodex(options: AgentOptions): Promise<AgentResult> {
  const { prompt, workingDirectory, timeoutMs } = options;
  const start = Date.now();

  const tmpFile = join(
    tmpdir(),
    `codex-out-${Date.now()}-${randomBytes(4).toString("hex")}.txt`
  );

  const args = [
    "exec",
    "-",
    "-o", tmpFile,
    "--full-auto",
    "--ephemeral",
    "--skip-git-repo-check",
  ];

  if (workingDirectory) {
    args.push("-C", workingDirectory);
  }

  const proc = Bun.spawn(["codex", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    ...(workingDirectory ? { cwd: workingDirectory } : {}),
  });

  proc.stdin.write(prompt);
  proc.stdin.end();

  // Drain both streams — stdout to prevent pipe blocking, stderr for error messages
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

  // Await streams after process exits (already buffered)
  const [, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  let response = "";
  try {
    // Read at most MAX_OUTPUT_BYTES directly — avoids loading the whole file
    const fh = await open(tmpFile, "r");
    try {
      const buf = Buffer.allocUnsafe(MAX_OUTPUT_BYTES);
      const { bytesRead } = await fh.read(buf, 0, MAX_OUTPUT_BYTES, 0);
      response = buf.subarray(0, bytesRead).toString("utf8").trim();
    } finally {
      await fh.close();
    }
  } catch {
    // file absent — process failed or was killed before writing
  } finally {
    unlink(tmpFile).catch(() => {});
  }

  if (!response) {
    if (stderr.trim()) {
      response = `[codex error (exit ${exitCode})]: ${stderr.trim()}`;
    } else if (exitCode !== 0 && !timedOut) {
      response = `[codex exited with code ${exitCode} and no output]`;
    }
  }

  return { agent: "codex", response, durationMs, timedOut, exitCode };
}
