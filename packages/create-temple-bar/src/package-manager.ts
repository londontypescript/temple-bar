// Detects the caller's package manager from npm_config_user_agent (every
// package manager sets this when it runs a script or `create`/`exec`
// command) and builds the exact command line for each step. Pure and
// side-effect free so it's testable without spawning anything.

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export function detectPackageManager(
  userAgent: string | undefined,
): PackageManager {
  if (userAgent?.startsWith("pnpm/")) {
    return "pnpm";
  }
  if (userAgent?.startsWith("yarn/")) {
    return "yarn";
  }
  if (userAgent?.startsWith("bun/")) {
    return "bun";
  }
  return "npm";
}

export interface CommandLine {
  readonly command: string;
  readonly args: readonly string[];
}

const PACKAGE_NAME = "@londontypescript/temple-bar";

/**
 * Adds `@londontypescript/temple-bar` as a dev dependency, pinned to
 * `version` (the launcher's own version, so both packages stay in lockstep
 * since they're published together).
 */
export function addDevDependencyCommand(
  pm: PackageManager,
  version: string,
): CommandLine {
  const spec = `${PACKAGE_NAME}@${version}`;
  switch (pm) {
    case "pnpm":
      return { command: "pnpm", args: ["add", "-D", spec] };
    case "yarn":
      return { command: "yarn", args: ["add", "-D", spec] };
    case "bun":
      return { command: "bun", args: ["add", "-d", spec] };
    case "npm":
      return { command: "npm", args: ["install", "-D", spec] };
  }
}

/** Runs `temple-bar init` through the same package manager. */
export function runInitCommand(pm: PackageManager): CommandLine {
  switch (pm) {
    case "pnpm":
      return { command: "pnpm", args: ["exec", "temple-bar", "init"] };
    case "yarn":
      return { command: "yarn", args: ["exec", "temple-bar", "init"] };
    case "bun":
      return { command: "bunx", args: ["temple-bar", "init"] };
    case "npm":
      return { command: "npx", args: ["--no-install", "temple-bar", "init"] };
  }
}
