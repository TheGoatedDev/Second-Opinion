import type { AgentOptions, AgentResult } from "./types.ts";
import { killGracefully, readCapped } from "./utils.ts";

const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

export async function runClaude(options: AgentOptions): Promise<AgentResult> {
	const { prompt, workingDirectory, timeoutMs } = options;
	const start = Date.now();

	const args = [
		"-p",
		prompt,
		"--output-format",
		"text",
		"--dangerously-skip-permissions",
	];

	const proc = Bun.spawn(["claude", ...args], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
		...(workingDirectory ? { cwd: workingDirectory } : {}),
	});

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

	let response: string;
	if (rawStdout.trim()) {
		response = rawStdout.trim();
	} else if (stderr.trim()) {
		response = `[claude error (exit ${exitCode})]: ${stderr.trim()}`;
	} else if (exitCode !== 0 && !timedOut) {
		response = `[claude exited with code ${exitCode} and no output]`;
	} else {
		response = "";
	}

	return { agent: "claude", response, durationMs, timedOut, exitCode };
}
