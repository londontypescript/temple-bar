// Turns the chunks a child process writes into whole lines. A chunk can end
// in the middle of a line or in the middle of a multi-byte character, and
// Windows ends lines with CRLF, so reading chunks as lines would misread a
// result record that happened to straddle two of them.

import { StringDecoder } from "node:string_decoder";

export class LineBuffer {
  readonly #decoder = new StringDecoder("utf8");
  #rest = "";

  /** The complete lines this chunk finished (without their line ends). */
  push(chunk: Buffer | string): string[] {
    const text = typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
    return this.#take(text);
  }

  /** The last, unfinished line if there is one: a stream that stops without
   * a final newline still shows what it was saying. */
  end(): string[] {
    const lines = this.#take(this.#decoder.end());
    if (this.#rest !== "") {
      lines.push(this.#rest.replace(/\r$/, ""));
      this.#rest = "";
    }
    return lines;
  }

  #take(text: string): string[] {
    const parts = (this.#rest + text).split("\n");
    this.#rest = parts.pop() ?? "";
    return parts.map((line) => line.replace(/\r$/, ""));
  }
}
