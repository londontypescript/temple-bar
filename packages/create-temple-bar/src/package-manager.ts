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

/**
 * The command every refusal tells the user to run next. It names the
 * launcher's own version, not `@latest`: a rerun then gets the same
 * temple-bar the user started with, and pnpm can hide a version for its
 * first day, so `@latest` may still resolve to the one before.
 */
export function launchCommand(version: string): string {
  return `pnpm create ${PACKAGE_NAME}@${version}`;
}

/** The caller already uses pnpm, so explain the project's conflicting field. */
export function packageManagerRequiredMessage(
  value: string,
  launch: string,
): string {
  return (
    `temple-bar needs pnpm, but package.json has "packageManager": ${JSON.stringify(value)}. Nothing was changed.\n` +
    "\n" +
    'Set packageManager to pnpm, for example "packageManager": "pnpm@10.34.5",\n' +
    "or re-scaffold with your framework's pnpm option.\n" +
    "Then run setup again:\n" +
    `  ${launch}\n`
  );
}

/** The other package managers' lockfiles that `pnpm import` can turn into
 * pnpm-lock.yaml. It can't read bun's. */
const IMPORTABLE_LOCKFILES: readonly string[] = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
];

/**
 * The refusal for a project that another package manager installs. pnpm is
 * already there (it started setup), so installing it again would only lead
 * back here: the project itself has to move to pnpm first. Setup never makes
 * that move for the user, because it changes how the whole project installs,
 * and the user has to check it still works before anything is added on top.
 */
export function foreignLockfileMessage(options: {
  readonly lockfiles: readonly string[];
  readonly packageManager: string | undefined;
  readonly pnpmVersion: string | undefined;
  readonly launch: string;
}): string {
  const { lockfiles, packageManager, pnpmVersion, launch } = options;
  const found = lockfiles.join(" and ");
  const importable = lockfiles.find((name) =>
    IMPORTABLE_LOCKFILES.includes(name),
  );
  const steps = [
    importable === undefined
      ? `Run \`pnpm install\`. pnpm can't read ${found}, so it picks dependency versions afresh.`
      : `Run \`pnpm import\`, which makes pnpm-lock.yaml from ${importable}.`,
    `Delete ${found}.`,
  ];
  if (packageManager !== undefined) {
    steps.push(
      `In package.json, change "packageManager": ${JSON.stringify(packageManager)} to pnpm, for example "packageManager": "pnpm@${pnpmVersion ?? "10.34.5"}".`,
    );
  }
  steps.push(
    "Check the project still installs, builds and tests with pnpm, and commit the switch.",
  );
  return (
    `temple-bar needs pnpm, and this folder has ${lockfiles.length === 1 ? "a " : ""}${found}, which another package manager wrote. Nothing was changed.\n` +
    "\n" +
    "Switch the project to pnpm first. Setup never does this for you:\n" +
    steps.map((step, index) => `  ${String(index + 1)}. ${step}\n`).join("") +
    "More on moving to pnpm: https://pnpm.io/cli/import\n" +
    "\n" +
    "Then run setup again:\n" +
    `  ${launch}\n`
  );
}

/**
 * Adds `@londontypescript/temple-bar` as a dev dependency, pinned to
 * `version` (the launcher's own version, so both packages stay in lockstep
 * since they're published together). Saved exact, not as a `^` range, so a
 * later install can't drift to a newer temple-bar.
 */
export function addDevDependencyCommand(
  version: string,
  atWorkspaceRoot = false,
): CommandLine {
  // pnpm refuses to add to a workspace root unless told it is meant, and
  // refuses `-w` anywhere else, so the flag is passed only at a root.
  return {
    command: "pnpm",
    args: [
      "add",
      atWorkspaceRoot ? "-Dw" : "-D",
      "--save-exact",
      `${PACKAGE_NAME}@${version}`,
    ],
  };
}

/** The command that lists every workspace package with its absolute path. */
export function listPackagesCommand(): CommandLine {
  return {
    command: "pnpm",
    args: ["list", "--recursive", "--depth", "-1", "--json"],
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
 * The refusal shown when setup wasn't started by pnpm. A step to take, not
 * a wall: why, how to install pnpm, and the exact command to run next.
 */
export function pnpmRequiredMessage(launch: string): string {
  return (
    "temple-bar needs pnpm, and this wasn't started with pnpm. Nothing was changed.\n" +
    "\n" +
    "Install pnpm with one command:\n" +
    "  npm install -g pnpm\n" +
    "Other ways to install it: https://pnpm.io/installation\n" +
    "\n" +
    "Then run:\n" +
    `  ${launch}\n`
  );
}
