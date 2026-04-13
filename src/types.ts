export interface AgentOptions {
  prompt: string;
  workingDirectory?: string;
  timeoutMs: number;
}

export interface AgentResult {
  agent: "codex" | "opencode";
  response: string;
  durationMs: number;
  timedOut: boolean;
  exitCode: number | null;
}
