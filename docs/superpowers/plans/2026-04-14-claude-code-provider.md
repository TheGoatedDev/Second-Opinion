# Claude Code Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `claude` as a third agent option in the `get_second_opinion` MCP tool.

**Architecture:** New `src/claude.ts` runner spawns the `claude` CLI in non-interactive mode (`-p`), captures output via existing `readCapped`/`killGracefully` utilities, and returns `AgentResult`. MCP schema enum and dispatch in `src/index.ts` are extended. Types, README updated.

**Tech Stack:** TypeScript, Bun, `@modelcontextprotocol/sdk`, Zod

---

### Task 1: Update shared types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Extend `AgentResult.agent` union**

In `src/types.ts`, change the `agent` field in `AgentResult` from `"codex" | "opencode"` to `"codex" | "opencode" | "claude"`:

```typescript
export interface AgentResult {
	agent: "codex" | "opencode" | "claude";
	response: string;
	durationMs: number;
	timedOut: boolean;
	exitCode: number | null;
}
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add claude to AgentResult agent union"
```

---

### Task 2: Create the Claude Code runner

**Files:**
- Create: `src/claude.ts`

- [ ] **Step 1: Write `src/claude.ts`**

Create `src/claude.ts` following the pattern of `src/opencode.ts` (simpler than codex because no temp file needed — Claude outputs directly to stdout):

```typescript
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
```

- [ ] **Step 2: Verify new file compiles**

Run: `bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/claude.ts
git commit -m "feat: add Claude Code runner"
```

---

### Task 3: Wire Claude into the MCP server

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import and extend enum**

In `src/index.ts`, add the `runClaude` import at the top alongside the existing imports:

```typescript
import { runClaude } from "./claude.ts";
```

Change the `agent` enum in the tool schema from:

```typescript
z.enum(["codex", "opencode"])
```

to:

```typescript
z.enum(["codex", "opencode", "claude"])
```

- [ ] **Step 2: Update the dispatch logic**

Replace the dispatch block:

```typescript
result =
	agent === "codex"
		? await runCodex(options)
		: await runOpencode(options);
```

with:

```typescript
result =
	agent === "codex"
		? await runCodex(options)
		: agent === "claude"
			? await runClaude(options)
			: await runOpencode(options);
```

- [ ] **Step 3: Update the agent description**

Change the agent field description from:

```typescript
"Which AI agent to consult. 'codex' uses OpenAI Codex CLI, 'opencode' uses the Opencode CLI",
```

to:

```typescript
"Which AI agent to consult. 'codex' uses OpenAI Codex CLI, 'opencode' uses the Opencode CLI, 'claude' uses Claude Code CLI",
```

- [ ] **Step 4: Update the tool description**

Change the tool description from:

```typescript
"Get a second opinion from another AI coding agent (Codex or Opencode). " +
"Sends a prompt to the chosen agent, writes the response to a file, and returns the file path. " +
"The caller can then read the file to see the agent's response.",
```

to:

```typescript
"Get a second opinion from another AI coding agent (Codex, Opencode, or Claude). " +
"Sends a prompt to the chosen agent, writes the response to a file, and returns the file path. " +
"The caller can then read the file to see the agent's response.",
```

- [ ] **Step 5: Verify compilation**

Run: `bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire Claude Code into MCP server dispatch"
```

---

### Task 4: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the intro paragraph**

Change:

```markdown
An MCP server that lets AI coding agents consult other AI coding agents. Give Claude (or any MCP-compatible client) access to [OpenAI Codex CLI](https://github.com/openai/codex) and [Opencode](https://opencode.ai) as second-opinion tools.
```

to:

```markdown
An MCP server that lets AI coding agents consult other AI coding agents. Give Claude (or any MCP-compatible client) access to [OpenAI Codex CLI](https://github.com/openai/codex), [Opencode](https://opencode.ai), and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as second-opinion tools.
```

- [ ] **Step 2: Add Claude to the execution model table**

Add a row to the execution model table:

```markdown
| `claude` | `-p --output-format text --dangerously-skip-permissions` |
```

The full table becomes:

```markdown
| Agent | Flags |
|---|---|
| `codex` | `--full-auto --ephemeral --skip-git-repo-check` |
| `opencode` | `--dangerously-skip-permissions` |
| `claude` | `-p --output-format text --dangerously-skip-permissions` |
```

- [ ] **Step 3: Add Claude Code install instructions**

After the Opencode CLI install section, add:

```markdown
**Claude Code CLI:**
```bash
npm install -g @anthropic-ai/claude-code
```
```

- [ ] **Step 4: Add Claude auth instructions**

After the Opencode auth section, add:

```markdown
Claude Code uses your Anthropic API key or OAuth:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```
Or run `claude auth` to authenticate interactively.
```

- [ ] **Step 5: Update tool reference table**

Change the `agent` parameter row from:

```markdown
| `agent` | `"codex" \| "opencode"` | `"codex"` | Which agent to consult |
```

to:

```markdown
| `agent` | `"codex" \| "opencode" \| "claude"` | `"codex"` | Which agent to consult |
```

- [ ] **Step 6: Add troubleshooting entries**

Add these rows to the troubleshooting table:

```markdown
| `Error spawning claude: ...` | `claude` not on `$PATH`. Install it and verify with `which claude`. |
| Claude exits with no output | CLI not authenticated. Run `claude auth` or set `ANTHROPIC_API_KEY`. |
```

- [ ] **Step 7: Verify lint passes**

Run: `bunx biome check`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: add Claude Code provider to README"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run Biome on full project**

Run: `bunx biome check`
Expected: no errors

- [ ] **Step 2: Run TypeScript check**

Run: `bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Build the binary**

Run: `bun run build`
Expected: produces `dist/second-opinion` without errors
