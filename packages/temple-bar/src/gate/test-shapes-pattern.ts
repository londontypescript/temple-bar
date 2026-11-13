// Reads a regular expression's pattern for the test-shapes check: can it
// match a markup tag, and which of its groups put markup back when a
// replacement names them? See test-shapes.ts for the check as a whole and
// docs/adr/0007-what-the-gate-checks.md (decision 103) for why it exists.
//
// The reading is deliberately conservative: it says "tag" whenever a `<`
// written in the pattern can be followed by a character that starts a tag,
// without using lookarounds or backreferences to rule a tag out. A pattern
// only partly known (text escaped with RegExp.escape in it) is read with a
// letter standing for each escaped part.

import type { AST, RegExpParser } from "@eslint-community/regexpp";

/** Marks one escaped part in a partly known pattern source. A character
 * from the private use area, so no real pattern text holds it. */
export const ESCAPED_PART = "\u{E000}";

/** What a reading needs from regexpp, passed in so the parser is loaded
 * only when the check runs. */
export type PatternParserFactory = () => RegExpParser;

export interface TagReading {
  /** The pattern can match a `<` followed by a tag's first character. */
  readonly tag: boolean;
  /** The numbers and names of groups that hold a `<` and take part in
   * every match, so `$1` or `$<name>` naming one puts markup back. */
  readonly keeping: ReadonlySet<number | string>;
  /** How many capturing groups the pattern has, for reading `$12`. */
  readonly groupCount: number;
  /** The names of its named groups, for reading `$<name>`. */
  readonly groupNames: ReadonlySet<string>;
}

export type PatternResult =
  | { readonly kind: "read"; readonly readings: readonly TagReading[] }
  /** Fully known, but no flag reading parses. */
  | { readonly kind: "unreadable" }
  /** Partly known, and the substituted pattern doesn't parse: the real
   * pattern isn't known, so it is neither a tag nor unreadable. */
  | { readonly kind: "unknown" };

// The characters that start a tag in HTML's tokenizer: a letter opens a
// tag, `/` an end tag, `!` a comment or declaration. `?` is left out on
// purpose: an XML declaration (`<?xml …?>`) isn't a tag.
const TAG_STARTS =
  "/!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
const LESS_THAN = 0x3c;
const VALID_FLAGS = /^[dgimsuvy]*$/;
// When the flags aren't known, every combination that changes how the
// pattern parses (u, v) or what a character matches (i) is read.
const UNKNOWN_FLAG_READINGS = ["", "i", "u", "iu", "v", "iv"];

interface Facts {
  readonly nullable: boolean;
  /** Its match can start with a tag's first character. */
  readonly firstTag: boolean;
  /** Its match can end with a `<` written in the pattern. */
  readonly lastLt: boolean;
  /** It can match a `<` followed directly by a tag's first character. */
  readonly pair: boolean;
}

const ZERO_WIDTH: Facts = {
  nullable: true,
  firstTag: false,
  lastLt: false,
  pair: false,
};

interface ReadState {
  readonly ignoreCase: boolean;
  readonly mode: "" | "u" | "v";
  /** Offsets of the letters standing for escaped parts. */
  readonly escaped: ReadonlySet<number>;
  readonly memo: Map<string, boolean>;
}

/** True when one character matched by `raw` (a character, a class or a
 * set, written as in the pattern) can start a tag. Node's own regex engine
 * decides, so ranges, properties and set operations need no logic here. */
function canStartTag(raw: string, state: ReadState): boolean {
  const flags = `${state.ignoreCase ? "i" : ""}${state.mode}`;
  const key = `${flags}/${raw}`;
  const known = state.memo.get(key);
  if (known !== undefined) return known;
  let result: boolean;
  try {
    const single = new RegExp(`^(?:${raw})$`, flags);
    result = TAG_STARTS.some((character) => single.test(character));
  } catch {
    // Can't judge it alone: count it as able to start a tag.
    result = true;
  }
  state.memo.set(key, result);
  return result;
}

function holdsEscapedPart(node: AST.Node, state: ReadState): boolean {
  for (const offset of state.escaped) {
    if (offset >= node.start && offset < node.end) return true;
  }
  return false;
}

/** A `<` written in the pattern: the character itself in any spelling, or
 * a class holding nothing else. Wider classes (`.`, `\W`, `[^>]`) that
 * happen to match `<` aren't one. */
function isWrittenLessThan(node: AST.Node): boolean {
  if (node.type === "Character") return node.value === LESS_THAN;
  if (node.type === "CharacterClass" && !node.negate) {
    return (
      node.elements.length > 0 &&
      node.elements.every(
        (element) =>
          element.type === "Character" && element.value === LESS_THAN,
      )
    );
  }
  return false;
}

function oneCharacter(node: AST.Node, state: ReadState): Facts {
  const unknownClass =
    node.type !== "Character" && holdsEscapedPart(node, state);
  return {
    nullable: false,
    firstTag: unknownClass || canStartTag(node.raw, state),
    lastLt: !unknownClass && isWrittenLessThan(node),
    pair: false,
  };
}

function alternatives(
  nodes: readonly AST.Alternative[],
  state: ReadState,
): Facts {
  const facts = nodes.map((node) => sequence(node.elements, state));
  return {
    nullable: facts.some((fact) => fact.nullable),
    firstTag: facts.some((fact) => fact.firstTag),
    lastLt: facts.some((fact) => fact.lastLt),
    pair: facts.some((fact) => fact.pair),
  };
}

function sequence(elements: readonly AST.Element[], state: ReadState): Facts {
  let nullable = true;
  let firstTag = false;
  let lastLt = false;
  let pair = false;
  for (const element of elements) {
    const fact = facts(element, state);
    if (nullable && fact.firstTag) firstTag = true;
    if (fact.pair || (lastLt && fact.firstTag)) pair = true;
    lastLt = fact.lastLt || (fact.nullable && lastLt);
    nullable = nullable && fact.nullable;
  }
  return { nullable, firstTag, lastLt, pair };
}

function facts(node: AST.Element, state: ReadState): Facts {
  switch (node.type) {
    case "Group": {
      const add = node.modifiers?.add.ignoreCase === true;
      const remove = node.modifiers?.remove?.ignoreCase === true;
      const inner = add
        ? { ...state, ignoreCase: true }
        : remove
          ? { ...state, ignoreCase: false }
          : state;
      return alternatives(node.alternatives, inner);
    }
    case "CapturingGroup":
      return alternatives(node.alternatives, state);
    case "Quantifier": {
      if (node.max === 0) return ZERO_WIDTH;
      const inner = facts(node.element, state);
      return {
        nullable: node.min === 0 || inner.nullable,
        firstTag: inner.firstTag,
        lastLt: inner.lastLt,
        pair: inner.pair || (node.max > 1 && inner.lastLt && inner.firstTag),
      };
    }
    case "Assertion":
      // Zero width, and never used to rule a tag out.
      return ZERO_WIDTH;
    case "Backreference":
      // Could hold anything after a `<`, but is never a written `<`.
      return { nullable: true, firstTag: true, lastLt: false, pair: false };
    case "Character":
    case "CharacterClass":
    case "CharacterSet":
    case "ExpressionCharacterClass":
      return oneCharacter(node, state);
  }
}

/** The pattern's capturing groups, in the order their numbers go, and
 * which of them put markup back: those holding a `<` (outside any
 * lookaround) that take part in every match, under no alternation with a
 * sibling branch, no quantifier allowing zero and no lookaround. */
function groupsOf(pattern: AST.Pattern): Omit<TagReading, "tag"> {
  const groups: { name: string | null; always: boolean; holds: boolean }[] = [];
  const branches = (
    alternativesOf: readonly AST.Alternative[],
    always: boolean,
  ): boolean => {
    const many = alternativesOf.length > 1;
    let holds = false;
    for (const alternative of alternativesOf) {
      for (const element of alternative.elements) {
        if (visit(element, always && !many)) holds = true;
      }
    }
    return holds;
  };
  // True when `node` holds a written `<` outside any lookaround.
  const visit = (node: AST.Element, always: boolean): boolean => {
    switch (node.type) {
      case "CapturingGroup": {
        const group = { name: node.name, always, holds: false };
        groups.push(group);
        group.holds = branches(node.alternatives, always);
        return group.holds;
      }
      case "Group":
        return branches(node.alternatives, always);
      case "Quantifier":
        return visit(node.element, always && node.min > 0);
      case "Assertion":
        if (node.kind === "lookahead" || node.kind === "lookbehind") {
          branches(node.alternatives, false);
        }
        return false;
      default:
        return isWrittenLessThan(node);
    }
  };
  branches(pattern.alternatives, true);
  const keeping = new Set<number | string>();
  const groupNames = new Set<string>();
  groups.forEach((group, index) => {
    if (group.name !== null) groupNames.add(group.name);
    if (!group.always || !group.holds) return;
    keeping.add(index + 1);
    if (group.name !== null) keeping.add(group.name);
  });
  return { keeping, groupCount: groups.length, groupNames };
}

/** Reads `source` (which may hold ESCAPED_PART marks) under `flags`, or
 * under every combination that matters when the flags aren't known. */
export function readPattern(
  source: string,
  flags: string | undefined,
  createParser: PatternParserFactory,
): PatternResult {
  const escaped = new Set<number>();
  let text = "";
  for (const character of source) {
    if (character === ESCAPED_PART) {
      escaped.add(text.length);
      text += "a";
    } else {
      text += character;
    }
  }
  const partly = escaped.size > 0;
  const readingsOf =
    flags === undefined
      ? UNKNOWN_FLAG_READINGS
      : VALID_FLAGS.test(flags) && !(flags.includes("u") && flags.includes("v"))
        ? [flags]
        : [];
  const memo = new Map<string, boolean>();
  const readings: TagReading[] = [];
  for (const reading of readingsOf) {
    const mode: ReadState["mode"] = reading.includes("v")
      ? "v"
      : reading.includes("u")
        ? "u"
        : "";
    let pattern: AST.Pattern;
    try {
      pattern = createParser().parsePattern(text, 0, text.length, {
        unicode: mode === "u",
        unicodeSets: mode === "v",
      });
    } catch {
      continue;
    }
    const state = { ignoreCase: reading.includes("i"), mode, escaped, memo };
    readings.push({
      tag: alternatives(pattern.alternatives, state).pair,
      ...groupsOf(pattern),
    });
  }
  if (readings.length > 0) return { kind: "read", readings };
  return { kind: partly ? "unknown" : "unreadable" };
}
