// @ts-check
import path from "node:path";
import { includeIgnoreFile } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

// A test that builds a regular expression from text must escape that text
// with RegExp.escape: hand-rolled escaping has missed a backslash or a dot
// in tests before, and CodeQL only says so after the push. Where no pattern
// is needed, a test compares the exact text instead.
/** @param {any} node */
function isRegExpEscape(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "RegExp" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "escape"
  );
}

// Type-only wrappers (`as`, `satisfies`, `!`, `<T>`) change nothing at run
// time, so the rule looks through them rather than let them hide a pattern.
const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/** @param {any} node */
function unwrapped(node) {
  let inner = node;
  while (TYPE_WRAPPERS.has(inner.type)) inner = inner.expression;
  return inner;
}

/**
 * The values in a pattern built from a template, a tagged template or a
 * concatenation that RegExp.escape doesn't wrap.
 * @param {any} wrapped
 * @returns {any[]}
 */
function unescapedParts(wrapped) {
  const node = unwrapped(wrapped);
  if (node.type === "TemplateLiteral") {
    return node.expressions.flatMap(unescapedOperand);
  }
  if (node.type === "TaggedTemplateExpression") {
    return node.quasi.expressions.flatMap(unescapedOperand);
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return [...unescapedOperand(node.left), ...unescapedOperand(node.right)];
  }
  return [];
}

/**
 * @param {any} wrapped
 * @returns {any[]}
 */
function unescapedOperand(wrapped) {
  const node = unwrapped(wrapped);
  if (isRegExpEscape(node) || node.type === "Literal") return [];
  if (
    node.type === "TemplateLiteral" ||
    node.type === "TaggedTemplateExpression" ||
    (node.type === "BinaryExpression" && node.operator === "+")
  ) {
    return unescapedParts(node);
  }
  return [node];
}

/** @type {import("eslint").Rule.RuleModule} */
const escapedRegExpText = {
  meta: {
    type: "problem",
    messages: {
      unescaped:
        "Wrap this value in RegExp.escape, or compare the exact text instead of building a pattern.",
    },
    schema: [],
  },
  create(context) {
    /** @param {any} node */
    function check(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== "RegExp") {
        return;
      }
      const [source] = node.arguments;
      if (source === undefined) return;
      for (const part of unescapedParts(source)) {
        context.report({ node: part, messageId: "unescaped" });
      }
    }
    return { NewExpression: check, CallExpression: check };
  },
};

export default tseslint.config(
  // Skip whatever git ignores, so a worktree inside the repo (a whole
  // checkout of another branch) is never linted as part of this one.
  includeIgnoreFile(path.join(import.meta.dirname, ".gitignore"), {
    gitignoreResolution: true,
  }),
  {
    ignores: ["**/dist/", "**/node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // eslint.config.js itself is tooling config, not part of any tsconfig
    // project, so it cannot carry type-aware linting.
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Test code only: the files the test runner loads and their helpers.
    files: ["**/*.test.ts", "**/testing/**/*.ts", "e2e/**/*.ts"],
    plugins: {
      "temple-bar-tests": {
        rules: { "escaped-regexp-text": escapedRegExpText },
      },
    },
    rules: { "temple-bar-tests/escaped-regexp-text": "error" },
  },
  eslintConfigPrettier,
);
