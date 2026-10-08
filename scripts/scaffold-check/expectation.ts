import {
  FOREIGN_LOCKFILES,
  foreignPackageManager,
  packageManagerRequiredMessage,
  pnpmRequiredMessage,
} from "../../packages/create-temple-bar/src/package-manager.ts";
import { COMPANION_FILES } from "../../packages/temple-bar/src/init/companion-docs.ts";
import {
  PREPARE_SCRIPT,
  GATE_SCRIPT,
} from "../../packages/temple-bar/src/init/package-json.ts";
import { CHECKED_WORKFLOWS } from "../../packages/temple-bar/src/init/workflows.ts";
import {
  JUDGE_WORKFLOW_PATH,
  judgeWorkflow,
} from "../../packages/temple-bar/src/judge/workflow.ts";
import type { Snapshot } from "./snapshot.ts";

export function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function manifest(
  text: string | undefined,
): Record<string, unknown> | undefined {
  try {
    return object(JSON.parse(text ?? ""));
  } catch {
    return undefined;
  }
}

function chainable(value: string): boolean {
  return (
    value.trim() !== "" &&
    !/[#\r\n]/.test(value) &&
    !/[&;|]$/.test(value.trim())
  );
}

/** Predict independently; the shared prepare rule is used only on the written result. */
export function prepareCase(
  scripts: Record<string, unknown>,
): "absent" | "keep" | "chain" | "unknown" {
  if (!Object.hasOwn(scripts, "prepare")) return "absent";
  const value = scripts.prepare;
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  const suffix = ` && ${PREPARE_SCRIPT}`;
  if (
    !/[\r\n]/.test(trimmed) &&
    (trimmed === PREPARE_SCRIPT ||
      (trimmed.endsWith(suffix) && chainable(trimmed.slice(0, -suffix.length))))
  )
    return "keep";
  return chainable(value) ? "chain" : "unknown";
}

export const shippedFiles = [
  ...COMPANION_FILES.filter((file) => file.path !== "CLAUDE.md"),
  { path: JUDGE_WORKFLOW_PATH, content: judgeWorkflow() },
  ...CHECKED_WORKFLOWS,
];

export const agentsLink = (target: string) =>
  ["AGENTS.md", "./AGENTS.md", ".\\AGENTS.md"].includes(target);

export interface Expectation {
  readonly refusal?: string;
  readonly unknown: readonly string[];
}

export function expectation(snapshot: Snapshot): Expectation {
  // Lockfiles take priority, as they do in the launcher.
  const lock = FOREIGN_LOCKFILES.find(
    (name) => name in snapshot.bytes || name in snapshot.symlinks,
  );
  if (lock !== undefined)
    return {
      refusal:
        pnpmRequiredMessage(
          `this folder has a ${lock}, which another package manager wrote`,
        ).split("\n")[0] ?? "",
      unknown: [],
    };
  const foreign = foreignPackageManager(snapshot.files["package.json"]);
  if (foreign !== undefined)
    return {
      refusal: packageManagerRequiredMessage(foreign).split("\n")[0] ?? "",
      unknown: [],
    };
  const unknown: string[] = [];
  const pkg = manifest(snapshot.files["package.json"]);
  if (pkg === undefined)
    unknown.push("package.json is absent or is not a JSON object");
  else {
    const scripts = object(pkg.scripts) ?? {};
    if (prepareCase(scripts) === "unknown")
      unknown.push(
        `scripts.prepare cannot be chained: ${JSON.stringify(scripts.prepare)}`,
      );
    if (scripts.gate !== undefined && scripts.gate !== GATE_SCRIPT)
      unknown.push(
        `scripts.gate already exists: ${JSON.stringify(scripts.gate)}`,
      );
    const dev = object(pkg.devEngines);
    if (dev !== undefined && Object.hasOwn(dev, "packageManager")) {
      const manager = object(dev.packageManager);
      if (
        manager?.name !== "pnpm" ||
        typeof manager.version !== "string" ||
        manager.version.trim() === ""
      )
        unknown.push(
          `devEngines.packageManager does not name pnpm: ${JSON.stringify(dev.packageManager)}`,
        );
    }
    if (
      Object.hasOwn(pkg, "packageManager") &&
      !(
        typeof pkg.packageManager === "string" &&
        /^pnpm@\S+$/.test(pkg.packageManager)
      )
    )
      unknown.push(
        `packageManager does not name a pnpm version: ${JSON.stringify(pkg.packageManager)}`,
      );
  }
  const present = (relative: string) =>
    relative in snapshot.bytes ||
    relative in snapshot.symlinks ||
    snapshot.directories.includes(relative) ||
    relative
      .split("/")
      .slice(0, -1)
      .some(
        (_, index, parts) =>
          parts.slice(0, index + 1).join("/") in snapshot.symlinks,
      );
  for (const file of shippedFiles)
    if (present(file.path)) unknown.push(`${file.path} already exists`);
  const claude = snapshot.symlinks["CLAUDE.md"];
  if (claude !== undefined && !agentsLink(claude))
    unknown.push(`CLAUDE.md links to ${JSON.stringify(claude)}`);
  for (const name of ["AGENTS.md", "package.json", ".gitignore"])
    if (name in snapshot.symlinks) unknown.push(`${name} is a link`);
  return { unknown };
}
