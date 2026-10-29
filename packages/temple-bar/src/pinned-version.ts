// The check that `gate` and `merge` make before anything else: is the
// temple-bar running now the one the checkout's package.json pins? Pulling a
// pin bump doesn't reinstall anything, so a checkout can go on running the
// old version, which once merged a pull request and silently dropped what
// the newer version would have added to its commit message.
//
// Only one exact version is compared, as a plain string: build metadata and
// prerelease tags included, because a different build is a different
// install. A project that pins temple-bar some other way (a range, a tag,
// `workspace:`, an alias) is not checked, since a comparison would be a
// guess; neither is one that doesn't pin it at all, such as a run through
// npx. Nothing is installed by temple-bar: a mismatch stops the command and
// names the install that fixes it.

import path from "node:path";

import type { Context } from "./context.ts";
import { isExactSemver } from "./exact-semver.ts";
import { readOwnVersion } from "./package-info.ts";

const PACKAGE_NAME = "@londontypescript/temple-bar";
const INSTALL_COMMAND = "pnpm install --frozen-lockfile";
const PIN_FIELDS = ["dependencies", "devDependencies"] as const;

type PinField = (typeof PIN_FIELDS)[number];

interface Pin {
  readonly field: PinField;
  readonly version: string;
}

export type PinnedTempleBar =
  /** No field pins temple-bar. */
  | { readonly kind: "none" }
  /** One exact version, or several fields that agree on it. */
  | { readonly kind: "exact"; readonly version: string }
  /** temple-bar is named, but not as one exact version. */
  | { readonly kind: "inexact"; readonly declared: string }
  /** Exact pins that name different versions. */
  | { readonly kind: "conflict"; readonly pins: readonly Pin[] }
  /** The file isn't JSON, or isn't an object, so nothing can be read. */
  | { readonly kind: "unreadable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What package.json text pins for temple-bar. Each field is read on its
 * own, so one of the wrong shape (`"dependencies": null`) hides nothing the
 * other pins. */
export function pinnedTempleBar(packageJson: string): PinnedTempleBar {
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJson);
  } catch {
    return { kind: "unreadable" };
  }
  if (!isRecord(manifest)) {
    return { kind: "unreadable" };
  }
  const named: Pin[] = [];
  for (const field of PIN_FIELDS) {
    const dependencies = manifest[field];
    const version = isRecord(dependencies)
      ? dependencies[PACKAGE_NAME]
      : undefined;
    if (typeof version === "string") {
      named.push({ field, version });
    }
  }
  // As for pnpm's own pin (hooks/pnpm-pin.ts): only exact pins can
  // contradict each other, and an exact one wins over a range beside it.
  const exact = named.filter((pin) => isExactSemver(pin.version));
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
    : { kind: "inexact", declared: declared.version };
}

export type PinCheck =
  /** Go ahead; `note`, when there is one, says what wasn't checked. */
  | { readonly kind: "go"; readonly note?: string }
  /** Stop: nothing else may run. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compares the running temple-bar with the exact version pinned by the
 * package.json in `checkout`. `consequence` finishes a refusal's first line
 * ("so no check ran"). Read afresh on every call: the command may run
 * against a different checkout each time, the gate that merge runs on a
 * pull request's worktree included.
 */
export async function checkPinnedVersion(
  ctx: Context,
  given: string,
  consequence: string,
  running: () => string = readOwnVersion,
): Promise<PinCheck> {
  // One spelling for every path the messages print: git lists a Windows
  // worktree with forward slashes, and path.join would print the manifest
  // with backslashes beside it. Normalised, not resolved, so a path keeps
  // the form it was given in (no drive letter added).
  const checkout = path.normalize(given);
  const manifestPath = path.join(checkout, "package.json");
  let text: string | undefined;
  try {
    text = await ctx.fs.readText(manifestPath);
  } catch (error) {
    // Failing closed: a file that exists but can't be read might pin
    // anything.
    return {
      kind: "refused",
      lines: [
        `${manifestPath} could not be read (${errorText(error)}), so which temple-bar it pins is unknown, and ${consequence}.`,
        "Fix: make it readable, then run this again.",
      ],
    };
  }
  if (text === undefined) {
    return { kind: "go" };
  }

  const pinned = pinnedTempleBar(text);
  switch (pinned.kind) {
    case "none":
      return { kind: "go" };
    case "inexact":
      return {
        kind: "go",
        note: `${manifestPath} asks for temple-bar ${pinned.declared}, not an exact version, so which temple-bar runs wasn't checked`,
      };
    case "unreadable":
      return {
        kind: "refused",
        lines: [
          `${manifestPath} isn't a JSON object, so which temple-bar it pins is unknown, and ${consequence}.`,
          `Fix: repair it, run \`${INSTALL_COMMAND}\` in ${checkout}, then run this again.`,
        ],
      };
    case "conflict":
      return {
        kind: "refused",
        lines: [
          `${manifestPath} pins more than one temple-bar, so ${consequence}:`,
          ...pinned.pins.map(
            (pin) => `  "${pin.field}" pins ${PACKAGE_NAME} ${pin.version}`,
          ),
          `Fix: keep one pin, run \`${INSTALL_COMMAND}\` in ${checkout}, then run this again.`,
        ],
      };
    case "exact":
      break;
  }

  let own: string;
  try {
    own = running();
  } catch (error) {
    return {
      kind: "refused",
      lines: [
        `the running temple-bar could not read its own version (${errorText(error)}), so ${consequence}.`,
        `Fix: run \`${INSTALL_COMMAND}\` in ${checkout}, then run this again.`,
      ],
    };
  }
  if (own === pinned.version) {
    return { kind: "go" };
  }
  return {
    kind: "refused",
    lines: [
      `temple-bar ${own} is running, but ${manifestPath} pins ${pinned.version}, so ${consequence}.`,
      `Fix: run \`${INSTALL_COMMAND}\` in ${checkout}, then run this again.`,
    ],
  };
}
