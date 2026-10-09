// Read structural tokens through markdownlint's public custom-rule API.
// A second Markdown grammar would disagree about examples and destinations.
import type { MicromarkToken, Rule } from "markdownlint";
import { lint } from "markdownlint/sync";

import type { LocalTarget } from "./links.ts";

const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const CITED_PATH = /^(?:\.{1,2}\/)*[\w@.-]+(?:\/[\w@.-]+)*\/?$/;
const ESCAPED_PUNCTUATION = /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g;
const HTML_TAG =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const HTML_ATTRIBUTE =
  /([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

interface HtmlState {
  rawText?: string;
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
  state: HtmlState,
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
  state: HtmlState,
): void {
  for (const token of tokens) {
    const line = offset + token.startLine;
    if (token.type === "htmlFlow" || token.type === "htmlText") {
      htmlTargets(token.text, line, targets, state);
    } else if (state.rawText !== undefined) {
      readTokens(token.children, offset, targets, state);
    } else if (
      token.type === "resourceDestinationString" ||
      token.type === "definitionDestinationString"
    ) {
      addLink(targets, line, token.text.replace(ESCAPED_PUNCTUATION, "$1"));
    } else if (token.type === "codeText") {
      const marker = /^`+/.exec(token.text)?.[0] ?? "";
      const span = token.text.slice(marker.length, -marker.length).trim();
      if (span.includes("/") && CITED_PATH.test(span)) {
        targets.push({ line, target: span, kind: "cited path" });
      }
    } else {
      readTokens(token.children, offset, targets, state);
    }
  }
}

/** Local destinations and cited code paths in rendered Markdown, excluding
 * comments, front matter and code blocks. Definitions retain their own line. */
export function extractLocalTargets(markdown: string): LocalTarget[] {
  const targets: LocalTarget[] = [];
  const capture: Rule = {
    names: ["temple-bar-targets"],
    description: "Read local Markdown destinations",
    tags: ["links"],
    parser: "micromark",
    function(params) {
      readTokens(
        params.parsers.micromark.tokens,
        params.frontMatterLines.length,
        targets,
        {},
      );
    },
  };
  lint({
    strings: { document: markdown },
    config: { default: false, "temple-bar-targets": true },
    customRules: [capture],
    // Inline lint directives cannot hide a link from the independent check.
    noInlineConfig: true,
  });
  return targets.sort(
    (a, b) =>
      a.line - b.line ||
      (a.kind === b.kind ? 0 : a.kind === "cited path" ? -1 : 1),
  );
}
