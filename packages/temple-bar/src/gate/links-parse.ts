// Read structural tokens through markdownlint's public custom-rule API.
// A second Markdown grammar would disagree about examples and destinations.
import type { MicromarkToken, Rule } from "markdownlint";
import { lint } from "markdownlint/sync";

import type { LocalTarget } from "./links.ts";

const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const ESCAPED_PUNCTUATION = /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g;
const HTML_TAG =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const HTML_ATTRIBUTE =
  /([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

interface ParseState {
  rawText?: string;
  readonly definitions: Map<string, LocalTarget>;
  readonly references: Set<string>;
  readonly undefinedReferences: MicromarkToken[];
  readonly rawTextTokens: MicromarkToken[];
}

function descendant(
  token: MicromarkToken | undefined,
  type: string,
): MicromarkToken | undefined {
  for (const child of token?.children ?? []) {
    if (child.type === type) {
      return child;
    }
    const found = descendant(child, type);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function label(token: MicromarkToken | undefined): string {
  // Container prefixes are not part of multiline reference labels.
  return (
    token?.children
      .filter((child) => child.type !== "blockQuotePrefix")
      .map((child) => child.text)
      .join("") ?? ""
  )
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase()
    .toUpperCase();
}

function addLink(targets: LocalTarget[], line: number, raw: string): void {
  const target = raw.trim();
  if (target !== "" && !NOT_LOCAL.test(target)) {
    targets.push({ line, target, kind: "link" });
  }
}

function htmlTargets(
  text: string,
  line: number,
  targets: LocalTarget[],
  state: ParseState,
): void {
  const tags = new RegExp(HTML_TAG);
  let tag: RegExpExecArray | null;
  while (tags.lastIndex < text.length) {
    if (state.rawText !== undefined) {
      const closing = new RegExp(`</${state.rawText}\\s*>`, "gi");
      closing.lastIndex = tags.lastIndex;
      const end = closing.exec(text);
      if (end === null) {
        return;
      }
      tags.lastIndex = end.index + end[0].length;
      delete state.rawText;
    }
    tag = tags.exec(text);
    if (tag === null) {
      return;
    }
    const name = tag[1];
    if (name === undefined || tag[0].startsWith("</")) {
      continue;
    }
    // Scan whole attributes: href-looking text inside another value is prose.
    const attributes = tag[0].slice(1 + name.length, -1);
    for (const attribute of attributes.matchAll(HTML_ATTRIBUTE)) {
      if (/^(?:href|src)$/i.test(attribute[1] ?? "")) {
        const before = text.slice(
          0,
          tag.index + 1 + name.length + attribute.index,
        );
        const offset = before.split(/\r\n|\r|\n/).length - 1;
        addLink(
          targets,
          line + offset,
          attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
        );
      }
    }
    // These elements contain raw text, where tag-looking strings are examples.
    if (/^(?:script|style|textarea)$/i.test(name)) {
      state.rawText = name;
    }
  }
}

function readTokens(
  tokens: readonly MicromarkToken[],
  offset: number,
  targets: LocalTarget[],
  state: ParseState,
): void {
  for (const token of tokens) {
    const line = offset + token.startLine;
    if (token.type === "htmlFlow" || token.type === "htmlText") {
      htmlTargets(token.text, line, targets, state);
    } else if (state.rawText !== undefined) {
      if (token.children.length === 0) {
        state.rawTextTokens.push(token);
      }
      readTokens(token.children, offset, targets, state);
    } else if (token.type === "definition") {
      const name = label(descendant(token, "definitionLabelString"));
      const destination = descendant(token, "definitionDestinationString");
      // Rendering selects the first definition. Unused definitions and later
      // duplicates do not create a navigable link.
      if (destination !== undefined && !state.definitions.has(name)) {
        state.definitions.set(name, {
          line: offset + destination.startLine,
          target: destination.text.replace(ESCAPED_PUNCTUATION, "$1"),
          kind: "link",
        });
      }
    } else if (
      ["undefinedReferenceFull", "undefinedReferenceCollapsed"].includes(
        token.type,
      )
    ) {
      state.undefinedReferences.push(token);
      readTokens(token.children, offset, targets, state);
    } else if (token.type === "resourceDestinationString") {
      addLink(targets, line, token.text.replace(ESCAPED_PUNCTUATION, "$1"));
    } else if (token.type === "link" || token.type === "image") {
      if (!token.children.some((child) => child.type === "resource")) {
        // A nested image can have its own reference. Only this link's direct
        // reference or label selects its definition; recurse separately below.
        const reference = token.children.find(
          (child) => child.type === "reference",
        );
        const text = token.children.find((child) => child.type === "label");
        state.references.add(
          label(
            descendant(reference, "referenceString") ??
              descendant(text, "labelText"),
          ),
        );
      }
      readTokens(token.children, offset, targets, state);
    } else if (token.type === "codeText") {
      continue;
    } else {
      readTokens(token.children, offset, targets, state);
    }
  }
}

/** Read both mandatory integrity checks through the same token walk, so
 * code, comments and HTML raw-text examples have one interpretation. */
export function readMarkdownTokens(
  tokens: readonly MicromarkToken[],
  offset: number,
): { targets: LocalTarget[]; undefinedReferences: MicromarkToken[] } {
  const targets: LocalTarget[] = [];
  const state: ParseState = {
    definitions: new Map(),
    references: new Set(),
    undefinedReferences: [],
    rawTextTokens: [],
  };
  readTokens(tokens, offset, targets, state);
  for (const reference of state.references) {
    const definition = state.definitions.get(reference);
    if (definition !== undefined) {
      addLink(targets, definition.line, definition.target);
    }
  }
  return {
    targets: targets.sort((a, b) => a.line - b.line),
    // The parser appends unresolved-reference tokens after the content tree.
    // Their source position, not traversal state, identifies raw-text examples.
    undefinedReferences: state.undefinedReferences.filter(
      (token) =>
        !state.rawTextTokens.some(
          (raw) =>
            (token.startLine > raw.startLine ||
              (token.startLine === raw.startLine &&
                token.startColumn >= raw.startColumn)) &&
            (token.startLine < raw.endLine ||
              (token.startLine === raw.endLine &&
                token.startColumn < raw.endColumn)),
        ),
    ),
  };
}

/** Local destinations in rendered Markdown, excluding
 * comments, front matter and code blocks. Definitions retain their own line. */
export function extractLocalTargets(markdown: string): LocalTarget[] {
  let targets: LocalTarget[] = [];
  const capture: Rule = {
    names: ["temple-bar-targets"],
    description: "Read local Markdown destinations",
    tags: ["links"],
    parser: "micromark",
    function(params) {
      targets = readMarkdownTokens(
        params.parsers.micromark.tokens,
        params.frontMatterLines.length,
      ).targets;
    },
  };
  lint({
    strings: { document: markdown },
    config: { default: false, "temple-bar-targets": true },
    customRules: [capture],
    // Inline lint directives cannot hide a link from the independent check.
    noInlineConfig: true,
  });
  return targets;
}
