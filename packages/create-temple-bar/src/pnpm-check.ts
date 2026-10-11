// The launcher's check that the pnpm it is about to change a project with is
// the pnpm the user meant. A child `pnpm` is found through PATH again, and
// can be an older pnpm than the one that started setup; pnpm 8 can neither
// switch itself to a project's pinned version nor read a newer lockfile.
// With a pin in package.json the child is compared with that; without one
// (the usual brand-new project: init writes the pin later) with the pnpm
// that started setup, read from the user agent. Reads only. This is a small
// copy of the idea in temple-bar's hooks/pnpm-check.ts, since the launcher
// can't import from that package.

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
  | { readonly kind: "conflict"; readonly a: string; readonly b: string };

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
  const fromField =
    typeof field === "string" && field.startsWith("pnpm@")
      ? withoutSuffix(field.slice("pnpm@".length))
      : undefined;
  let fromEngines: string | undefined;
  const devEngines = manifest.devEngines;
  if (isRecord(devEngines)) {
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
        fromEngines = withoutSuffix(entry.version.trim());
        break;
      }
    }
  }
  const exactField =
    fromField !== undefined && EXACT.test(fromField) ? fromField : undefined;
  const exactEngines =
    fromEngines !== undefined && EXACT.test(fromEngines)
      ? fromEngines
      : undefined;
  if (
    exactField !== undefined &&
    exactEngines !== undefined &&
    exactField !== exactEngines
  ) {
    return { kind: "conflict", a: exactField, b: exactEngines };
  }
  const exact = exactField ?? exactEngines;
  if (exact !== undefined) {
    return { kind: "exact", version: exact };
  }
  const declared = fromEngines ?? fromField;
  return declared === undefined
    ? { kind: "none" }
    : { kind: "range", declared };
}

/** The version of the pnpm that started setup, from its user agent. */
function startedWith(userAgent: string | undefined): string | undefined {
  return /^pnpm\/(\S+) /.exec(userAgent ?? "")?.[1];
}

const FIX =
  "Fix: give the tool that ran this command (your terminal, editor or desktop app) a pnpm 9.7 or newer, which switches itself to the pinned version, or the pinned version itself. A desktop app has to be restarted to pick up a new PATH.";

export async function checkChildPnpm(
  packageJson: string | undefined,
  userAgent: string | undefined,
  run: ProcessRunner,
  options: RunOptions,
): Promise<PnpmCheck> {
  const pin = pinnedPnpm(packageJson);
  if (pin.kind === "conflict") {
    return {
      refusal:
        `package.json contradicts itself: "packageManager" pins pnpm ${pin.a} but "devEngines.packageManager" pins pnpm ${pin.b}. Nothing was changed.\n` +
        "Fix: make the two name the same pnpm version, or remove one.\n",
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
  return {
    refusal:
      `the pnpm that setup would run is not the one it should be. Nothing was changed.\n` +
      `  ${source} pnpm ${expected}\n` +
      `  ${what}\n` +
      `${FIX}\n`,
  };
}
