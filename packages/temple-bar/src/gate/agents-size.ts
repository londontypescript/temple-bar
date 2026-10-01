// The gate's AGENTS.md size check. Agents load AGENTS.md into every session,
// so a file that keeps growing quietly eats the room they have to work in.
// The limits are the ones AGENTS.md states about itself; the check is here so
// a repo can't drift past them unnoticed.

import path from "node:path";
import type { Context } from "../context.ts";
import { countLines } from "./lengths.ts";

export const AGENTS_FILE = "AGENTS.md";
export const AGENTS_MAX_LINES = 200;
export const AGENTS_MAX_BYTES = 32 * 1024;

export interface AgentsSizeResult {
  /** False when the repo has no AGENTS.md: nothing to measure. */
  readonly found: boolean;
  readonly lines: number;
  readonly bytes: number;
  readonly overLines: boolean;
  readonly overBytes: boolean;
}

/** Pure: measures AGENTS.md content against both limits. Bytes, not
 * characters, because the limit is about file size on disk. */
export function measureAgentsFile(content: string): AgentsSizeResult {
  const lines = countLines(content);
  const bytes = Buffer.byteLength(content, "utf8");
  return {
    found: true,
    lines,
    bytes,
    overLines: lines > AGENTS_MAX_LINES,
    overBytes: bytes > AGENTS_MAX_BYTES,
  };
}

export async function checkAgentsSize(ctx: Context): Promise<AgentsSizeResult> {
  const content = await ctx.fs.readText(path.join(ctx.cwd, AGENTS_FILE));
  if (content === undefined) {
    return {
      found: false,
      lines: 0,
      bytes: 0,
      overLines: false,
      overBytes: false,
    };
  }
  return measureAgentsFile(content);
}

export function formatAgentsSizeFailure(result: AgentsSizeResult): string {
  const lines = [`gate: ${AGENTS_FILE} is over its size limit:`];
  if (result.overLines) {
    lines.push(
      `  ${String(result.lines)} lines (limit ${String(AGENTS_MAX_LINES)})`,
    );
  }
  if (result.overBytes) {
    lines.push(
      `  ${String(result.bytes)} bytes (limit ${String(AGENTS_MAX_BYTES)}, 32 KiB)`,
    );
  }
  lines.push(
    "  move reference material and reasons into docs and link to them",
  );
  return `${lines.join("\n")}\n`;
}
