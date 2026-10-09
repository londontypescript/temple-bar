// Exact output identities from published packages, not markers or version text.
// Frozen bytes, release tarball integrity and git provenance live separately in
// testing/published-output. When a template changes, register its last published
// output here; the independent fixture regression rejects a forgotten upgrade.

import { createHash } from "node:crypto";

export const EARLIER_OUTPUT_HASHES: Readonly<
  Record<string, readonly string[]>
> = {
  "hooks/pre-commit": [
    // 0.0.1–0.0.3
    "c8516a24ea300186603b86e8e5f1fe758774796a76248657fa5e5600346ae729",
    // 0.0.4
    "7c235b3cd21e21871f64fe467237bfe814fc3b01f21d72cf425eba86755db9b2",
    // 0.0.5–0.0.8
    "a6ca3aaa30ec8dfc8062946333b25bf0d027581ff95af67405b7558c75c43dd2",
  ],
  "hooks/reference-transaction": [
    // 0.0.1–0.0.3
    "75971844b8a72064af9970d8bd01f61fc4b094315b4f847542860ba8e7de2590",
    // 0.0.4
    "5355d5e846b2dfdb735f6421a52dad84d08e03676e9e59cd515c23cb5acd8a94",
    // 0.0.5–0.0.8
    "e49c12e2f76bb87475d42c18bd949376f37809cfd746cabca5c03774dc1a62b3",
  ],
  "hooks/commit-msg": [
    // 0.0.5–0.0.8
    "4cd997f2219c3dda0363ea75198679a787d7312bb4ca1bb539131ed5f277ad42",
  ],
  "hooks/pre-push": [
    // 0.0.5–0.0.8
    "3e5b7e5eeab8f58bb717cdc19e31f85e04480b31c0c428a2d09219e2bbbc4ea0",
  ],
  "hooks/post-checkout": [
    // 0.0.5–0.0.7
    "2917b58cc9b7791b577edfc77514c49c29bd56d6fc447f57ac691c3e8a54ce43",
  ],
  ".github/workflows/temple-bar-judge.yml": [
    // 0.0.7
    "7c0a0d52a68da892b87cbea36066a232a0cca27f87df82f15177db8d15485c53",
  ],
};

/** Hook ownership is byte-exact. Workflows permit only CRLF-to-LF, just as
 * their exact-copy gate does; trailing whitespace and final newlines count. */
export function outputHash(item: string, content: string): string {
  const text = item.startsWith("hooks/")
    ? content
    : content.replaceAll("\r\n", "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isEarlierOutput(item: string, content: string): boolean {
  return (
    EARLIER_OUTPUT_HASHES[item]?.includes(outputHash(item, content)) === true
  );
}
