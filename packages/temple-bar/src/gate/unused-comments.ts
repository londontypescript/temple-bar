// Only lexical trivia is exempt: a comment cannot hide a token after it.
// Compiler pragmas and JSDoc declarations carry meaning despite being trivia.
function hasDirective(comment: string): boolean {
  return /@(?:ts-(?:check|nocheck|ignore|expect-error)|jsx(?:Runtime|ImportSource|Frag)?|typedef|callback|import|template|type|enum|namespace|satisfies)\b|[#@]\s*(?:sourceMappingURL|sourceURL)\s*=/u.test(
    comment,
  );
}

export function containsOnlyComments(text: string): boolean {
  let index = 0;
  while (index < text.length) {
    if (/\s/u.test(text[index] ?? "")) {
      index++;
    } else if (text.startsWith("///", index)) {
      // Triple-slash comments can carry TypeScript compiler directives.
      return false;
    } else if (text.startsWith("//", index)) {
      const start = index;
      index += 2;
      while (
        index < text.length &&
        !/[\r\n\u2028\u2029]/u.test(text[index] ?? "")
      )
        index++;
      if (hasDirective(text.slice(start, index))) return false;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end < 0 || hasDirective(text.slice(index, end))) return false;
      index = end + 2;
    } else {
      return false;
    }
  }
  return true;
}
