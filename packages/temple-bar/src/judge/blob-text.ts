// A file's text as both readers must take it: from bytes proven to be the
// blob the tree names, decoded as UTF-8 with every error refused. The judge
// gets bytes from GitHub and decodes them here; `ready` and `merge` get text
// that git's seam has already decoded, so they prove it by encoding it back
// and checking it is still the same blob. Either way a file that isn't
// valid UTF-8 is unreadable, in the same words, so the two readers name the
// same finding for it.

import { createHash } from "node:crypto";

/** Why a side is unreadable when its bytes are proven but aren't UTF-8. */
export const NOT_UTF8 = "it isn't valid UTF-8";

/** git's own id for a blob with these bytes. */
export function blobId(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest("hex");
}

// `ignoreBOM: true` keeps a leading byte order mark in the text. By default
// the decoder drops it, and then a BOM added to a file would be invisible to
// the judge alone, while git's seam hands it over.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The bytes as text, or undefined when they aren't valid UTF-8 (an
 * overlong form, a surrogate encoded as bytes, a stray byte). */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Whether text handed over already decoded is exactly the blob `id`. A
 * decoder that met bytes that aren't UTF-8 put U+FFFD in their place, so
 * the text no longer encodes back to the same bytes, and so to the same
 * id. */
export function isTextOfBlob(text: string, id: string): boolean {
  return blobId(Buffer.from(text, "utf8")) === id;
}
