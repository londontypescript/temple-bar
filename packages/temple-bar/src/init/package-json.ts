// Creates package.json, or adds a missing name and the scripts temple-bar
// needs to an existing one. Like the rest of setup, it only adds: when the
// project already has a `gate` script with different content, it is
// reported, never overwritten. A `prepare` script that is the project's own
// is kept and temple-bar's command is chained after it, so both run; one
// that can't safely be chained onto is reported like a `gate` conflict.
// When nothing names the project's pnpm version, it records the one running
// setup (see pnpmVersionStep).

import path from "node:path";

import type { Context } from "../context.ts";
import { repoName } from "./repo-name.ts";
import { RERUN_INIT } from "./requirements.ts";

interface PackageJsonShape {
  name?: unknown;
  private?: unknown;
  scripts?: Record<string, unknown>;
  [key: string]: unknown;
}

export const PREPARE_SCRIPT = "temple-bar hook install";
export const GATE_SCRIPT = "temple-bar gate";

const CHAIN = ` && ${PREPARE_SCRIPT}`;

/** True when `&&` can safely follow `command`: a `#` comment would swallow
 * whatever is appended, and a trailing `&`, `;` or `|` (so `&&` and `||`
 * too) would turn the appended command into something else, or a syntax
 * error. A command over several lines is never chained: the appended text
 * would join only its last line, which can be the end of a heredoc, and a
 * line can't start with `&&`. Whitespace around the command doesn't matter,
 * because setup trims it before chaining. */
function canChainAfter(command: string): boolean {
  const trimmed = command.trim();
  return (
    trimmed !== "" &&
    !trimmed.includes("#") &&
    !/[\r\n]/.test(trimmed) &&
    !/[&;|]$/.test(trimmed)
  );
}

/** The one rule for what counts as temple-bar's `prepare` script, used by
 * setup and by the gate: exactly `temple-bar hook install`, or the project's
 * own command followed by ` && temple-bar hook install`, where `&&` can
 * safely follow that command. Anything else (including a value that isn't a
 * string) is not temple-bar's. */
export function isTempleBarPrepare(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const command = value.trim();
  // A line break left inside, such as one just before ` && `, would leave
  // `&&` starting a line, which the shell refuses.
  if (/[\r\n]/.test(command)) return false;
  if (command === PREPARE_SCRIPT) return true;
  return (
    command.endsWith(CHAIN) &&
    canChainAfter(command.slice(0, command.length - CHAIN.length))
  );
}

function isPackageJsonShape(value: unknown): value is PackageJsonShape {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What setup did about the project's pnpm version: found it named, added
 * the running pnpm's, or left it alone with a problem to report. */
type PnpmVersionStep =
  | { readonly kind: "named" }
  | { readonly kind: "added"; readonly version: string }
  | { readonly kind: "problem"; readonly message: string };

/** The exact version in a user agent such as `pnpm/10.34.5 npm/? node/v24.0.0
 * darwin arm64`, which pnpm sets for every script and `pnpm exec`. Anything
 * else, including another package manager, means setup can't tell. */
function runningPnpmVersion(userAgent: string | undefined): string | undefined {
  return /^pnpm\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) \S/.exec(
    userAgent ?? "",
  )?.[1];
}

/** Whether `value`, from package.json's `field`, names a pnpm version:
 * `"pnpm@<version>"` in `packageManager`, or `{ "name": "pnpm", "version":
 * "<version>" }` in `devEngines.packageManager`. */
function namesPnpm(field: string, value: unknown): boolean {
  if (field === "packageManager") {
    return typeof value === "string" && /^pnpm@./.test(value);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const { name, version } = value as Record<string, unknown>;
  return name === "pnpm" && typeof version === "string" && version !== "";
}

/** The conflict to report when `field` holds a value setup can't use. */
function unusablePnpm(field: string, value: unknown): string {
  return (
    `package.json's ${field} is ${JSON.stringify(value)}, which doesn't ` +
    "name a pnpm version, so it was left alone. The workflows setup writes " +
    "install the pnpm package.json names, and fail without one. Fix: set " +
    `it to the pnpm the project uses, then run ${RERUN_INIT} again.`
  );
}

/**
 * pnpm/action-setup, in the workflows setup writes, installs the pnpm
 * version package.json names (`devEngines.packageManager` wins over
 * `packageManager`), and fails when nothing names one. So when neither field
 * is there, this adds `packageManager` set to the pnpm running setup: the
 * version the project was just installed with. One already there is never
 * changed, and setup never guesses a version it can't read.
 */
function pnpmVersionStep(
  pkg: PackageJsonShape,
  userAgent: string | undefined,
): PnpmVersionStep {
  const devEngines = pkg.devEngines;
  const fields: [string, unknown][] = [];
  if (
    typeof devEngines === "object" &&
    devEngines !== null &&
    Object.hasOwn(devEngines, "packageManager")
  ) {
    fields.push([
      "devEngines.packageManager",
      (devEngines as Record<string, unknown>).packageManager,
    ]);
  }
  if (Object.hasOwn(pkg, "packageManager")) {
    fields.push(["packageManager", pkg.packageManager]);
  }
  for (const [field, value] of fields) {
    if (!namesPnpm(field, value)) {
      return { kind: "problem", message: unusablePnpm(field, value) };
    }
  }
  if (fields.length > 0) return { kind: "named" };
  const version = runningPnpmVersion(userAgent);
  if (version === undefined) {
    return {
      kind: "problem",
      message:
        "Couldn't tell which pnpm is running setup, so package.json's " +
        `"packageManager" was left out. The workflows setup writes need it. ` +
        `Fix: run ${RERUN_INIT} again, so pnpm tells setup its version.`,
    };
  }
  return { kind: "added", version };
}

export interface PackageJsonOutcome {
  readonly wrote: boolean;
  readonly conflicts: readonly { name: string; expected: string }[];
  /** Set when package.json exists but isn't a JSON object: the exact fix.
   * Nothing is written in that case. */
  readonly invalid?: string;
  /** The pnpm version this run added as `packageManager`, if it added one. */
  readonly addedPnpm?: string;
  /** Set when the project's pnpm version isn't named and setup couldn't
   * name it: what is wrong and the fix. The run ends non-zero. */
  readonly pnpmProblem?: string;
}

/**
 * Creates a minimal package.json if there isn't one, names it if needed,
 * then adds the `prepare`/`gate` scripts if they're absent. An existing
 * `prepare` script gets temple-bar's command chained after it. Any other
 * script that already exists with different content (or a `prepare` that
 * can't be chained onto) is left untouched; its name and expected line come
 * back in `conflicts` so the caller can report it and end non-zero.
 */
export async function ensurePackageJsonScripts(
  ctx: Context,
  repoRoot: string,
): Promise<PackageJsonOutcome> {
  const filePath = path.join(repoRoot, "package.json");
  const existing = await ctx.fs.readText(filePath);

  let pkg: PackageJsonShape;
  let wrote = false;
  if (existing === undefined) {
    pkg = { private: true };
    wrote = true;
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      parsed = undefined;
    }
    if (!isPackageJsonShape(parsed)) {
      return {
        wrote: false,
        conflicts: [],
        invalid:
          "package.json isn't a valid JSON object, so it was left alone. Fix: " +
          `correct it, then run ${RERUN_INIT} again.`,
      };
    }
    pkg = parsed;
  }

  if (!Object.hasOwn(pkg, "name")) {
    pkg = { name: await repoName(ctx, repoRoot), ...pkg };
    wrote = true;
  }

  const scripts: Record<string, unknown> = { ...pkg.scripts };
  const conflicts: { name: string; expected: string }[] = [];
  let scriptsChanged = false;

  const prepare = scripts.prepare;
  if (prepare === undefined) {
    scripts.prepare = PREPARE_SCRIPT;
    scriptsChanged = true;
  } else if (!isTempleBarPrepare(prepare)) {
    if (typeof prepare === "string" && canChainAfter(prepare)) {
      scripts.prepare = `${prepare.trim()}${CHAIN}`;
      scriptsChanged = true;
    } else {
      conflicts.push({ name: "prepare", expected: PREPARE_SCRIPT });
    }
  }

  const gate = scripts.gate;
  if (gate === undefined) {
    scripts.gate = GATE_SCRIPT;
    scriptsChanged = true;
  } else if (gate !== GATE_SCRIPT) {
    conflicts.push({ name: "gate", expected: GATE_SCRIPT });
  }

  if (wrote || scriptsChanged) {
    pkg.scripts = scripts;
  }
  const pnpm = pnpmVersionStep(pkg, ctx.env.npm_config_user_agent);
  if (pnpm.kind === "added") {
    pkg.packageManager = `pnpm@${pnpm.version}`;
  }
  const changed = wrote || scriptsChanged || pnpm.kind === "added";
  if (changed) {
    await ctx.fs.writeText(filePath, formatLike(existing, pkg));
  }

  return {
    wrote: changed,
    conflicts,
    ...(pnpm.kind === "added" ? { addedPnpm: pnpm.version } : {}),
    ...(pnpm.kind === "problem" ? { pnpmProblem: pnpm.message } : {}),
  };
}

/** Serialises `value` the way `original` was laid out: the same indent (tabs
 * or any number of spaces) and the same final newline, so adding scripts
 * doesn't turn into a whole-file formatting diff. A new file gets two spaces
 * and a final newline. */
function formatLike(original: string | undefined, value: unknown): string {
  const indent = /^([ \t]+)\S/m.exec(original ?? "")?.[1] ?? "  ";
  const finalNewline = original === undefined || original.endsWith("\n");
  return `${JSON.stringify(value, null, indent)}${finalNewline ? "\n" : ""}`;
}
