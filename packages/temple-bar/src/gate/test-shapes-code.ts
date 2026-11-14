// Finds the two refused shapes in one test file's code: a replace that
// deletes markup tags with a regular expression, and a RegExp built from a
// value the check can't prove is escaped text or a regex. Parsing, scopes,
// values and patterns live in their own modules; this one walks the tree
// and applies the rules (docs/adr/0007-what-the-gate-checks.md, decision
// 103).

import type { Argument, Node, ParserOptions, ParseResult } from "oxc-parser";
import {
  readPattern,
  type PatternParserFactory,
  type TagReading,
} from "./test-shapes-pattern.ts";
import {
  buildScopes,
  childNodes,
  memberName,
  normalized,
} from "./test-shapes-scope.ts";
import {
  createEvaluator,
  type Evaluator,
  type Value,
} from "./test-shapes-values.ts";

export type CodeFinding =
  | { readonly kind: "deletes-tags"; readonly line: number }
  | { readonly kind: "unescaped-regexp"; readonly line: number }
  | { readonly kind: "unreadable-pattern"; readonly line: number }
  | { readonly kind: "too-complex"; readonly line: number }
  | {
      readonly kind: "unparseable";
      readonly line: number;
      readonly reason: string;
    };

export interface CodeParsers {
  readonly parseSync: (
    filename: string,
    source: string,
    options: ParserOptions,
  ) => ParseResult;
  readonly createPatternParser: PatternParserFactory;
}

type Lang = "js" | "jsx" | "ts" | "tsx" | "dts";

function langOf(file: string): Lang {
  if (/\.d\.[cm]?ts$/.test(file)) return "dts";
  if (file.endsWith(".tsx")) return "tsx";
  if (/\.[cm]?ts$/.test(file)) return "ts";
  // React projects write JSX in .js files too, which oxc refuses unless
  // told: .js, .jsx, .mjs and .cjs are all read as JSX.
  return "jsx";
}

/** The source types a file may have: an .mjs/.mts file is a module, a
 * .cjs/.cts file CommonJS, and any other could be either, by its
 * package's "type". */
function sourceTypesOf(file: string): ("module" | "commonjs")[] {
  if (/\.m[jt]s$/.test(file)) return ["module"];
  if (/\.c[jt]s$/.test(file)) return ["commonjs"];
  return ["module", "commonjs"];
}

/** The line `offset` sits on, counting every JavaScript line terminator:
 * LF, CR (CRLF counting once), and the line and paragraph separators. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13 && text.charCodeAt(index + 1) === 10) continue;
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
      line++;
    }
  }
  return line;
}

/** True when the replacement deletes what `reading` matched: its known
 * text, read by String.prototype.replace's substitution rules, keeps no
 * markup and is empty or whitespace. */
function stringDeletes(replacement: string, reading: TagReading): boolean {
  let literal = "";
  let keeps = false;
  for (let index = 0; index < replacement.length; index++) {
    const character = replacement.charAt(index);
    if (character !== "$" || index + 1 >= replacement.length) {
      literal += character;
      continue;
    }
    const next = replacement[index + 1] ?? "";
    if (next === "$") {
      literal += "$";
      index++;
    } else if (next === "&") {
      keeps = true;
      index++;
    } else if (next === "`" || next === "'") {
      // Text around the match: not empty, so not a deletion.
      literal += "x";
      index++;
    } else if (/[0-9]/.test(next)) {
      const two = Number(replacement.slice(index + 1, index + 3));
      const one = Number(next);
      const twoDigits =
        /^[0-9]{2}$/.test(replacement.slice(index + 1, index + 3)) &&
        two >= 1 &&
        two <= reading.groupCount;
      const group = twoDigits ? two : one;
      if (group >= 1 && group <= reading.groupCount) {
        if (reading.keeping.has(group)) keeps = true;
        index += twoDigits ? 2 : 1;
      } else {
        literal += "$";
      }
    } else if (next === "<" && reading.groupNames.size > 0) {
      const close = replacement.indexOf(">", index + 2);
      if (close === -1) {
        literal += "$";
      } else {
        if (reading.keeping.has(replacement.slice(index + 2, close))) {
          keeps = true;
        }
        index = close;
      }
    } else {
      literal += "$";
    }
  }
  return !keeps && literal.trim() === "";
}

type Verdict = "deletes" | "keeps" | "unknown" | "too-complex";

/** A choice between replacements: past the budget if any branch is, else
 * deleting if any branch deletes, else unknown if any is. */
function anyOf(verdicts: readonly Verdict[]): Verdict {
  for (const verdict of ["too-complex", "deletes", "unknown"] as const) {
    if (verdicts.includes(verdict)) return verdict;
  }
  return "keeps";
}

function textDeletes(value: Value, judge: (text: string) => boolean): Verdict {
  if (value.kind === "text") return judge(value.text) ? "deletes" : "keeps";
  if (value.kind === "too-complex") return "too-complex";
  if (value.kind === "either") {
    return anyOf(value.options.map((option) => textDeletes(option, judge)));
  }
  return "unknown";
}

function replacementVerdict(
  argument: Argument | undefined,
  reading: TagReading,
  evaluator: Evaluator,
): Verdict {
  // No replacement inserts the text "undefined".
  if (argument === undefined) return "keeps";
  if (argument.type === "SpreadElement") return "unknown";
  const node = normalized(argument);
  if (node.type === "ConditionalExpression") {
    // Either branch may be the replacement used. Each is judged by its own
    // rules, so a callback in a branch is still read as a callback.
    return anyOf([
      replacementVerdict(node.consequent, reading, evaluator),
      replacementVerdict(node.alternate, reading, evaluator),
    ]);
  }
  if (node.type === "ArrowFunctionExpression") {
    // A callback's result is inserted as it is, with no substitution; an
    // async one inserts a Promise.
    if (node.async || !node.expression) return "unknown";
    return textDeletes(
      evaluator.valueOf(node.body),
      (text) => text.trim() === "",
    );
  }
  if (node.type === "FunctionExpression") return "unknown";
  return textDeletes(evaluator.valueOf(node), (text) =>
    stringDeletes(text, reading),
  );
}

function isReplaceCall(node: Node): node is Node & { type: "CallExpression" } {
  if (node.type !== "CallExpression") return false;
  const callee = normalized(node.callee);
  const name = memberName(callee);
  return name === "replace" || name === "replaceAll";
}

function regexOptions(value: Value): Value[] {
  return value.kind === "either" ? [...value.options] : [value];
}

/** The findings in one parsed file. */
function walk(
  program: Node,
  text: string,
  evaluator: Evaluator,
  parsers: CodeParsers,
): CodeFinding[] {
  const findings: CodeFinding[] = [];
  const add = (
    kind: Exclude<CodeFinding["kind"], "unparseable">,
    at: Node,
  ): void => {
    findings.push({ kind, line: lineAt(text, at.start) });
  };
  const visit = (node: Node): void => {
    if (
      (node.type === "CallExpression" || node.type === "NewExpression") &&
      evaluator.isRegExpConstructor(node.callee)
    ) {
      const [source] = node.arguments;
      if (source !== undefined) {
        const value =
          source.type === "SpreadElement"
            ? ({ kind: "dynamic" } as const)
            : evaluator.valueOf(source);
        const options = regexOptions(value);
        if (options.some((option) => option.kind === "too-complex")) {
          add("too-complex", node);
        } else if (options.some((option) => option.kind === "dynamic")) {
          add("unescaped-regexp", node);
        }
      }
    }
    if (isReplaceCall(node)) checkReplace(node, add, evaluator, parsers);
    for (const child of childNodes(node)) visit(child);
  };
  visit(program);
  return findings.sort((a, b) => a.line - b.line);
}

function checkReplace(
  node: Node & { type: "CallExpression" },
  add: (
    kind: "deletes-tags" | "unreadable-pattern" | "too-complex",
    at: Node,
  ) => void,
  evaluator: Evaluator,
  parsers: CodeParsers,
): void {
  const [patternNode, replacement] = node.arguments;
  if (patternNode === undefined || patternNode.type === "SpreadElement") return;
  const pattern = evaluator.valueOf(patternNode);
  if (pattern.kind === "too-complex") {
    add("too-complex", node);
    return;
  }
  for (const option of regexOptions(pattern)) {
    if (option.kind === "too-complex") {
      add("too-complex", node);
      return;
    }
    if (option.kind !== "regex") continue;
    const result = readPattern(
      option.source,
      option.flags,
      parsers.createPatternParser,
    );
    if (result.kind === "unreadable") {
      add("unreadable-pattern", node);
      return;
    }
    if (result.kind === "unknown") continue;
    for (const reading of result.readings) {
      if (!reading.tag) continue;
      const verdict = replacementVerdict(replacement, reading, evaluator);
      if (verdict === "too-complex") {
        add("too-complex", node);
        return;
      }
      if (verdict === "deletes") {
        add("deletes-tags", node);
        return;
      }
    }
  }
}

/** Parses `source` as the file `file` and returns what the check finds.
 * Any parser error makes the file unreadable: a partial tree is never
 * searched. */
export function findShapes(
  file: string,
  source: string,
  parsers: CodeParsers,
): CodeFinding[] {
  // A byte-order mark before a hashbang trips the parser; Node's CommonJS
  // loader and TypeScript both drop it.
  const text = source.startsWith("\u{FEFF}") ? source.slice(1) : source;
  const lang = langOf(file);
  let firstError: { line: number; reason: string } | undefined;
  for (const sourceType of sourceTypesOf(file)) {
    const result = parsers.parseSync(file, text, {
      lang,
      sourceType,
      preserveParens: false,
    });
    const [error] = result.errors;
    if (error === undefined) {
      const strict = result.module.hasModuleSyntax || /\.m[jt]s$/.test(file);
      const scopes = buildScopes(result.program, strict);
      const trusted = !assignsBuiltins(result.program);
      return walk(
        result.program,
        text,
        createEvaluator(scopes, trusted),
        parsers,
      );
    }
    firstError ??= {
      line: lineAt(text, error.labels[0]?.start ?? 0),
      reason: error.message,
    };
  }
  return [
    {
      kind: "unparseable",
      line: firstError?.line ?? 1,
      reason: firstError?.reason ?? "the parser gave no reason",
    },
  ];
}

const BUILTIN_NAMES = new Set(["RegExp", "String"]);
const GLOBAL_NAMES = new Set(["globalThis", "window", "self", "global"]);

/** True when the file assigns to `RegExp` or `String`, to them on the
 * global object, or to `RegExp.escape` or `String.raw`: then neither
 * proves anything anywhere in the file. */
function assignsBuiltins(program: Node): boolean {
  const touches = (target: Node): boolean => {
    const inner = normalized(target);
    if (inner.type === "Identifier") return BUILTIN_NAMES.has(inner.name);
    if (inner.type !== "MemberExpression") return false;
    const name = memberName(inner);
    const object = normalized(inner.object);
    if (name !== undefined && BUILTIN_NAMES.has(name)) {
      return object.type === "Identifier" && GLOBAL_NAMES.has(object.name);
    }
    return (name === "escape" || name === "raw") && touches(object);
  };
  // A destructuring target assigns to every name and member inside it.
  const assigns = (target: Node | null): boolean => {
    if (target === null) return false;
    switch (target.type) {
      case "ObjectPattern":
        return target.properties.some((property) =>
          assigns(
            property.type === "RestElement"
              ? property.argument
              : property.value,
          ),
        );
      case "ArrayPattern":
        return target.elements.some((element) => assigns(element));
      case "AssignmentPattern":
        return assigns(target.left);
      case "RestElement":
        return assigns(target.argument);
      default:
        return touches(target);
    }
  };
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    const target =
      node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : (node.type === "ForInStatement" ||
                node.type === "ForOfStatement") &&
              node.left.type !== "VariableDeclaration"
            ? node.left
            : null;
    if (assigns(target)) {
      found = true;
      return;
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(program);
  return found;
}
