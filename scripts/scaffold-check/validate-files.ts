import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import {
  freshAgentsMd,
  locateTempleBarBlock,
  templeBarBlock,
} from "../../packages/temple-bar/src/init/agents-template.ts";
import { COMPANION_FILES } from "../../packages/temple-bar/src/init/companion-docs.ts";
import { INSTALLED_SHIMS } from "../../packages/temple-bar/src/gate/core.ts";
import { agentsLink, shippedFiles } from "./expectation.ts";
import type { Snapshot } from "./snapshot.ts";

/** Read ordinary files only: a replacement link must not make preservation appear true. */
export function readOrdinary(
  dir: string,
  relative: string,
): Buffer | undefined {
  try {
    const full = path.join(dir, relative);
    return lstatSync(full).isFile() ? readFileSync(full) : undefined;
  } catch {
    return undefined;
  }
}

function linkAt(dir: string, relative: string): string | undefined {
  try {
    return readlinkSync(path.join(dir, relative));
  } catch {
    return undefined;
  }
}

export function validateFiles(dir: string, snapshot: Snapshot): string[] {
  const findings: string[] = [];
  const text = (relative: string) =>
    readOrdinary(dir, relative)?.toString("utf8");
  const exact = (relative: string, content: string) => {
    if (text(relative) !== content)
      findings.push(`${relative}: expected shipped content`);
  };
  const agents = text("AGENTS.md") ?? "";
  const originalAgents = snapshot.files["AGENTS.md"];
  if (originalAgents === undefined) exact("AGENTS.md", freshAgentsMd());
  else {
    const block = locateTempleBarBlock(agents);
    if (block.kind !== "found" || `${block.block}\n` !== templeBarBlock())
      findings.push(
        "AGENTS.md: expected one complete shipped temple-bar block",
      );
    if (
      block.kind !== "found" ||
      block.before !==
        `${originalAgents}${originalAgents.endsWith("\n") ? "\n" : "\n\n"}`
    )
      findings.push("AGENTS.md: scaffold content changed before the block");
    if (block.kind !== "found" || block.after !== "")
      findings.push("AGENTS.md: content found after the block");
  }
  const claudeLink = snapshot.symlinks["CLAUDE.md"];
  const originalClaude = snapshot.files["CLAUDE.md"];
  if (claudeLink !== undefined && agentsLink(claudeLink)) {
    if (linkAt(dir, "CLAUDE.md") !== claudeLink)
      findings.push("CLAUDE.md: stored AGENTS.md link changed");
    if (
      /^# Claude Code\r?$/m.test(agents) ||
      /^@(?:\.\/)?AGENTS\.md\r?$/m.test(agents)
    )
      findings.push(
        "AGENTS.md: Claude heading or self import written through link",
      );
  } else if (originalClaude === undefined) {
    exact(
      "CLAUDE.md",
      COMPANION_FILES.find((file) => file.path === "CLAUDE.md")?.content ?? "",
    );
  } else {
    const actual = text("CLAUDE.md") ?? "";
    const start = /^#\s/.test(originalClaude.split(/\r?\n/)[0] ?? "")
      ? originalClaude
      : `# Claude Code\n\n${originalClaude}`;
    if (!actual.startsWith(start))
      findings.push(
        "CLAUDE.md: scaffold content was not kept whole at the start",
      );
    if (!/^@(?:\.\/)?AGENTS\.md\r?$/m.test(actual))
      findings.push("CLAUDE.md: missing AGENTS.md import line");
  }
  for (const file of shippedFiles) {
    if (!(file.path in snapshot.bytes) && !(file.path in snapshot.symlinks))
      exact(file.path, file.content);
  }
  const changedBySetup = new Set([
    "package.json",
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    "pnpm-lock.yaml",
    ...shippedFiles.map((file) => file.path),
  ]);
  for (const [relative, before] of Object.entries(snapshot.bytes)) {
    if (
      !changedBySetup.has(relative) &&
      readOrdinary(dir, relative)?.toString("base64") !== before
    )
      findings.push(`${relative}: scaffold bytes changed`);
  }
  const ignored = snapshot.bytes[".gitignore"];
  if (ignored !== undefined) {
    const before = Buffer.from(ignored, "base64");
    if (
      !readOrdinary(dir, ".gitignore")
        ?.subarray(0, before.length)
        .equals(before)
    )
      findings.push(".gitignore: scaffold bytes changed at the start");
  }
  for (const [relative, target] of Object.entries(snapshot.symlinks)) {
    if (relative !== "CLAUDE.md" && linkAt(dir, relative) !== target)
      findings.push(`${relative}: scaffold link changed`);
  }
  for (const [name, content] of Object.entries(INSTALLED_SHIMS))
    exact(`.git/hooks/${name}`, content);
  return findings;
}
