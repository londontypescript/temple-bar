// Drafts GitHub Release notes for a tag from the conventional commit subjects
// on main since the previous tag (decision 24). The release workflow runs it:
//
//   node scripts/release-notes.ts v0.0.4 > notes.md
//
// The result is a draft for a maintainer to edit (upgrade notes, incidents
// fixed) before publishing, so it groups and tidies but never invents text.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUBJECT =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<text>.+)$/;

/** Version bumps say nothing a reader needs. */
const SKIPPED_PREFIX = "chore(release):";

interface Section {
  readonly title: string;
  readonly lines: string[];
}

function formatLine(scope: string | undefined, text: string): string {
  return scope === undefined ? `- ${text}` : `- **${scope}:** ${text}`;
}

/** Markdown notes from commit subjects, newest first as `git log` gives them. */
export function buildReleaseNotes(subjects: readonly string[]): string {
  const breaking: Section = { title: "Breaking changes", lines: [] };
  const features: Section = { title: "Features", lines: [] };
  const fixes: Section = { title: "Fixes", lines: [] };
  const other: Section = { title: "Other changes", lines: [] };

  for (const subject of subjects) {
    if (subject.trim() === "" || subject.startsWith(SKIPPED_PREFIX)) {
      continue;
    }
    const match = SUBJECT.exec(subject);
    if (match?.groups === undefined) {
      other.lines.push(`- ${subject}`);
      continue;
    }
    const { type, scope, breaking: bang, text } = match.groups;
    const line = formatLine(scope, text ?? subject);
    if (bang !== undefined) {
      breaking.lines.push(line);
    } else if (type === "feat") {
      features.lines.push(line);
    } else if (type === "fix") {
      fixes.lines.push(line);
    } else {
      other.lines.push(line);
    }
  }

  const sections = [breaking, features, fixes, other].filter(
    (section) => section.lines.length > 0,
  );
  const body =
    sections.length === 0
      ? "No changes since the previous release."
      : sections
          .map(
            (section) => `## ${section.title}\n\n${section.lines.join("\n")}`,
          )
          .join("\n\n");
  return `${body}\n\n<!-- Draft from conventional commits. Add upgrade notes and the incidents this release fixes before publishing. -->\n`;
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** The tag before `tag`, or undefined for the first release. */
function previousTag(tag: string): string | undefined {
  try {
    return git(["describe", "--tags", "--abbrev=0", `${tag}^`]);
  } catch {
    return undefined;
  }
}

function main(tag: string | undefined): void {
  if (tag === undefined) {
    process.stderr.write("usage: node scripts/release-notes.ts <tag>\n");
    process.exitCode = 2;
    return;
  }
  const previous = previousTag(tag);
  const range = previous === undefined ? tag : `${previous}..${tag}`;
  const log = git(["log", "--first-parent", "--format=%s", range]);
  process.stdout.write(buildReleaseNotes(log.split("\n")));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv[2]);
}
