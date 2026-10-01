// Real stdin reader for `createHookCommand` (command.ts), which only needs
// one for `reference-transaction`. Not a seam in context.ts: router.ts wires
// this in directly, and unit tests pass their own reader instead.

export function readRealStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", reject);
  });
}
