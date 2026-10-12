// The launcher's check that the pnpm it is about to change a project with is
// the pnpm the user meant. A child `pnpm` is found through PATH again, and
// can be an older pnpm than the one that started setup; pnpm 8 can neither
// switch itself to a project's pinned version nor read a newer lockfile.
// With a pin in package.json the child is compared with that; without one
// (the usual brand-new project: init writes the pin later) with the pnpm
// that started setup, read from the user agent. Reads only. This is a small
// copy of the idea in temple-bar's hooks/pnpm-check.ts, since the launcher
// can't import from that package.

import path from "node:path";

import type { ProcessRunner, RunOptions } from "./runner.ts";

export interface PnpmCheck {
  /** Printed to standard output and setup goes on. */
  readonly note?: string;
  /** Printed to standard error and setup stops, having changed nothing. */
  readonly refusal?: string;
}

type Pin =
  | { readonly kind: "none" }
  | { readonly kind: "exact"; readonly version: string }
  | { readonly kind: "range"; readonly declared: string }
  | { readonly kind: "conflict"; readonly pins: readonly Named[] };

interface Named {
  readonly field: string;
  readonly version: string;
}

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function withoutSuffix(version: string): string {
  const plus = version.indexOf("+");
  return plus === -1 ? version : version.slice(0, plus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The pnpm version package.json pins, in `packageManager` or
 * `devEngines.packageManager`. */
function pinnedPnpm(packageJson: string | undefined): Pin {
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJson ?? "");
  } catch {
    return { kind: "none" };
  }
  if (!isRecord(manifest)) {
    return { kind: "none" };
  }
  const field = manifest.packageManager;
  const named: Named[] = [];
  const devEngines = manifest.devEngines;
  if (isRecord(devEngines)) {
    // One object or a list of them; every pnpm entry counts.
    const entries: unknown[] = Array.isArray(devEngines.packageManager)
      ? devEngines.packageManager
      : [devEngines.packageManager];
    for (const entry of entries) {
      if (
        isRecord(entry) &&
        entry.name === "pnpm" &&
        typeof entry.version === "string" &&
        entry.version.trim() !== ""
      ) {
        named.push({
          field: "devEngines.packageManager",
          version: withoutSuffix(entry.version.trim()),
        });
      }
    }
  }
  if (typeof field === "string" && field.startsWith("pnpm@")) {
    named.push({
      field: "packageManager",
      version: withoutSuffix(field.slice("pnpm@".length)),
    });
  }
  const exact = named.filter((pin) => EXACT.test(pin.version));
  if (new Set(exact.map((pin) => pin.version)).size > 1) {
    return { kind: "conflict", pins: exact };
  }
  const [first] = exact;
  if (first !== undefined) {
    return { kind: "exact", version: first.version };
  }
  const [declared] = named;
  return declared === undefined
    ? { kind: "none" }
    : { kind: "range", declared: declared.version };
}

/** The version of the pnpm that started setup, from its user agent. */
export function startedWith(userAgent: string | undefined): string | undefined {
  return /^pnpm\/(\S+) /.exec(userAgent ?? "")?.[1];
}

const RESTART = "A desktop app has to be restarted to pick up a new PATH.";

/** The fix for a wrong child pnpm. With a pin, any pnpm that switches itself
 * to it will do; without one, only the very pnpm that started setup, since
 * that is the version init will record. */
function fixFor(pinned: boolean, expected: string): string {
  return pinned
    ? `Fix: give the tool that ran this command (your terminal, editor or desktop app) a pnpm 9.7 or newer, which switches itself to the pinned version, or the pinned version itself. ${RESTART}`
    : `Fix: give the tool that ran this command (your terminal, editor or desktop app) pnpm ${expected} first on its PATH, the same pnpm that started setup. ${RESTART}`;
}

/** The first `pnpm` on the child's PATH, resolved to its real file, which is
 * what a plain `pnpm` probably runs. `realPath` rejects a missing file. */
async function firstPnpmOnPath(
  env: NodeJS.ProcessEnv,
  realPath: (filePath: string) => Promise<string>,
): Promise<string | undefined> {
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const dirs = (key === undefined ? "" : (env[key] ?? ""))
    .split(path.delimiter)
    .filter((dir) => dir !== "");
  const names =
    process.platform === "win32"
      ? ["pnpm.cmd", "pnpm.exe", "pnpm.bat"]
      : ["pnpm"];
  for (const dir of dirs) {
    for (const name of names) {
      try {
        return await realPath(path.join(dir, name));
      } catch {
        // Not here; try the next one.
      }
    }
  }
  return undefined;
}

export async function checkChildPnpm(
  packageJson: string | undefined,
  userAgent: string | undefined,
  run: ProcessRunner,
  options: RunOptions,
  realPath: (filePath: string) => Promise<string>,
): Promise<PnpmCheck> {
  const pin = pinnedPnpm(packageJson);
  if (pin.kind === "conflict") {
    return {
      refusal:
        "package.json contradicts itself. Nothing was changed.\n" +
        pin.pins
          .map((named) => `  "${named.field}" pins pnpm ${named.version}\n`)
          .join("") +
        "Fix: make them all name the same pnpm version, or keep only one.\n",
    };
  }
  if (pin.kind === "range") {
    return {
      note: `package.json asks for pnpm ${pin.declared}, not an exact version, so which pnpm sets up wasn't checked.\n`,
    };
  }
  const expected = pin.kind === "exact" ? pin.version : startedWith(userAgent);
  if (expected === undefined) {
    return {
      note: "Couldn't tell which pnpm started setup, so the pnpm it runs wasn't checked.\n",
    };
  }
  const source =
    pin.kind === "exact"
      ? "package.json pins"
      : "the pnpm that started setup is";

  const answer = await run("pnpm", ["--version"], {
    ...options,
    capture: true,
  });
  const found = (answer.stdout ?? "").trim();
  if (answer.code === 0 && found === expected) {
    return {};
  }
  const what =
    answer.code === 0
      ? `\`pnpm --version\` found ${found}`
      : `\`pnpm --version\` failed (exit ${String(answer.code)}; any error from pnpm is shown above)`;
  const where = await firstPnpmOnPath(options.env, realPath);
  return {
    refusal:
      `the pnpm that setup would run is not the one it should be. Nothing was changed.\n` +
      `  ${source} pnpm ${expected}\n` +
      `  ${what}\n` +
      `  that pnpm is at: ${where === undefined ? "not found (no pnpm on PATH)" : `${where} (probably: the first pnpm on PATH)`}\n` +
      `  in: ${options.cwd}\n` +
      `${fixFor(pin.kind === "exact", expected)}\n`,
  };
}
