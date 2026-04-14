# Second Opinion

An MCP server that lets AI coding agents consult other AI coding agents. Give Claude (or any MCP-compatible client) access to [OpenAI Codex CLI](https://github.com/openai/codex), [Opencode](https://opencode.ai), and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as second-opinion tools.

## What it does

Exposes a single MCP tool — `get_second_opinion` — that:

1. Sends a prompt to Codex, Opencode, or Claude
2. Waits for the agent to respond (with a configurable timeout)
3. Writes the response to a `.md` file
4. Returns the file path so the caller can read it

> **Note:** No response body is returned inline. The caller must read the returned file path.

## Execution model

This server shells out to external CLI tools. Each call spawns a subprocess that may read and write files within the specified `working_directory`.

Flags used per agent:

| Agent | Flags |
|---|---|
| `codex` | `--full-auto --ephemeral --skip-git-repo-check` |
| `opencode` | `--dangerously-skip-permissions` |
| `claude` | `-p --output-format text --dangerously-skip-permissions` |

These flags allow the agents to operate autonomously without interactive prompts. Only point them at directories you're comfortable with them accessing.

## Quick start

### 1. Install runtimes and CLIs

**Bun:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Codex CLI** (requires Node 22+):
```bash
npm install -g @openai/codex
```

**Opencode CLI:**
```bash
curl -fsSL https://opencode.ai/install | bash
```

**Claude Code CLI:**
```bash
npm install -g @anthropic-ai/claude-code
```

### 2. Authenticate the CLIs

Codex uses your `OPENAI_API_KEY` environment variable:
```bash
export OPENAI_API_KEY=sk-...
```

Opencode has its own auth flow — run it once interactively to configure:
```bash
opencode
```

Claude Code uses your Anthropic API key or OAuth:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```
Or run `claude auth` to authenticate interactively.

### 3. Build

```bash
bun install
bun run build
```

This produces `dist/second-opinion` — a compiled binary. It still requires `codex`, `opencode`, and/or `claude` to be available on `$PATH` at runtime.

### 4. Configure your MCP client

Add to your MCP client config (e.g. Claude Code `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "second-opinion": {
      "command": "/path/to/dist/second-opinion"
    }
  }
}
```

Or run directly without building:

```json
{
  "mcpServers": {
    "second-opinion": {
      "command": "bun",
      "args": ["run", "/path/to/src/index.ts"]
    }
  }
}
```

## Tool reference

### `get_second_opinion`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | `string` | — | Question, code snippet, or task to send |
| `agent` | `"codex" \| "opencode" \| "claude"` | `"codex"` | Which agent to consult |
| `working_directory` | `string` | server's cwd | Directory the agent runs in. Agents may read/write files here. Must exist on disk. |
| `timeout_seconds` | `number` | `120` | Max seconds to wait (1–3600) |
| `output_directory` | `string` | system temp | Where to write the response file. Created automatically if omitted. If provided, must already exist. |

**Returns:** The path to a `.md` file containing the agent's response.

**On error:** Returns `isError: true`. The response may still include a file path — check it, as partial output may have been written (e.g. on timeout).

### Output file format

```
<!-- agent: codex | duration: 12.3s | exit: 0 | generated: 2026-01-01T00:00:00.000Z -->

[agent response here]
```

On timeout the status line will show `TIMED OUT` instead of an exit code. The body may contain partial output.

### Example

Request:
```json
{
  "prompt": "What's the most likely cause of an off-by-one error in a binary search?",
  "agent": "codex",
  "working_directory": "/my/project",
  "timeout_seconds": 60
}
```

Success response:
```
/tmp/second-opinion-codex-1234567890-ab12cd34.md
```

Read that file to see the agent's answer.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Error spawning codex: ...` | `codex` not on `$PATH`. Install it and verify with `which codex`. |
| `Error spawning opencode: ...` | `opencode` not on `$PATH`. Install it and verify with `which opencode`. |
| `Error spawning claude: ...` | `claude` not on `$PATH`. Install it and verify with `which claude`. |
| Agent exits with no output | CLI not authenticated. Run `codex`, `opencode`, or `claude auth` interactively once to check. |
| `TIMED OUT` in response file | Increase `timeout_seconds` or simplify the prompt. |
| `Directory does not exist` error | Supplied `working_directory` or `output_directory` doesn't exist on disk. |

## Development

```bash
bun run start            # Run without building
bunx biome check         # Lint + format check
bunx biome check --write # Auto-fix
```

Pre-commit hook runs Biome automatically via Husky + lint-staged.

## License

MIT
