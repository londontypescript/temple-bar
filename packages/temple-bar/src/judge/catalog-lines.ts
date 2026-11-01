// The catalog grammar's rules over a whole side of the root
// pnpm-workspace.yaml: the characters it may hold, the four regions it
// splits into, and the shapes and words allowed outside the catalog. Each
// check names the first rule that fails, in the words the findings use.
// The grammar is text, never YAML: it admits only lines whose meaning no
// YAML reader can dispute, enough to prove the marker is a root key of the
// one document pnpm reads. See "The catalog grammar" in
// docs/adr/0015-every-package-checked-and-guarded.md.
//
// Pure, like the rest of the comparison.

/** Which side a reason is about, in the findings' words. */
export type Side = "on the base branch" | "here";

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export const fail = (reason: string): { ok: false; reason: string } => ({
  ok: false,
  reason,
});

/** One side split at its marker. Line numbers count from 1. */
export interface Regions {
  readonly prefix: readonly string[];
  readonly body: readonly string[];
  readonly suffix: readonly string[];
  /** The line number of the body's first line. */
  readonly bodyStart: number;
  /** The line number of the suffix's first line. */
  readonly suffixStart: number;
}

const MARKER = "catalog:";

/** What a character the grammar refuses anywhere is called, or undefined
 * for one it allows. A carriage return or a tab changes what YAML reads as
 * a line or an indent; a backslash spells a character another way inside
 * double quotes; `$` is how pnpm reads an environment variable or another
 * package's version; the rest are line breaks or invisible to a reader. */
function refusedCharacter(code: number): string | undefined {
  switch (code) {
    case 0x0a:
      return undefined;
    case 0x0d:
      return "a carriage return";
    case 0x09:
      return "a tab";
    case 0x5c:
      return "a backslash";
    case 0x24:
      return "a $";
    case 0xfeff:
      return "a byte order mark (U+FEFF)";
    case 0x2028:
      return "a line separator (U+2028)";
    case 0x2029:
      return "a paragraph separator (U+2029)";
  }
  // C1 counts as well as C0: YAML 1.1 reads U+0085 as a line break.
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
    ? `a control character (U+${code.toString(16).toUpperCase().padStart(4, "0")})`
    : undefined;
}

/** The first character the grammar refuses anywhere in the text. */
export function characterProblem(text: string, side: Side): string | undefined {
  let line = 1;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x0a) {
      line++;
      continue;
    }
    const name = refusedCharacter(code);
    if (name !== undefined) {
      return `file shape: ${name} on line ${String(line)} ${side}`;
    }
  }
  return undefined;
}

function listed(numbers: readonly number[]): string {
  const words = numbers.map(String);
  const last = words.pop() ?? "";
  return words.length === 0 ? last : `${words.join(", ")} and ${last}`;
}

/** A body line: empty, or led by a space or `#`. The first line that is
 * neither starts the suffix, so a body that reaches the end of the file
 * takes the final empty line with it. */
const inBody = (line: string): boolean =>
  line === "" || line.startsWith(" ") || line.startsWith("#");

/** The side's lines split at the one line that is exactly `catalog:`. */
export function splitRegions(
  lines: readonly string[],
  side: Side,
): Checked<Regions> {
  const markers = lines.flatMap((line, index) =>
    line === MARKER ? [index + 1] : [],
  );
  const [marker, ...others] = markers;
  if (marker === undefined) {
    return fail(`one marker: no line ${side} is exactly "${MARKER}"`);
  }
  if (others.length > 0) {
    return fail(
      `one marker: "${MARKER}" is on lines ${listed(markers)} ${side}`,
    );
  }
  let end = marker;
  while (end < lines.length && inBody(lines[end] ?? "")) {
    end++;
  }
  return {
    ok: true,
    value: {
      prefix: lines.slice(0, marker - 1),
      body: lines.slice(marker, end),
      suffix: lines.slice(end),
      bodyStart: marker + 1,
      suffixStart: end + 1,
    },
  };
}

/** The first index where the two lists of lines differ, if they do. */
function firstDifference(
  before: readonly string[],
  after: readonly string[],
): number | undefined {
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index++) {
    if (before[index] !== after[index]) {
      return index;
    }
  }
  return undefined;
}

/** The prefix and the suffix must be the same on both sides, byte for
 * byte: the catalog is the only thing allowed to change. */
export function outsideProblem(
  base: Regions,
  head: Regions,
): string | undefined {
  const before = firstDifference(base.prefix, head.prefix);
  if (before !== undefined) {
    return `changed outside the catalog: line ${String(before + 1)}, before the catalog, differs`;
  }
  const after = firstDifference(base.suffix, head.suffix);
  return after === undefined
    ? undefined
    : `changed outside the catalog: the text after the catalog differs from line ${String(head.suffixStart + after)} here`;
}

// The only YAML lines allowed outside the catalog. A quoted scalar holds no
// quote of either kind (and, with no backslash anywhere, no escape), so it
// ends on its own line. A plain value starts with a character that can't
// open anything (an anchor, alias, tag, block scalar, flow collection or
// explicit key) and holds no `: ` that could start a mapping. Brackets,
// braces and quotes appear nowhere else outside a comment.
const QUOTED = `'[^'"]*'|"[^'"]*"`;
const KEY = `(?:[A-Za-z0-9_.-]+|${QUOTED})`;
const PLAIN = `[A-Za-z0-9_./](?:(?!: )[A-Za-z0-9 ._/*,+=~^:()-])*`;
const VALUE = `(?:${PLAIN}|${QUOTED})`;
const TRAILING_COMMENT = `(?: #.*)?`;
const KEY_LINE = new RegExp(
  `^ *(?:- )?${KEY}:(?: ${VALUE})?${TRAILING_COMMENT}$`,
);
// A value alone only after `- ` or an indent: at column 0 a plain scalar
// could be read as carrying on the line before it.
const VALUE_LINE = new RegExp(`^(?: *- | +)${VALUE}${TRAILING_COMMENT}$`);
const COMMENT_LINE = /^ *#/;

const isQuiet = (line: string): boolean =>
  line === "" || COMMENT_LINE.test(line);

const isShaped = (line: string): boolean =>
  isQuiet(line) || KEY_LINE.test(line) || VALUE_LINE.test(line);

/** The first line outside the catalog whose shape the grammar doesn't
 * know. `---` may open the document, as the prefix's first line that is
 * neither empty nor a comment, and nowhere else. */
export function lineShapeProblem(
  regions: Regions,
  side: Side,
): string | undefined {
  let opening = true;
  for (const [index, line] of regions.prefix.entries()) {
    if (isQuiet(line)) {
      continue;
    }
    const opens = opening && line === "---";
    opening = false;
    if (!opens && !isShaped(line)) {
      return `line shape: line ${String(index + 1)} ${side}`;
    }
  }
  for (const [index, line] of regions.suffix.entries()) {
    if (!isShaped(line)) {
      return `line shape: line ${String(regions.suffixStart + index)} ${side}`;
    }
  }
  return undefined;
}

/** Letters folded to lowercase, ASCII only, so every index still points
 * at the same character. pnpm reads these names exactly, in ASCII. */
const asciiLower = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** `catalog` followed by anything but an ASCII letter: a second spelling
 * of the section, or a `catalog:` reference that maps the catalog onto
 * something else. `catalogs:` and `catalogMode:` are allowed. */
function namesTheCatalog(lower: string): boolean {
  for (const found of lower.matchAll(/catalog/g)) {
    if (!/^[a-z]$/.test(lower[found.index + "catalog".length] ?? "")) {
      return true;
    }
  }
  return false;
}

/** A word outside the catalog that lets the catalog reach temple-bar's
 * install, or code run there, in any letter case. With the shapes above
 * and no backslash, YAML can't spell these words any other way, so a text
 * search finds every spelling. Comments count too. Run on the head only:
 * by now both sides hold the same lines here. */
export function keywordProblem(regions: Regions): string | undefined {
  const numbered = [
    ...regions.prefix.map((line, index) => [index + 1, line] as const),
    ...regions.suffix.map(
      (line, index) => [regions.suffixStart + index, line] as const,
    ),
  ];
  for (const [number, line] of numbered) {
    const lower = asciiLower(line);
    const where = `line ${String(number)} here`;
    if (namesTheCatalog(lower)) {
      return `"catalog" outside the body: ${where}`;
    }
    if (lower.includes("pnpmfile")) {
      return `"pnpmfile" outside the body: ${where}`;
    }
    if (lower.includes("configdependencies")) {
      return `code runs at install: ${where} names configDependencies`;
    }
  }
  return undefined;
}
