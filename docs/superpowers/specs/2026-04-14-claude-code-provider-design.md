# Claude Code Provider Design

## Goal

Add `claude` as a third agent option in the `get_second_opinion` MCP tool, following the existing provider pattern.

## Architecture

Add a new `src/claude.ts` runner that spawns the `claude` CLI in non-interactive mode (`-p`), captures output via the existing `readCapped`/`killGracefully` utilities, and returns an `AgentResult`. Update the MCP schema enum, dispatch logic, and types to include the new provider. No registry or abstraction changes — keep the per-file runner pattern.

## Provider Contract

- **MCP tool enum**: `agent` becomes `"codex" | "opencode" | "claude"`
- **All other parameters unchanged**: `prompt`, `working_directory`, `timeout_seconds`, `output_directory`
- **Output**: Same `.md` file with `<!-- agent: claude | ... -->` header

## Execution

`src/claude.ts` spawns:

```
claude -p "<prompt>" --output-format text --dangerously-skip-permissions
```

- `-p` enables non-interactive print-and-exit mode
- `--output-format text` returns plain text response
- `--dangerously-skip-permissions` allows autonomous operation without interactive prompts (matches opencode's `--dangerously-skip-permissions` pattern)
- If `workingDirectory` is provided, it is passed as `cwd` to `Bun.spawn` (Claude Code respects the cwd for project context)

The runner follows the same pattern as `codex.ts` and `opencode.ts`:

1. Build args from options
2. Spawn with `Bun.spawn`, piping stdout/stderr
3. Feed prompt via stdin (or as positional argument — Claude's `-p` flag accepts stdin or a positional prompt)
4. Enforce timeout with `killGracefully`
5. Capture stdout/stderr with `readCapped` (512 KB cap)
6. Normalize output into `AgentResult`

Prompt delivery: use `-p` with the prompt as a positional argument. This is simpler than piping stdin and matches the CLI's intended non-interactive usage.

## Error Handling

Same normalization rules as existing providers:

- Useful stdout → treat as response
- Non-zero exit + stderr → `[claude error (exit <code>)]: <stderr>`
- Non-zero exit + no output → `[claude exited with code <code> and no output]`
- Timeout → `timedOut: true`, `src/index.ts` writes partial file and returns `isError: true`

## Files Changed

| File | Change |
|---|---|
| `src/types.ts` | Extend `AgentResult.agent` union to include `"claude"` |
| `src/claude.ts` | New file — Claude Code runner |
| `src/index.ts` | Extend `agent` enum, import `runClaude`, add dispatch branch |
| `README.md` | Add Claude Code install/auth/setup docs, update tool reference, add troubleshooting entries |

## README Updates

- **Install**: Document `claude` CLI install (via npm or direct install)
- **Auth**: Document `claude` auth flow (`claude auth` or `ANTHROPIC_API_KEY`)
- **Tool reference**: Add `claude` to agent enum description, add example request
- **Execution model table**: Add Claude row with flags `-p --output-format text --dangerously-skip-permissions`
- **Troubleshooting**: Add entries for missing `claude` binary and auth failures

## Out of Scope

- Provider registry / plugin system
- Streaming responses
- Tool restrictions (`--allowedTools`)
- Budget limits (`--max-budget-usd`)
- Model selection (`--model`)
- Session resume/continue
