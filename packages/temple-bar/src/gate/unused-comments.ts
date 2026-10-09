// Only lexical trivia is exempt: a comment cannot hide a token after it.
export function containsOnlyComments(text: string): boolean {
  let index = 0;
  while (index < text.length) {
    if (/\s/u.test(text[index] ?? "")) {
      index++;
    } else if (text.startsWith("///", index)) {
      // Triple-slash comments can carry TypeScript compiler directives.
      return false;
    } else if (text.startsWith("//", index)) {
      index += 2;
      while (
        index < text.length &&
        !/[\r\n\u2028\u2029]/u.test(text[index] ?? "")
      )
        index++;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) return false;
      index = end + 2;
    } else {
      return false;
    }
  }
  return true;
}
