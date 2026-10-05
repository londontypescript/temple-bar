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

/** How to bring AGENTS.md back within its limits, shared by the gate's
 * failure and setup's warning. temple-bar's block is never what gives way:
 * agents only reliably follow what is in AGENTS.md itself, so its rules must
 * stay there, while a project's own reference text can live in a doc an
 * agent reads when the link tells it to. */
export const AGENTS_OVERSIZE_FIX =
  "keep temple-bar's block whole (the gate fails on an edited one); move " +
  "this project's own text from outside it into a doc, linked with when to " +
  'read it, for example "Before changing the UI, read docs/conventions.md."';

/** One line per limit the file is over, for any report about its size. */
export function describeAgentsOverage(
  result: AgentsSizeResult,
): readonly string[] {
  const lines: string[] = [];
  if (result.overLines) {
    lines.push(
      `${String(result.lines)} lines (limit ${String(AGENTS_MAX_LINES)})`,
    );
  }
  if (result.overBytes) {
    lines.push(
      `${String(result.bytes)} bytes (limit ${String(AGENTS_MAX_BYTES)}, 32 KiB)`,
    );
  }
  return lines;
}

export function formatAgentsSizeFailure(result: AgentsSizeResult): string {
  const lines = [
    `gate: ${AGENTS_FILE} is over its size limit:`,
    ...describeAgentsOverage(result).map((line) => `  ${line}`),
    `  Fix: ${AGENTS_OVERSIZE_FIX}`,
  ];
  return `${lines.join("\n")}\n`;
}
