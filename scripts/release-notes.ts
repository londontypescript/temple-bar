// Drafts GitHub Release notes for a tag from the conventional commit subjects
// on main since the previous tag. The release workflow runs it:
//
//   node scripts/release-notes.ts v0.0.4 > notes.md
//
// The result is a draft for a maintainer to edit before publishing, so it
// groups and tidies but never invents text. What commits can't say gets a
// heading of its own: Upgrading starts with the routine upgrade command and a
// placeholder for any extra steps, and Incidents fixed starts empty. A
// reminder comment ends the draft. Release 0.0.7 went out with neither
// section written, so `release:publish` checks the draft with
// `unfinishedNotes` below and refuses until both are filled in.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUBJECT =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<text>.+)$/;

const UPGRADING = "Upgrading";
const INCIDENTS = "Incidents fixed";

/** What finishing each hand-written section takes, said when it's empty. */
const HAND_WRITTEN_SECTIONS: Readonly<Record<string, string>> = {
  [UPGRADING]: `Put back the upgrade command, then list any extra steps repos already using temple-bar must take, or write "No other steps."`,
  [INCIDENTS]: `List the incident issues this release fixes, or write "None".`,
};

/** Stands under the upgrade command until the maintainer has decided whether
 * this release needs more than it. The command alone doesn't finish the
 * section: most releases need nothing else, but some (0.0.7) do. */
export const UPGRADE_PLACEHOLDER =
  '<!-- Extra upgrade steps, or "No other steps." -->';

/** The draft ends with this, hidden in a comment, until the notes are done. */
export const REMINDER =
  "Add upgrade notes and the incidents this release fixes before publishing.";

/** Version bumps say nothing a reader needs. */
const SKIPPED_PREFIX = "chore(release):";

interface Section {
  readonly title: string;
  readonly lines: string[];
}

function formatLine(scope: string | undefined, text: string): string {
  return scope === undefined ? `- ${text}` : `- **${scope}:** ${text}`;
}

/** The routine upgrade: the same pinned install setup itself runs. */
function upgradeCommand(tag: string): string {
  const version = tag.replace(/^v/, "");
  return [
    "```bash",
    `pnpm add -D --save-exact @londontypescript/temple-bar@${version}`,
    "```",
  ].join("\n");
}

/** Markdown notes for `tag` from commit subjects, newest first as `git log`
 * gives them. */
export function buildReleaseNotes(
  subjects: readonly string[],
  tag: string,
): string {
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
  const handWritten = [
    `## ${UPGRADING}`,
    upgradeCommand(tag),
    UPGRADE_PLACEHOLDER,
    `## ${INCIDENTS}`,
  ].join("\n\n");
  return `${body}\n\n${handWritten}\n\n<!-- Draft from conventional commits. ${REMINDER} -->\n`;
}

/** What a section holds once comments are dropped, or undefined when the
 * notes have no `## <title>` heading. The section runs to the next heading of
 * the same or a higher level, so `###` subheadings stay inside it. A comment
 * left unclosed hides the rest of the section, as GitHub renders it, so
 * nothing after it counts as written. */
function sectionText(notes: string, title: string): string | undefined {
  const lines = notes.split("\n");
  const start = lines.findIndex(
    (line) => /^##\s/.test(line) && line.slice(2).trim() === title,
  );
  if (start === -1) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  const content = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  return content.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim();
}

/** Each thing still to do before release notes can be published, in words
 * the maintainer can act on; empty once the notes are finished. */
export function unfinishedNotes(notes: string): string[] {
  // GitHub's web editor saves Windows line endings.
  const text = notes.replaceAll("\r\n", "\n");
  const problems: string[] = [];
  if (text.includes(REMINDER)) {
    problems.push(
      `The reminder comment is still in the notes ("${REMINDER}"). Delete it once the notes are written.`,
    );
  }
  if (text.includes(UPGRADE_PLACEHOLDER)) {
    problems.push(
      `The "## ${UPGRADING}" section still has its placeholder (${UPGRADE_PLACEHOLDER}). Replace it with the extra steps repos already using temple-bar must take, or with "No other steps."`,
    );
  }
  for (const [title, howToFinish] of Object.entries(HAND_WRITTEN_SECTIONS)) {
    const content = sectionText(text, title);
    if (content === undefined) {
      problems.push(
        `The "## ${title}" heading is missing. Put it back. ${howToFinish}`,
      );
    } else if (content === "") {
      problems.push(`The "## ${title}" section is empty. ${howToFinish}`);
    }
  }
  return problems;
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
  process.stdout.write(buildReleaseNotes(log.split("\n"), tag));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv[2]);
}
