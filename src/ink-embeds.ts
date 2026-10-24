/** An `![[…]]` embed of an SVG image inside node Markdown, e.g. `![[Thermodynamik ink.svg|400]]`. */
export interface SvgEmbed {
  /** Link path as written, without size/alias suffix; resolved by Obsidian relative to the note. */
  link: string;
  raw: string;
}

const SVG_EMBED = /!\[\[([^\]|#]+?\.svg)(?:[|#][^\]]*)?]]/gi;

export function svgEmbeds(markdown: string): SvgEmbed[] {
  const seen = new Set<string>();
  const embeds: SvgEmbed[] = [];
  for (const match of markdown.matchAll(SVG_EMBED)) {
    const link = (match[1] ?? "").trim();
    if (!link || seen.has(link)) continue;
    seen.add(link);
    embeds.push({ link, raw: match[0] });
  }
  return embeds;
}

/** Appends a block on its own paragraph without piling up blank lines. */
function appendBlock(markdown: string, block: string): string {
  const trimmed = markdown.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

export function appendSvgEmbed(markdown: string, link: string): string {
  if (svgEmbeds(markdown).some((embed) => embed.link === link)) return markdown;
  return appendBlock(markdown, `![[${link}]]`);
}

/** Adds `[[target]]` once so Obsidian's graph, backlinks and renames know about an ink link. */
export function ensureWikiLink(markdown: string, target: string): string {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // No lookbehind: Safari before iOS 16.4 cannot parse it, and Obsidian mobile runs on WebKit.
  if (new RegExp(`(^|[^!])\\[\\[${escaped}(?:[|#][^\\]]*)?]]`).test(markdown)) return markdown;
  return appendBlock(markdown, `[[${target}]]`);
}

/** Obsidian's default file name for a new drawing; the attachment API appends a counter on collisions. */
export function inkFileName(noteBasename: string): string {
  const safe = noteBasename.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Drawing";
  return `${safe} ink.svg`;
}
