// Real stdin reader for `createHookCommand` (command.ts), which only needs
// one for `reference-transaction`. Not a seam (context.ts, owned by 1.4/1.6,
// isn't touched here): router.ts wires this in directly, the same way
// hook.test-entry.ts wires in its own reader for tests.

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
