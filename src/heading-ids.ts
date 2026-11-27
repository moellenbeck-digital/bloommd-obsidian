/**
 * Heading ids for notes the map only reads. Core's `ensureHeadingIds` hands out random ids, which
 * is fine when they are written at once; opening a map must not touch the note, so the ids it shows
 * have to be the same every time the note is read until the first edit writes them. Here an id is
 * derived from the heading line itself (and how often the same line came before), so the map, its
 * layout and learning progress, and the first edit all see the same ids without a write in between.
 */
import { ensureHeadingIds } from "./markdown-document";

const ID_COMMENT = /<!--\s*bloommd:id=([^\s>]*?)\s*-->/gi;
const TRAILING_ID = /<!--\s*bloommd:id=([^\s>]*?)\s*-->$/i;

/** cyrb53: a small, stable 53-bit string hash; ids are not secrets, they only have to repeat. */
function hash(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const toId = (key: string) => hash(key).toString(16).padStart(14, "0").slice(-12);

/**
 * Gives every heading without a usable id one, like `ensureHeadingIds`, but with the same id on
 * every call for the same note. Existing ids stay; the result is what the file looks like once the
 * ids are written, so it can be shown, edited and later saved without ids changing.
 */
export function assignHeadingIds(markdown: string): { markdown: string; changed: boolean } {
  const ensured = ensureHeadingIds(markdown);
  if (!ensured.changed) return ensured;

  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const before = markdown.split(/\r?\n/);
  const after = ensured.markdown.split(eol);
  const used = new Set<string>();
  after.forEach((line, index) => {
    if (line !== before[index]) return;
    for (const match of line.matchAll(ID_COMMENT)) used.add(match[1] ?? "");
  });

  const occurrences = new Map<string, number>();
  after.forEach((line, index) => {
    const original = before[index] ?? "";
    if (line === original) return;
    const random = TRAILING_ID.exec(line)?.[1];
    if (!random) return;
    // A stale id the note carried (a duplicated heading) is not part of the key: the line is.
    const text = original.replace(ID_COMMENT, "").trim();
    const seen = occurrences.get(text) ?? 0;
    occurrences.set(text, seen + 1);
    let attempt = 0;
    let id = toId(`${text}\u0000${seen}`);
    while (used.has(id)) id = toId(`${text}\u0000${seen}\u0000${(attempt += 1)}`);
    used.add(id);
    after[index] = line.replace(TRAILING_ID, `<!-- bloommd:id=${id} -->`);
  });
  return { markdown: after.join(eol), changed: true };
}
