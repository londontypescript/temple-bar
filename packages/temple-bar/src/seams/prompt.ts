// The only place domain code asks the user a yes/no question.
//
// Design choice: with no TTY, `confirm` resolves to "no-terminal" rather than
// rejecting or blocking. A rejection would force every caller to wrap the
// call in try/catch just to reach the same "print the steps and exit
// non-zero" behaviour that `init` (1.7) needs; a distinct resolved value
// reads the same as the other two outcomes at the call site.

import readline from "node:readline/promises";

export type ConfirmResult = "yes" | "no" | "no-terminal";

export interface PromptSeam {
  isInteractive(): boolean;
  /** Never blocks: resolves "no-terminal" immediately when there is no TTY. */
  confirm(question: string): Promise<ConfirmResult>;
}

function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export function createPromptSeam(): PromptSeam {
  return {
    isInteractive,
    async confirm(question) {
      if (!isInteractive()) {
        return "no-terminal";
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        const answer = await rl.question(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer.trim()) ? "yes" : "no";
      } finally {
        rl.close();
      }
    },
  };
}
