// Whether a package's `lint` script lets warnings pass. A linter that finds
// only warnings exits 0, so without its deny-warnings flag a warning would
// pass the gate, `ready` and CI. The project still picks its tools: only
// ESLint, oxlint and Biome are read, and only their flag counts, never a
// config file, so the rule is easy to check and to fix.
//
// The script is read by a small, fixed grammar, not a shell parser:
// anything outside it that names one of the three tools is refused as
// unreadable rather than guessed at. See
// docs/adr/0015-every-package-checked-and-guarded.md.

const TOOLS = ["eslint", "oxlint", "biome"] as const;
export type LintTool = (typeof TOOLS)[number];

/** The flag each tool needs before a warning fails it. */
export const DENY_WARNINGS_FLAG: Readonly<Record<LintTool, string>> = {
  eslint: "--max-warnings 0",
  oxlint: "--deny-warnings",
  biome: "--error-on-warnings",
};

/** Biome only lints through these subcommands. */
const BIOME_COMMANDS = new Set(["lint", "check", "ci"]);

export type LintFinding =
  /** One tool call without its flag; `from` is the script that holds it. */
  | {
      readonly kind: "no-flag";
      readonly tool: LintTool;
      readonly command: string;
      readonly from: string;
    }
  /** The script names a tool but steps outside the grammar. */
  | {
      readonly kind: "unreadable";
      readonly tools: readonly LintTool[];
      readonly reason: string;
    }
  /** A tool sits more than one script below `lint`; `chain` is the way down. */
  | {
      readonly kind: "too-deep";
      readonly tool: LintTool;
      readonly chain: readonly string[];
    };

type Scripts = Readonly<Record<string, unknown>>;

/** One command of the script, and the script it came from. */
interface Piece {
  readonly text: string;
  readonly from: string;
}

interface Word {
  /** As written, quotes included: an assignment is only one unquoted. */
  readonly raw: string;
  /** With its quotes removed, as the command receives it. */
  readonly value: string;
}

function namedTools(text: string): LintTool[] {
  return TOOLS.filter((tool) => text.includes(tool));
}

function scriptText(scripts: Scripts, name: string): string | undefined {
  const text = Object.hasOwn(scripts, name) ? scripts[name] : undefined;
  return typeof text === "string" ? text : undefined;
}

/** A script name plain enough to take from a command without quoting. */
const PLAIN_NAME = /^[\w:.@/+-]+$/;

/** The script a command runs when it is exactly `pnpm run X`, `pnpm X` or
 * `npm run X` and X is a script in the same package. */
function referenced(text: string, scripts: Scripts): string | undefined {
  const words = text.trim().split(/[ \t]+/);
  const [first, second, third] = words;
  let name: string | undefined;
  if (words.length === 3 && (first === "pnpm" || first === "npm")) {
    name = second === "run" ? third : undefined;
  } else if (words.length === 2 && first === "pnpm" && second !== "run") {
    name = second;
  }
  return name !== undefined &&
    PLAIN_NAME.test(name) &&
    scriptText(scripts, name) !== undefined
    ? name
    : undefined;
}

function piecesOf(text: string, from: string): Piece[] {
  return text.split("&&").map((part) => ({ text: part, from }));
}

/** The script's commands, each one that runs another script of the
 * package replaced by that script's commands, one level down only. */
function expand(scripts: Scripts, name: string, text: string): Piece[] {
  return piecesOf(text, name).flatMap((piece) => {
    const target = referenced(piece.text, scripts);
    const targetText =
      target === undefined ? undefined : scriptText(scripts, target);
    return target === undefined || targetText === undefined
      ? [piece]
      : piecesOf(targetText, target);
  });
}

/** A tool reached through a script any deeper than `expand` reads, and the
 * way down to it. Each script is visited once, so a loop ends. */
function deeperTool(
  scripts: Scripts,
  pieces: readonly Piece[],
  chain: readonly string[],
  seen: Set<string>,
): { tool: LintTool; chain: string[] } | undefined {
  for (const piece of pieces) {
    const target = referenced(piece.text, scripts);
    const text = target === undefined ? undefined : scriptText(scripts, target);
    if (target === undefined || text === undefined || seen.has(target)) {
      continue;
    }
    seen.add(target);
    const way =
      chain.at(-1) === piece.from
        ? [...chain, target]
        : [...chain, piece.from, target];
    const [tool] = namedTools(text);
    if (tool !== undefined) {
      return { tool, chain: way };
    }
    const deeper = deeperTool(scripts, piecesOf(text, target), way, seen);
    if (deeper !== undefined) {
      return deeper;
    }
  }
  return undefined;
}

/** Characters the grammar never reads, anywhere in the script, with how a
 * message names each. `&` is only read as half of `&&`, which splits
 * commands before this runs. */
const UNREADABLE: readonly (readonly [RegExp, string])[] = [
  [/[\n\r]/, "a line break"],
  [/;/, '";"'],
  [/\|/, '"|"'],
  [/&/, 'an "&" outside "&&"'],
  [/#/, '"#"'],
  [/\\/, "a backslash"],
  [/\$/, '"$"'],
  [/`/, "a backtick"],
  [/[<>]/, "a redirection"],
];

/** The command's words, or why the grammar can't read it. */
function wordsOf(text: string): Word[] | string {
  for (const [pattern, name] of UNREADABLE) {
    if (pattern.test(text)) {
      return `it holds ${name}`;
    }
  }
  if (text.trim() === "") {
    return 'it has an empty command around "&&"';
  }
  const words: Word[] = [];
  let raw = "";
  let value = "";
  let started = false;
  let quote: string | undefined;
  for (const char of text) {
    if (quote !== undefined) {
      raw += char;
      if (char === quote) {
        quote = undefined;
      } else {
        value += char;
      }
    } else if (char === " " || char === "\t") {
      if (started) {
        words.push({ raw, value });
      }
      raw = "";
      value = "";
      started = false;
    } else {
      raw += char;
      started = true;
      if (char === "'" || char === '"') {
        quote = char;
      } else {
        value += char;
      }
    }
  }
  if (quote !== undefined) {
    return "it has an unclosed quote";
  }
  if (started) {
    words.push({ raw, value });
  }
  return words;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function toolOf(word: string | undefined): LintTool | undefined {
  return TOOLS.find(
    (tool) => word === tool || word?.endsWith(`node_modules/.bin/${tool}`),
  );
}

/** Where the tool's word is: past leading assignments, then `cross-env`
 * and its assignments, then one runner and its own options. */
function toolIndex(words: readonly Word[]): number {
  let index = 0;
  const at = (offset = 0): string | undefined => words[index + offset]?.value;
  const skipAssignments = (): void => {
    while (ASSIGNMENT.test(words[index]?.raw ?? "")) {
      index += 1;
    }
  };
  skipAssignments();
  if (at() === "cross-env") {
    index += 1;
    skipAssignments();
  }
  if (at() === "pnpm" && (at(1) === "exec" || at(1) === "dlx")) {
    index += 2;
  } else if (at() === "npx") {
    index += 1;
    while (at() === "-y" || at() === "--yes") {
      index += 1;
    }
  }
  return index;
}

function hasFlag(tool: LintTool, args: readonly string[]): boolean {
  if (tool === "oxlint") {
    return args.includes("--deny-warnings");
  }
  if (tool === "biome") {
    return args.includes("--error-on-warnings");
  }
  // The last --max-warnings wins, as it does for ESLint.
  let limit: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--max-warnings") {
      limit = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--max-warnings=")) {
      limit = arg.slice("--max-warnings=".length);
    }
  }
  return limit === "0";
}

/** One command's finding, if it has one. */
function commandFinding(
  piece: Piece,
  words: readonly Word[],
): LintFinding | undefined {
  const command = piece.text.trim();
  const index = toolIndex(words);
  const tool = toolOf(words[index]?.value);
  const tools = namedTools(command);
  if (tool === undefined) {
    return tools.length === 0
      ? undefined
      : {
          kind: "unreadable",
          tools,
          reason: `"${command}" names ${tools.join(", ")} but doesn't call it in a form the gate reads`,
        };
  }
  let first = index + 1;
  if (tool === "biome") {
    if (!BIOME_COMMANDS.has(words[first]?.value ?? "")) {
      return {
        kind: "unreadable",
        tools,
        reason: `"${command}" runs biome without lint, check or ci`,
      };
    }
    first += 1;
  }
  // Arguments after `--` are passed on, not read by the tool.
  const args = words.slice(first).map((word) => word.value);
  const end = args.indexOf("--");
  const own = end === -1 ? args : args.slice(0, end);
  return hasFlag(tool, own)
    ? undefined
    : { kind: "no-flag", tool, command, from: piece.from };
}

/**
 * What lets warnings pass in the package's `lint` script (`name`), given
 * its scripts: empty when nothing does, or when the script calls none of
 * ESLint, oxlint and Biome.
 */
export function lintScriptFindings(
  scripts: Scripts,
  name = "lint",
): LintFinding[] {
  const text = scriptText(scripts, name);
  if (text === undefined) {
    return [];
  }
  const pieces = expand(scripts, name, text);
  const deep = deeperTool(scripts, pieces, [name], new Set([name]));
  if (deep !== undefined) {
    return [{ kind: "too-deep", ...deep }];
  }
  const tools = namedTools(pieces.map((piece) => piece.text).join("&&"));
  if (tools.length === 0) {
    return [];
  }
  const read: { piece: Piece; words: Word[] }[] = [];
  for (const piece of pieces) {
    const words = wordsOf(piece.text);
    if (typeof words === "string") {
      return [{ kind: "unreadable", tools, reason: words }];
    }
    read.push({ piece, words });
  }
  const findings: LintFinding[] = [];
  for (const { piece, words } of read) {
    const finding = commandFinding(piece, words);
    if (finding?.kind === "unreadable") {
      return [finding];
    }
    // The same call twice (`pnpm lint && eslint .` reads the script's own
    // commands once more) is said once.
    if (
      finding !== undefined &&
      !findings.some((seen) => JSON.stringify(seen) === JSON.stringify(finding))
    ) {
      findings.push(finding);
    }
  }
  return findings;
}

function flagsOf(tools: readonly LintTool[]): string {
  return tools
    .map((tool) => `each ${tool} call with ${DENY_WARNINGS_FLAG[tool]}`)
    .join(", ");
}

/** The gate's message for `findings` in the manifest at `label`, naming the
 * script, the tool and the flag to add. */
export function formatLintFindings(
  label: string,
  findings: readonly LintFinding[],
  name = "lint",
): string {
  const lines = [
    `gate: ${label} has a "${name}" script that lets warnings pass`,
  ];
  for (const finding of findings) {
    switch (finding.kind) {
      case "no-flag": {
        const where = finding.from === name ? "" : ` (in "${finding.from}")`;
        const flag = DENY_WARNINGS_FLAG[finding.tool];
        lines.push(
          `  "${finding.command}"${where} runs ${finding.tool} without ${flag}: add ${flag} to it`,
        );
        break;
      }
      case "unreadable":
        lines.push(
          `  it calls ${finding.tools.join(", ")}, but the gate can't read it: ${finding.reason}`,
          `  write it as plain commands joined by "&&", ${flagsOf(finding.tools)}`,
        );
        break;
      case "too-deep":
        lines.push(
          `  it reaches ${finding.tool} too deep, through ${finding.chain.map((script) => `"${script}"`).join(" > ")}`,
          `  call ${finding.tool} from "${name}" or a script "${name}" runs directly, with ${DENY_WARNINGS_FLAG[finding.tool]}`,
        );
        break;
    }
  }
  return `${lines.join("\n")}\n`;
}
