// What the test-shapes check knows about a value in a test file: known
// text, text escaped with RegExp.escape, a regular expression, one of a few
// alternatives, or something it can't see ("dynamic"). Local constants are
// followed through test-shapes-scope.ts; everything else is dynamic.

import type { Argument, Expression, Node } from "oxc-parser";
import { ESCAPED_PART } from "./test-shapes-pattern.ts";
import { memberName, normalized, type Scopes } from "./test-shapes-scope.ts";

export type Value =
  | { readonly kind: "text"; readonly text: string }
  /** Pattern text in which each ESCAPED_PART stands for escaped text. */
  | { readonly kind: "escaped"; readonly source: string }
  /** `flags` undefined: not known. `source` may hold ESCAPED_PART. */
  | {
      readonly kind: "regex";
      readonly source: string;
      readonly flags: string | undefined;
    }
  | { readonly kind: "either"; readonly options: readonly Value[] }
  | { readonly kind: "dynamic" }
  /** Past the work budget: reported, never guessed. */
  | { readonly kind: "too-complex" };

const DYNAMIC: Value = { kind: "dynamic" };
const TOO_COMPLEX: Value = { kind: "too-complex" };

// The work budget. A conditional multiplies alternatives, following one
// constant to another goes deeper, and concatenation grows text; past these
// the value is reported as too complex to read. Only following counts
// towards the depth, so a long concatenation of known text stays known.
const MAX_ALTERNATIVES = 16;
const MAX_DEPTH = 32;
const MAX_TEXT = 64 * 1024;

const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);

export interface Evaluator {
  valueOf(node: Node): Value;
  /** `RegExp`, or `RegExp` on the global object, by any spelling. */
  isRegExpConstructor(node: Node): boolean;
  /** RegExp(...) or new RegExp(...) with these arguments. */
  regExpOf(args: readonly Argument[], at: Node): Value;
}

function distribute(
  a: Value,
  b: Value,
  combine: (x: Value, y: Value) => Value,
): Value {
  const left = a.kind === "either" ? a.options : [a];
  const right = b.kind === "either" ? b.options : [b];
  if (left.length * right.length > MAX_ALTERNATIVES) return TOO_COMPLEX;
  const options = left.flatMap((x) => right.map((y) => combine(x, y)));
  return either(options);
}

function either(options: readonly Value[]): Value {
  const flat = options.flatMap((option) =>
    option.kind === "either" ? option.options : [option],
  );
  if (flat.some((option) => option.kind === "too-complex")) return TOO_COMPLEX;
  if (flat.length > MAX_ALTERNATIVES) return TOO_COMPLEX;
  const [only] = flat;
  return flat.length === 1 && only !== undefined
    ? only
    : { kind: "either", options: flat };
}

/** Joins two parts of a string or pattern source, as `+` or a template. */
function concat(a: Value, b: Value): Value {
  if (a.kind === "too-complex" || b.kind === "too-complex") return TOO_COMPLEX;
  if (a.kind === "either" || b.kind === "either") {
    return distribute(a, b, concat);
  }
  if (a.kind === "text" && b.kind === "text") {
    if (a.text.length + b.text.length > MAX_TEXT) return TOO_COMPLEX;
    return { kind: "text", text: a.text + b.text };
  }
  const source = (value: Value): string | undefined =>
    value.kind === "text"
      ? value.text
      : value.kind === "escaped"
        ? value.source
        : undefined;
  const left = source(a);
  const right = source(b);
  if (left === undefined || right === undefined) return DYNAMIC;
  if (left.length + right.length > MAX_TEXT) return TOO_COMPLEX;
  return { kind: "escaped", source: left + right };
}

export function createEvaluator(
  scopes: Scopes,
  trustedBuiltins: boolean,
): Evaluator {
  const memo = new Map<Node, Value>();
  const inProgress = new Set<Node>();

  /** True when `name` is the global itself here, not a local binding. */
  const isGlobal = (name: string, at: Node): boolean =>
    scopes.resolve(name, at) === undefined;

  const isGlobalMember = (node: Node, name: string): boolean => {
    const inner = normalized(node);
    if (inner.type === "Identifier") return inner.name === name;
    if (inner.type !== "MemberExpression" || memberName(inner) !== name) {
      return false;
    }
    const object = normalized(inner.object);
    return object.type === "Identifier" && GLOBAL_OBJECTS.has(object.name);
  };

  /** `RegExp` or `String` (on the global object or not) that is the real
   * built-in: not shadowed here, and never assigned in the file. */
  const isTrustedGlobal = (node: Node, name: string, at: Node): boolean => {
    if (!trustedBuiltins || !isGlobalMember(node, name)) return false;
    const inner = normalized(node);
    const base =
      inner.type === "MemberExpression" ? normalized(inner.object) : inner;
    return base.type === "Identifier" && isGlobal(base.name, at);
  };

  const isEscapeCallee = (callee: Node, at: Node): boolean => {
    const inner = normalized(callee);
    return (
      inner.type === "MemberExpression" &&
      memberName(inner) === "escape" &&
      isTrustedGlobal(inner.object, "RegExp", at)
    );
  };

  /** `(s) => RegExp.escape(s)`. */
  const isEscapingArrow = (fn: Node): boolean => {
    if (fn.type !== "ArrowFunctionExpression" || fn.async || !fn.expression) {
      return false;
    }
    const [param, ...others] = fn.params;
    if (param?.type !== "Identifier" || others.length > 0) return false;
    const body = normalized(fn.body);
    if (body.type !== "CallExpression" || body.arguments.length !== 1) {
      return false;
    }
    const [argument] = body.arguments;
    if (argument === undefined) return false;
    const passed = normalized(argument);
    return (
      isEscapeCallee(body.callee, body) &&
      passed.type === "Identifier" &&
      passed.name === param.name
    );
  };

  /** `X.map(RegExp.escape).join(sep)` or the arrow-function spelling. */
  const escapedJoin = (node: Node, depth: number): Value | undefined => {
    if (node.type !== "CallExpression") return undefined;
    const callee = normalized(node.callee);
    if (callee.type !== "MemberExpression" || memberName(callee) !== "join") {
      return undefined;
    }
    const [separatorNode, ...extra] = node.arguments;
    if (extra.length > 0 || separatorNode?.type === "SpreadElement") {
      return undefined;
    }
    const mapCall = normalized(callee.object);
    if (mapCall.type !== "CallExpression") return undefined;
    const mapCallee = normalized(mapCall.callee);
    const [mapper, ...more] = mapCall.arguments;
    if (
      mapCallee.type !== "MemberExpression" ||
      memberName(mapCallee) !== "map" ||
      mapper === undefined ||
      more.length > 0
    ) {
      return undefined;
    }
    const fn = normalized(mapper);
    const escapes = isEscapeCallee(fn, fn) || isEscapingArrow(fn);
    if (!escapes) return undefined;
    // The separator is pattern text between escaped parts; each known
    // alternative gives one source, and a budget overrun stays one.
    const separator: Value =
      separatorNode === undefined
        ? { kind: "text", text: "," }
        : evaluate(separatorNode, depth);
    if (separator.kind === "too-complex") return separator;
    const options =
      separator.kind === "either" ? separator.options : [separator];
    const sources: Value[] = [];
    for (const option of options) {
      if (option.kind !== "text") return DYNAMIC;
      sources.push({
        kind: "escaped",
        source: `${ESCAPED_PART}${option.text}${ESCAPED_PART}`,
      });
    }
    return either(sources);
  };

  const regExpOf = (args: readonly Argument[], _at: Node, depth = 0): Value => {
    const [sourceNode, flagsNode] = args;
    if (sourceNode?.type === "SpreadElement") return DYNAMIC;
    // Flags spread in, or not known text, leave the flags unknown: the
    // pattern is then read under every flag combination that matters.
    const flagsValue =
      flagsNode === undefined
        ? undefined
        : flagsNode.type === "SpreadElement"
          ? DYNAMIC
          : evaluate(flagsNode, depth);
    // With no flags argument, a regex source keeps its own flags, known or
    // not, and text gets none.
    const flagsFor = (own: string | undefined): string | undefined =>
      flagsValue === undefined
        ? own
        : flagsValue.kind === "text"
          ? flagsValue.text
          : undefined;
    const build = (source: Value): Value => {
      switch (source.kind) {
        case "regex":
          return {
            kind: "regex",
            source: source.source,
            flags: flagsFor(source.flags),
          };
        case "text":
          return { kind: "regex", source: source.text, flags: flagsFor("") };
        case "escaped":
          return { kind: "regex", source: source.source, flags: flagsFor("") };
        case "either":
          return either(source.options.map(build));
        default:
          return source;
      }
    };
    if (sourceNode === undefined) return build({ kind: "text", text: "" });
    return build(evaluate(sourceNode, depth));
  };

  const templateParts = (
    quasis: readonly string[],
    expressions: readonly Expression[],
    depth: number,
  ): Value => {
    let value: Value = { kind: "text", text: "" };
    quasis.forEach((quasi, index) => {
      value = concat(value, { kind: "text", text: quasi });
      const expression = expressions[index];
      if (expression !== undefined) {
        value = concat(value, evaluate(expression, depth));
      }
    });
    return value;
  };

  const compute = (node: Node, depth: number): Value => {
    switch (node.type) {
      case "Literal":
        if ("regex" in node) {
          return {
            kind: "regex",
            source: node.regex.pattern,
            flags: node.regex.flags,
          };
        }
        if (typeof node.value === "string")
          return { kind: "text", text: node.value };
        if (typeof node.value === "number")
          return { kind: "text", text: String(node.value) };
        return DYNAMIC;
      case "TemplateLiteral": {
        const cooked = node.quasis.map((quasi) => quasi.value.cooked);
        if (cooked.some((text) => text === null)) return DYNAMIC;
        return templateParts(cooked as string[], node.expressions, depth);
      }
      case "TaggedTemplateExpression": {
        const tag = normalized(node.tag);
        if (
          tag.type !== "MemberExpression" ||
          memberName(tag) !== "raw" ||
          !isTrustedGlobal(tag.object, "String", node)
        ) {
          return DYNAMIC;
        }
        const raw = node.quasi.quasis.map((quasi) => quasi.value.raw);
        return templateParts(raw, node.quasi.expressions, depth);
      }
      case "BinaryExpression":
        if (node.operator !== "+") return DYNAMIC;
        return concat(evaluate(node.left, depth), evaluate(node.right, depth));
      case "ConditionalExpression":
        return either([
          evaluate(node.consequent, depth),
          evaluate(node.alternate, depth),
        ]);
      case "Identifier": {
        const binding = scopes.resolve(node.name, node);
        if (binding?.kind !== "const") return DYNAMIC;
        return evaluate(binding.init, depth + 1);
      }
      case "MemberExpression": {
        const name = memberName(node);
        if (name !== "source" && name !== "flags") return DYNAMIC;
        const pick = (object: Value): Value => {
          if (object.kind === "either") return either(object.options.map(pick));
          if (object.kind !== "regex")
            return object.kind === "too-complex" ? object : DYNAMIC;
          if (name === "flags") {
            return object.flags === undefined
              ? DYNAMIC
              : { kind: "text", text: object.flags };
          }
          return object.source.includes(ESCAPED_PART)
            ? { kind: "escaped", source: object.source }
            : { kind: "text", text: object.source };
        };
        return pick(evaluate(node.object, depth));
      }
      case "CallExpression": {
        if (isEscapeCallee(node.callee, node)) {
          const [argument] = node.arguments;
          if (argument === undefined || argument.type === "SpreadElement") {
            return { kind: "escaped", source: ESCAPED_PART };
          }
          const escape = (value: Value): Value => {
            if (value.kind === "either")
              return either(value.options.map(escape));
            if (value.kind === "too-complex") return value;
            return value.kind === "text"
              ? { kind: "text", text: RegExp.escape(value.text) }
              : { kind: "escaped", source: ESCAPED_PART };
          };
          return escape(evaluate(argument, depth));
        }
        const joined = escapedJoin(node, depth);
        if (joined !== undefined) return joined;
        if (isGlobalMember(node.callee, "RegExp")) {
          return regExpOf(node.arguments, node, depth);
        }
        return DYNAMIC;
      }
      case "NewExpression":
        if (isGlobalMember(node.callee, "RegExp")) {
          return regExpOf(node.arguments, node, depth);
        }
        return DYNAMIC;
      default:
        return DYNAMIC;
    }
  };

  function evaluate(start: Node, depth: number): Value {
    const node = normalized(start);
    const known = memo.get(node);
    if (known !== undefined) return known;
    if (depth > MAX_DEPTH) return TOO_COMPLEX;
    if (inProgress.has(node)) return DYNAMIC;
    inProgress.add(node);
    const value = compute(node, depth);
    inProgress.delete(node);
    memo.set(node, value);
    return value;
  }

  return {
    valueOf: (node) => evaluate(node, 0),
    isRegExpConstructor: (node) => isGlobalMember(node, "RegExp"),
    regExpOf: (args, at) => regExpOf(args, at),
  };
}
