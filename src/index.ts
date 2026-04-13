import { randomBytes } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCodex } from "./codex.ts";
import { runOpencode } from "./opencode.ts";
import type { AgentOptions, AgentResult } from "./types.ts";

const server = new McpServer({
	name: "second-opinion",
	version: "1.0.0",
});

async function resolveDir(
	dir: string,
): Promise<{ path: string } | { error: string }> {
	try {
		return { path: await realpath(dir) };
	} catch {
		return { error: `Directory does not exist or is not accessible: ${dir}` };
	}
}

server.registerTool(
	"get_second_opinion",
	{
		description:
			"Get a second opinion from another AI coding agent (Codex or Opencode). " +
			"Sends a prompt to the chosen agent, writes the response to a file, and returns the file path. " +
			"The caller can then read the file to see the agent's response.",
		inputSchema: {
			prompt: z
				.string()
				.describe(
					"The question, code snippet, or task to send to the other AI agent",
				),
			agent: z
				.enum(["codex", "opencode"])
				.default("codex")
				.describe(
					"Which AI agent to consult. 'codex' uses OpenAI Codex CLI, 'opencode' uses the Opencode CLI",
				),
			working_directory: z
				.string()
				.optional()
				.describe(
					"Working directory for the agent (e.g. the project root). Must exist on disk",
				),
			timeout_seconds: z
				.number()
				.int()
				.positive()
				.max(3600)
				.default(120)
				.optional()
				.describe(
					"Max seconds to wait for the agent (1–3600). Defaults to 120",
				),
			output_directory: z
				.string()
				.optional()
				.describe(
					"Directory to write the response file. Defaults to system temp dir. Must exist on disk",
				),
		},
	},
	async ({
		prompt,
		agent,
		working_directory,
		timeout_seconds,
		output_directory,
	}) => {
		// Resolve and validate directories
		let resolvedWorkDir: string | undefined;
		if (working_directory) {
			const result = await resolveDir(working_directory);
			if ("error" in result) {
				return {
					content: [{ type: "text" as const, text: result.error }],
					isError: true,
				};
			}
			resolvedWorkDir = result.path;
		}

		let resolvedOutDir: string;
		if (output_directory) {
			const result = await resolveDir(output_directory);
			if ("error" in result) {
				return {
					content: [{ type: "text" as const, text: result.error }],
					isError: true,
				};
			}
			resolvedOutDir = result.path;
		} else {
			resolvedOutDir = tmpdir();
		}

		const options: AgentOptions = {
			prompt,
			workingDirectory: resolvedWorkDir,
			timeoutMs: (timeout_seconds ?? 120) * 1000,
		};

		let result: AgentResult;
		try {
			result =
				agent === "codex"
					? await runCodex(options)
					: await runOpencode(options);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [
					{ type: "text" as const, text: `Error spawning ${agent}: ${msg}` },
				],
				isError: true,
			};
		}

		// Surface non-zero exit as error when no useful response was produced
		const failed =
			result.exitCode !== 0 && result.exitCode !== null && !result.timedOut;
		const hasResponse = result.response.trim().length > 0;

		const timestamp = new Date().toISOString();
		const durationSec = (result.durationMs / 1000).toFixed(1);
		const statusParts = [
			`agent: ${result.agent}`,
			`duration: ${durationSec}s`,
			result.timedOut ? "TIMED OUT" : `exit: ${result.exitCode}`,
			`generated: ${timestamp}`,
		];

		const fileContent = [
			`<!-- ${statusParts.join(" | ")} -->`,
			"",
			hasResponse ? result.response : "(no response)",
		].join("\n");

		// Unique filename: agent + timestamp + random suffix
		const filename = `second-opinion-${result.agent}-${Date.now()}-${randomBytes(4).toString("hex")}.md`;
		const outPath = join(resolvedOutDir, filename);

		try {
			await mkdir(resolvedOutDir, { recursive: true });
			// wx flag = fail if file exists (collision safety)
			await writeFile(outPath, fileContent, { encoding: "utf8", flag: "wx" });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [
					{
						type: "text" as const,
						text: `Failed to write output file: ${msg}`,
					},
				],
				isError: true,
			};
		}

		if ((failed && !hasResponse) || result.timedOut) {
			return {
				content: [{ type: "text" as const, text: outPath }],
				isError: true,
			};
		}

		return {
			content: [{ type: "text" as const, text: outPath }],
		};
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
