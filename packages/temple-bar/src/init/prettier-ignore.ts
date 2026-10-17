// Keeps Prettier off pnpm-lock.yaml. The judge reads the lockfile as text and
// refuses YAML pnpm never writes, including a flow mapping wrapped over
// several lines. Prettier wraps exactly that at its default width, so a
// project that runs `prettier --write .` would have every later pull request
// refused. Prettier reads .prettierignore from the folder it runs in, which
// for a pnpm project is the root, where the one lockfile is.

import { LOCKFILE } from "../judge/lockfile.ts";
import type { WriteTargets } from "./write-target.ts";

export const PRETTIER_IGNORE_PATH = ".prettierignore";

/**
 * Whether a line of an ignore file is setup's own lockfile line. Only an
 * exact `pnpm-lock.yaml` or `/pnpm-lock.yaml` counts. A broader pattern such
 * as `*.yaml` may already cover the lockfile, but deciding that means
 * matching gitignore rules in full (wildcards, `**`, character classes,
 * folder-only patterns, and a later `!` line undoing an earlier one), and
 * getting it wrong would leave the lockfile formatted. An extra line next
 * to a broader pattern changes nothing for Prettier, so the cheap answer is
 * also the safe one. Trailing spaces are dropped, as gitignore drops them.
 */
function isLockfileLine(line: string): boolean {
  const pattern = line.replace(/[ \t]+$/, "");
  return pattern === LOCKFILE || pattern === `/${LOCKFILE}`;
}

/**
 * The ignore file with the lockfile line added, or undefined when it already
 * has one. Every existing line is kept as it is, and the file's own line
 * ending is used (CRLF when its first line ends that way), so a file kept
 * with Windows line endings stays consistent.
 */
export function withLockfileIgnored(
  existing: string | undefined,
): string | undefined {
  if (existing === undefined || existing === "") {
    return `${LOCKFILE}\n`;
  }
  if (existing.split(/\r?\n/).some(isLockfileLine)) {
    return undefined;
  }
  const eol = /^[^\n]*\r\n/.test(existing) ? "\r\n" : "\n";
  const separator = existing.endsWith("\n") ? "" : eol;
  return `${existing}${separator}${LOCKFILE}${eol}`;
}

/** Creates .prettierignore, or adds the lockfile line it lacks; returns
 * whether it wrote. A second run writes nothing. */
export async function ensurePrettierIgnore(
  targets: WriteTargets,
): Promise<boolean> {
  const existing = await targets.readText(PRETTIER_IGNORE_PATH);
  if (targets.refusals.has(PRETTIER_IGNORE_PATH)) return false;
  const content = withLockfileIgnored(existing);
  if (content === undefined) return false;
  return targets.writeText(PRETTIER_IGNORE_PATH, content);
}
