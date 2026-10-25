// The files setup writes beside AGENTS.md, each only where the project has
// none: AGENTS.md links to them, so they have to exist, but once there they
// are the project's to edit. The exception is CLAUDE.md, which setup also
// adds to (see fixClaudeMd). Like AGENTS.md, they are written for any
// project, not for temple-bar itself. The longer texts live in their own
// modules: the rationale, and the guides the block links to.

import {
  DELEGATION,
  INCIDENTS,
  PHASE_BOUNDARIES,
  PLANNING,
  PULL_REQUESTS,
} from "./companion-guides.ts";
import { RATIONALE } from "./companion-rationale.ts";

/** Claude Code reads CLAUDE.md, and falls back to AGENTS.md only in recent
 * versions, with the fallback switched on, and not on every cloud provider.
 * An import works in all of them. The heading identifies the instructions
 * when a reader opens the file. */
export const CLAUDE_MD_PATH = "CLAUDE.md";
const CLAUDE_HEADING = "# Claude Code";
const AGENTS_IMPORT = "@AGENTS.md";
const CLAUDE_MD = `${CLAUDE_HEADING}\n\n${AGENTS_IMPORT}\n`;

/** A home for stack conventions that every tool reads, without growing
 * AGENTS.md past its limits. Setup can't know the stack, so it starts
 * empty. */
const CONVENTIONS = `# Conventions

This project's stack conventions: the framework and libraries it uses, and
the patterns to follow with them. Every agent reads this file before writing
code, whatever tool it runs in.

Add a convention when the user settles one, in a line or two, with the
reason where it isn't obvious. Keep rules about how work is done in
AGENTS.md; this file is about the code.

None yet.
`;

/** AGENTS.md asks for an ADR whenever a choice is replaced; this gives the
 * project the same three sections temple-bar's own ADRs use. */
const ADR_TEMPLATE = `# ADR 0000: Title of the decision

Date: YYYY-MM-DD. Status: proposed, accepted, or superseded by a later ADR.

Copy this file to the next free number, with a short name after it, and
replace each section. An ADR records a choice that shapes the project, and
why, so nobody has to rediscover the reason. When a choice is replaced,
write a new ADR and say there what ended the old one.

## Context

What made a decision necessary: the problem, the constraints, and the
options weighed.

## Decision

What was decided, in plain words, and why this option over the others.

## What would end it

The condition that would make this decision wrong: what would have to
change for someone to replace it.
`;

export interface CompanionFile {
  /** Relative to the repo root, with forward slashes. */
  readonly path: string;
  readonly content: string;
}

/** Every file setup writes beside AGENTS.md, if missing. */
export const COMPANION_FILES: readonly CompanionFile[] = [
  { path: CLAUDE_MD_PATH, content: CLAUDE_MD },
  { path: "docs/agents-rationale.md", content: RATIONALE },
  { path: "docs/phase-boundaries.md", content: PHASE_BOUNDARIES },
  { path: "docs/planning.md", content: PLANNING },
  { path: "docs/pull-requests.md", content: PULL_REQUESTS },
  { path: "docs/delegation.md", content: DELEGATION },
  { path: "docs/incidents.md", content: INCIDENTS },
  { path: "docs/conventions.md", content: CONVENTIONS },
  { path: "docs/adr/0000-template.md", content: ADR_TEMPLATE },
];

export interface ClaudeMdFix {
  readonly content: string;
  /** What was added, in words for the user. */
  readonly added: readonly string[];
}

/**
 * What an existing CLAUDE.md, written by the project or a framework (Next.js
 * ships a one-line `@AGENTS.md`), needs added: a heading at the top to
 * identify the instructions, and the AGENTS.md import,
 * without which Claude Code may never read the rules. Nothing is removed or
 * reordered. Returns undefined when nothing is missing, so a second run
 * changes nothing.
 */
export function fixClaudeMd(existing: string): ClaudeMdFix | undefined {
  if (existing.trim() === "") {
    return { content: CLAUDE_MD, added: ["a heading", "the AGENTS.md import"] };
  }
  const lines = existing.split(/\r?\n/);
  const hasHeading = /^#\s/.test(lines[0] ?? "");
  const importsAgents = lines.some((line) =>
    [AGENTS_IMPORT, "@./AGENTS.md"].includes(line.trim()),
  );
  if (hasHeading && importsAgents) {
    return undefined;
  }
  let content = existing;
  const added: string[] = [];
  if (!hasHeading) {
    content = `${CLAUDE_HEADING}\n\n${content}`;
    added.push("a heading");
  }
  if (!importsAgents) {
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    content = `${content}${separator}${AGENTS_IMPORT}\n`;
    added.push("the AGENTS.md import");
  }
  return { content, added };
}
