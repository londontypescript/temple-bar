// Reads a package's `typecheck` and `test` scripts into the listings the
// coverage check makes (see coverage.ts), or says the script's form isn't
// one it can list. Pure: nothing here runs anything.
//
// A listing must ask the same tool the same question the script asks, or
// the check would credit files the script never checks or runs. So only a
// few plain forms are read, with no shell syntax but `&&` between commands
// and double quotes around whole words, the way this repo reads its own
// test scripts: anything a shell could rewrite (a quote, `$`, a pipe, a
// redirect, a line break) would make the words read here differ from the
// ones the tool gets. Every other form fails, naming the forms that are
// read, rather than being guessed at.

/** One `tsc` command of a typecheck script. */
export type TypecheckPart =
  /** `tsc` or `tsc -p <project>`: one program, found the way tsc finds it. */
  | { readonly tool: "tsc"; readonly project: string | undefined }
  /** `tsc -b [<project>...]`: each project and every project it
   * references; none given means `tsconfig.json` in the package's folder. */
  | { readonly tool: "tsc-build"; readonly projects: readonly string[] };

/** One command of a test script, with its words as written for messages. */
export type TestPart =
  /** `vitest [run] <arguments>`: the arguments are the run's own. */
  | {
      readonly tool: "vitest";
      readonly args: readonly string[];
      readonly text: string;
    }
  /** `node ... --test [<pattern>...]`: no patterns means Node's defaults. */
  | {
      readonly tool: "node";
      readonly patterns: readonly string[];
      readonly text: string;
    };

interface Word {
  /** The word as the tool receives it, quotes removed. */
  readonly value: string;
  /** The word as the script writes it. */
  readonly text: string;
}

/** The characters a word may hold, quoted or not: enough for paths,
 * patterns and `--flag=value`, and nothing a shell treats specially. */
const WORD = String.raw`[\w./*?[\]{},@:+=-]+`;
const PLAIN_WORD = new RegExp(`^${WORD}$`);
const QUOTED_WORD = new RegExp(`^"(${WORD})"$`);

/** The script's commands, split at `&&`, or undefined when it holds any
 * other shell syntax. Words are separated by single spaces only: a tab or
 * a line break could start another command. */
function commandsOf(script: string): Word[][] | undefined {
  if (!/^\S+(?: \S+)*$/.test(script)) {
    return undefined;
  }
  const commands: Word[][] = [[]];
  for (const text of script.split(" ")) {
    if (text === "&&") {
      commands.push([]);
      continue;
    }
    const quoted = QUOTED_WORD.exec(text)?.[1];
    if (quoted === undefined && !PLAIN_WORD.test(text)) {
      return undefined;
    }
    commands[commands.length - 1]?.push({ value: quoted ?? text, text });
  }
  return commands.some((command) => command.length === 0)
    ? undefined
    : commands;
}

/** Every command of `script` read by `readCommand`, or undefined when any
 * one of them isn't a supported form. */
function readScript<Part>(
  script: string,
  readCommand: (words: readonly Word[]) => Part | undefined,
): Part[] | undefined {
  const parts: Part[] = [];
  for (const words of commandsOf(script) ?? []) {
    const part = readCommand(words);
    if (part === undefined) {
      return undefined;
    }
    parts.push(part);
  }
  return parts.length === 0 ? undefined : parts;
}

/** Flags that don't change which files tsc's program holds, so the
 * listing can leave them out. */
const TSC_FLAGS = [
  "--noEmit",
  "--pretty",
  "--incremental",
  "--skipLibCheck",
  "--noCheck",
];
/** Build mode's own flags. Outside build mode `-v` is `--version`, which
 * checks nothing and exits 0, so they are read only after `-b`. */
const TSC_BUILD_FLAGS = ["--force", "-f", "--verbose", "-v"];

/** How many words a flag at `words[at]` takes, or 0 when it isn't one of
 * `flags`. `--pretty` may be followed by `true` or `false`. */
function flagLength(
  words: readonly Word[],
  at: number,
  flags: readonly string[],
): number {
  const value = words[at]?.value ?? "";
  if (!flags.includes(value)) {
    return 0;
  }
  const next = words[at + 1]?.value;
  return value === "--pretty" && (next === "true" || next === "false") ? 2 : 1;
}

function readTsc(words: readonly Word[]): TypecheckPart | undefined {
  if (words[0]?.value !== "tsc") {
    return undefined;
  }
  // tsc takes -b only as its first argument.
  if (words[1]?.value === "-b" || words[1]?.value === "--build") {
    const projects: string[] = [];
    for (let at = 2; at < words.length;) {
      const taken = flagLength(words, at, [...TSC_FLAGS, ...TSC_BUILD_FLAGS]);
      const value = words[at]?.value ?? "";
      if (taken === 0 && value.startsWith("-")) {
        return undefined;
      }
      if (taken === 0) {
        projects.push(value);
      }
      at += Math.max(taken, 1);
    }
    return { tool: "tsc-build", projects };
  }
  let project: string | undefined;
  for (let at = 1; at < words.length;) {
    const value = words[at]?.value ?? "";
    if (value === "-p" || value === "--project") {
      const next = words[at + 1]?.value;
      if (project !== undefined || next === undefined || next.startsWith("-")) {
        return undefined;
      }
      project = next;
      at += 2;
      continue;
    }
    // A file name, or any other flag, makes tsc check something else.
    const taken = flagLength(words, at, TSC_FLAGS);
    if (taken === 0) {
      return undefined;
    }
    at += taken;
  }
  return { tool: "tsc", project };
}

/** Vitest commands that don't run the test files `vitest list` lists. */
const VITEST_OTHER_COMMANDS = [
  "watch",
  "dev",
  "bench",
  "related",
  "typecheck",
  "init",
  "list",
];
/** Vitest options that run fewer tests or files than `vitest list` names.
 * Vitest reads a kebab-case option as its camelCase name. */
const VITEST_NARROWING = [
  "-t",
  "--testNamePattern",
  "--test-name-pattern",
  "--shard",
  "--changed",
  "--related",
];

function narrowsVitest(value: string): boolean {
  // `-t` may also come joined with other short flags, as in `-ut`.
  return (
    /^-[A-Za-z]*t[A-Za-z]*(?:=|$)/.test(value) ||
    VITEST_NARROWING.some(
      (option) => value === option || value.startsWith(`${option}=`),
    )
  );
}

function readVitest(words: readonly Word[]): TestPart | undefined {
  const rest = words.slice(words[1]?.value === "run" ? 2 : 1);
  // Vitest takes its first positional word as its command, wherever it
  // stands among the options, so a word naming another command anywhere,
  // or `run` anywhere but second, could run something other than the list
  // shows. A file filter or an option's value that happens to be named
  // like a command is refused too: telling them apart would mean knowing
  // which options take values.
  if (
    rest.some(
      (word) =>
        VITEST_OTHER_COMMANDS.includes(word.value) || word.value === "run",
    )
  ) {
    return undefined;
  }
  const args = rest.map((word) => word.value);
  return args.some(narrowsVitest)
    ? undefined
    : {
        tool: "vitest",
        args,
        text: words.map((word) => word.text).join(" "),
      };
}

/** Node test runner options that change how tests run, never which.
 * These take a value, as `=value` or as the next word. */
const NODE_VALUE_OPTIONS = [
  "--test-reporter",
  "--test-reporter-destination",
  "--test-concurrency",
  "--test-timeout",
  "--test-isolation",
  "--test-coverage-*",
  "--test-global-setup",
];
/** These take no value: the word after one would be Node's entry script,
 * which would then get `--test` and the patterns as its own arguments. */
const NODE_SWITCHES = ["--test-force-exit", "--test-update-snapshots"];

function isOption(name: string, options: readonly string[]): boolean {
  return options.some((option) =>
    option.endsWith("*")
      ? name.startsWith(option.slice(0, -1))
      : name === option,
  );
}

/** How many words the option at `words[at]`, before `--test`, takes; 0
 * when it isn't one Node's form allows there. */
function nodeOptionLength(words: readonly Word[], at: number): number {
  const value = words[at]?.value ?? "";
  const next = words[at + 1]?.value;
  const nextIsValue = next !== undefined && !next.startsWith("-");
  if (value === "--import" || value === "--require") {
    return nextIsValue ? 2 : 0;
  }
  const [name = "", given] = value.split(/=(.*)/s);
  if (isOption(name, NODE_SWITCHES)) {
    return 1;
  }
  if (!isOption(name, NODE_VALUE_OPTIONS)) {
    return 0;
  }
  return given === undefined && nextIsValue ? 2 : 1;
}

function readNode(words: readonly Word[]): TestPart | undefined {
  const at = words.findIndex((word) => word.value === "--test");
  if (
    at < 0 ||
    words.findIndex((word, index) => index > at && word.value === "--test") >= 0
  ) {
    return undefined;
  }
  // Only options before --test: any other word is an entry script, which
  // could do anything with the patterns, so they would prove nothing.
  for (let index = 1; index < at;) {
    const taken = nodeOptionLength(words, index);
    if (taken === 0) {
      return undefined;
    }
    index += taken;
  }
  const operands = words.slice(at + 1);
  const patterns = operands.map((word) => word.value);
  // Unquoted, a glob reaches the shell first, which expands it by its own
  // rules (`**` as `*` in sh) before Node sees the files: the run would
  // take fewer than the pattern names. A plain file name is safe.
  const shellGlob = operands.some(
    (word) => !word.text.startsWith('"') && /[*?[{]/.test(word.value),
  );
  return shellGlob || patterns.some((pattern) => pattern.startsWith("-"))
    ? undefined
    : {
        tool: "node",
        patterns,
        text: words.map((word) => word.text).join(" "),
      };
}

function readTest(words: readonly Word[]): TestPart | undefined {
  if (words[0]?.value === "vitest") {
    return readVitest(words);
  }
  return words[0]?.value === "node" ? readNode(words) : undefined;
}

/** A typecheck script's tsc commands, or undefined when its form isn't
 * supported. */
export function readTypecheckScript(
  script: string,
): TypecheckPart[] | undefined {
  return readScript(script, readTsc);
}

/** A test script's Vitest and Node test runner commands, or undefined when
 * its form isn't supported. */
export function readTestScript(script: string): TestPart[] | undefined {
  return readScript(script, readTest);
}

const SHELL_RULE = "no shell syntax but && and double quotes around words";

/** The forms the gate can list, said when a script isn't one of them.
 * Written from the lists the readers above use, so the two can't drift. */
export const SUPPORTED_FORMS = {
  typecheck: `supported: tsc [-p <config>] [flags], tsc -b [<project>...] [flags], joined with &&; flags: ${TSC_FLAGS.map(
    (flag) => (flag === "--pretty" ? "--pretty [true|false]" : flag),
  ).join(
    ", ",
  )}, and after -b also ${TSC_BUILD_FLAGS.join(", ")}; ${SHELL_RULE}`,
  test: `supported: vitest [run] [<arguments>], node [<option>...] --test [<pattern>...], joined with &&; vitest without ${VITEST_NARROWING.join(
    ", ",
  )}, and no other command than run; node with no entry script before --test, globs double-quoted, and only these options: --import <file>, --require <file>, ${[
    ...NODE_VALUE_OPTIONS,
    ...NODE_SWITCHES,
  ].join(", ")}; ${SHELL_RULE}`,
} as const;

/** The failure for a script whose form the gate can't list. `where` is
 * "the root" or a package's folder. */
export function unsupportedFormMessage(
  script: keyof typeof SUPPORTED_FORMS,
  where: string,
  command: string,
): string {
  return `gate: ${where}'s ${script} script isn't a form the gate can list: ${JSON.stringify(command)}\n  ${SUPPORTED_FORMS[script]}\n`;
}
