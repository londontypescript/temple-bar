// temple-bar supports pnpm only. This file decides whether the launcher was
// started by pnpm, lists the lockfiles that show another package manager, and
// builds the exact command line for each step. Pure and side-effect free so
// it's testable without spawning anything.

/** True when pnpm started this run. Every package manager sets
 * npm_config_user_agent when it runs a `create` or `exec` command. */
export function isLaunchedByPnpm(userAgent: string | undefined): boolean {
  return userAgent?.startsWith("pnpm/") ?? false;
}

/** The package.json `packageManager` value when it names a manager other
 * than pnpm, so setup can explain the field before `pnpm add` fails on it;
 * otherwise undefined. Only a non-empty string names a manager (pnpm itself
 * accepts an empty one), and a malformed package.json is left to the install
 * step, which reports it. */
export function foreignPackageManager(
  packageJson: string | undefined,
): string | undefined {
  if (packageJson === undefined) {
    return undefined;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJson);
  } catch {
    return undefined;
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("packageManager" in manifest)
  ) {
    return undefined;
  }
  const value: unknown = manifest.packageManager;
  return typeof value === "string" &&
    value !== "" &&
    value.split("@")[0] !== "pnpm"
    ? value
    : undefined;
}

/** Lockfiles that show a repo installs with something other than pnpm. */
export const FOREIGN_LOCKFILES: readonly string[] = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
];

export interface CommandLine {
  readonly command: string;
  readonly args: readonly string[];
}

const PACKAGE_NAME = "@londontypescript/temple-bar";

/** The one command setup is run with, and the one every message prints. */
const LAUNCH_COMMAND = "pnpm create @londontypescript/temple-bar@latest";

/** The caller already uses pnpm, so explain the project's conflicting field. */
export function packageManagerRequiredMessage(value: string): string {
  return (
    `temple-bar needs pnpm, but package.json has "packageManager": ${JSON.stringify(value)}. Nothing was changed.\n` +
    "\n" +
    'Set packageManager to pnpm, for example "packageManager": "pnpm@10.34.5",\n' +
    "or re-scaffold with your framework's pnpm option.\n" +
    "Then run setup again:\n" +
    `  ${LAUNCH_COMMAND}\n`
  );
}

/**
 * Adds `@londontypescript/temple-bar` as a dev dependency, pinned to
 * `version` (the launcher's own version, so both packages stay in lockstep
 * since they're published together). Saved exact, not as a `^` range, so a
 * later install can't drift to a newer temple-bar.
 */
export function addDevDependencyCommand(version: string): CommandLine {
  return {
    command: "pnpm",
    args: ["add", "-D", "--save-exact", `${PACKAGE_NAME}@${version}`],
  };
}

/** Finish normal installation without rewriting the lockfile just produced
 * by add. pnpm owns project lifecycle scripts and workspace install scope. */
export function installCommand(): CommandLine {
  return { command: "pnpm", args: ["install", "--frozen-lockfile"] };
}

/** The only flags passed on to init: each carries the user's yes to one
 * question. Anything else is dropped, so the launcher never hands arbitrary
 * arguments to `pnpm exec`. */
const INIT_FLAGS: readonly string[] = ["--create-repo", "--create-ruleset"];

/** Runs `temple-bar init`, which isn't on PATH, from the project's copy,
 * passing on the answers an agent got from the user. */
export function runInitCommand(argv: readonly string[] = []): CommandLine {
  return {
    command: "pnpm",
    args: [
      "exec",
      "temple-bar",
      "init",
      ...INIT_FLAGS.filter((flag) => argv.includes(flag)),
    ],
  };
}

/**
 * The refusal shown when setup isn't running under pnpm. A step to take, not
 * a wall: why, how to install pnpm, and the exact command to run next.
 * `reason` says what was seen (how it was launched, or which lockfile).
 */
export function pnpmRequiredMessage(reason: string): string {
  return (
    `temple-bar needs pnpm, and ${reason}. Nothing was changed.\n` +
    "\n" +
    "Install pnpm with one command:\n" +
    "  npm install -g pnpm\n" +
    "Other ways to install it: https://pnpm.io/installation\n" +
    "\n" +
    "Then run:\n" +
    `  ${LAUNCH_COMMAND}\n`
  );
}
