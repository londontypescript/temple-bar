// Which declaration a name in a test file refers to, by JavaScript's own
// scope rules, so the test-shapes check can follow a local `const` to its
// value and never follow a name that something closer shadows. Only what
// the check needs: a `const` with its initializer, or "something else".

import type { Expression, Node, Program } from "oxc-parser";

export type Binding =
  | { readonly kind: "const"; readonly init: Expression }
  | { readonly kind: "other" };

const OTHER: Binding = { kind: "other" };

class Scope {
  readonly names = new Map<string, Binding>();
  readonly parent: Scope | undefined;
  readonly isFunction: boolean;
  readonly strict: boolean;
  constructor(parent: Scope | undefined, isFunction: boolean, strict: boolean) {
    this.parent = parent;
    this.isFunction = isFunction;
    this.strict = strict;
  }
  declare(name: string, binding: Binding): void {
    // Two declarations of one name in one scope: neither is followed.
    this.names.set(name, this.names.has(name) ? OTHER : binding);
  }
  functionScope(): Scope {
    return this.isFunction || this.parent === undefined
      ? this
      : this.parent.functionScope();
  }
}

export interface Scopes {
  /** The binding `name` has where `at` sits, or undefined for a name the
   * file never declares (a global). */
  resolve(name: string, at: Node): Binding | undefined;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Every child node of `node`, in source order of its fields. */
export function childNodes(node: Node): Node[] {
  const children: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const item of value as unknown[]) {
        if (isNode(item)) children.push(item);
      }
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}

/** The names a binding pattern declares: `a`, `{ a, b: [c] }`, `...d`. */
function boundNames(pattern: Node | null | undefined, out: string[]): void {
  if (pattern === null || pattern === undefined) return;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        boundNames(
          property.type === "RestElement" ? property.argument : property.value,
          out,
        );
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) boundNames(element, out);
      break;
    case "RestElement":
      boundNames(pattern.argument, out);
      break;
    case "AssignmentPattern":
      boundNames(pattern.left, out);
      break;
    case "TSParameterProperty":
      boundNames(pattern.parameter, out);
      break;
    default:
      break;
  }
}

function hasUseStrict(body: readonly Node[]): boolean {
  for (const statement of body) {
    if (statement.type !== "ExpressionStatement") return false;
    if (!("directive" in statement)) return false;
    if (statement.directive === "use strict") return true;
  }
  return false;
}

function declareVariables(node: Node, scope: Scope): void {
  if (node.type !== "VariableDeclaration") return;
  const target = node.kind === "var" ? scope.functionScope() : scope;
  for (const declarator of node.declarations) {
    const names: string[] = [];
    boundNames(declarator.id, names);
    const followable =
      node.kind === "const" &&
      node.declare !== true &&
      declarator.id.type === "Identifier" &&
      declarator.init !== null;
    for (const name of names) {
      target.declare(
        name,
        followable && declarator.init !== null
          ? { kind: "const", init: declarator.init }
          : OTHER,
      );
    }
  }
}

/** Builds the scopes of `program`. `strict` says whether the file as a
 * whole is known strict (module syntax, an .mjs/.mts name, or a
 * "use strict" directive); class bodies and functions with the directive
 * are strict whatever the file is. */
export function buildScopes(program: Program, strict: boolean): Scopes {
  const scopeAt = new Map<Node, Scope>();
  const root = new Scope(undefined, true, strict || hasUseStrict(program.body));

  const visit = (node: Node, scope: Scope): void => {
    scopeAt.set(node, scope);
    switch (node.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression": {
        if (node.type === "FunctionDeclaration" && node.id !== null) {
          scope.declare(node.id.name, OTHER);
          // Outside strict code, a function declared in a block is also a
          // binding of the whole function (Annex B): the reading that
          // follows less.
          if (!scope.strict && !scope.isFunction) {
            scope.functionScope().declare(node.id.name, OTHER);
          }
        }
        const body = node.body;
        const bodyStatements =
          body !== null && body.type === "BlockStatement" ? body.body : [];
        const inner = new Scope(
          scope,
          true,
          scope.strict || hasUseStrict(bodyStatements),
        );
        if (node.type === "FunctionExpression" && node.id !== null) {
          inner.declare(node.id.name, OTHER);
        }
        for (const param of node.params) {
          const names: string[] = [];
          boundNames(param, names);
          for (const name of names) inner.declare(name, OTHER);
        }
        for (const child of childNodes(node)) {
          if (child === node.id) continue;
          visit(child, inner);
        }
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        if (node.type === "ClassDeclaration" && node.id !== null) {
          scope.declare(node.id.name, OTHER);
        }
        const inner = new Scope(scope, false, true);
        if (node.type === "ClassExpression" && node.id !== null) {
          inner.declare(node.id.name, OTHER);
        }
        for (const child of childNodes(node)) visit(child, inner);
        return;
      }
      case "SwitchStatement": {
        visit(node.discriminant, scope);
        const inner = new Scope(scope, false, scope.strict);
        for (const switchCase of node.cases) visit(switchCase, inner);
        return;
      }
      case "CatchClause": {
        const inner = new Scope(scope, false, scope.strict);
        const names: string[] = [];
        boundNames(node.param, names);
        for (const name of names) inner.declare(name, OTHER);
        for (const child of childNodes(node)) visit(child, inner);
        return;
      }
      case "BlockStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "StaticBlock":
      case "TSModuleBlock": {
        const inner = new Scope(
          scope,
          node.type === "StaticBlock" || node.type === "TSModuleBlock",
          scope.strict,
        );
        for (const child of childNodes(node)) visit(child, inner);
        return;
      }
      case "ImportDeclaration":
        for (const specifier of node.specifiers) {
          scope.declare(specifier.local.name, OTHER);
        }
        return;
      case "TSImportEqualsDeclaration":
      case "TSEnumDeclaration":
        scope.declare(node.id.name, OTHER);
        break;
      case "TSModuleDeclaration":
        if (node.id.type === "Identifier") scope.declare(node.id.name, OTHER);
        break;
      case "VariableDeclaration":
        declareVariables(node, scope);
        break;
      default:
        break;
    }
    for (const child of childNodes(node)) visit(child, scope);
  };
  visit(program, root);

  return {
    resolve(name, at) {
      for (let scope = scopeAt.get(at); scope; scope = scope.parent) {
        const binding = scope.names.get(name);
        if (binding !== undefined) return binding;
      }
      return undefined;
    },
  };
}

/** Looks through what changes nothing at run time: TypeScript's type
 * wrappers, optional chains and a comma expression's last operand. */
export function normalized(node: Node): Node {
  let inner = node;
  for (;;) {
    switch (inner.type) {
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "TSInstantiationExpression":
      case "ChainExpression":
        inner = inner.expression;
        break;
      case "SequenceExpression": {
        const last = inner.expressions.at(-1);
        if (last === undefined) return inner;
        inner = last;
        break;
      }
      default:
        return inner;
    }
  }
}

/** A member's name when it is written as a constant: `a.b`, `a["b"]`. */
export function memberName(node: Node): string | undefined {
  if (node.type !== "MemberExpression") return undefined;
  if (!node.computed) return node.property.name;
  const property = normalized(node.property);
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  if (
    property.type === "TemplateLiteral" &&
    property.expressions.length === 0
  ) {
    return property.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}
