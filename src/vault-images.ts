import { assetPathCandidates, describeAssetRejection, isImagePath, resolveAssetPath, type ImageRefSyntax } from "./asset-path";

/**
 * Images that a node refers to, checked against the vault with the same path rule the web app and
 * the desktop app use (`asset-path`, shared Core code).
 *
 * Obsidian draws the images itself — `MarkdownRenderer` resolves `![](path)` and `![[image.png]]`
 * and renders Mermaid blocks natively — so the plugin needs no image viewer of its own. What it adds
 * is the one thing a broken image icon cannot say: which path could not be found.
 */

export interface VaultImageHost {
  /** True when the vault has a file at exactly this path. */
  hasFile(path: string): boolean;
  /** Obsidian's own link lookup (shortest path, links without extension, …): the path it finds, or null. */
  resolveLink(link: string, sourcePath: string): string | null;
}

export interface EmbedReference {
  /** The link as Obsidian parsed it, without alias or size. */
  link: string;
  /** The text as written in the note, e.g. `![[a.png|200]]` or `![x](a.png)`. */
  original: string;
}

export type VaultImageResult = { found: true; path: string } | { found: false; path: string; problem: string };

export function syntaxOf(original: string): ImageRefSyntax {
  return original.startsWith("![[") ? "wiki" : "markdown";
}

/** Looks the image up the way the other platforms do first, then the way Obsidian itself would. */
export function findVaultImage(host: VaultImageHost, sourcePath: string, target: string, syntax: ImageRefSyntax): VaultImageResult {
  const resolved = resolveAssetPath(sourcePath, target);
  if (resolved.kind === "remote") return { found: true, path: resolved.url };
  if (resolved.kind === "invalid") return { found: false, path: target.trim(), problem: describeAssetRejection(resolved.reason) };
  for (const candidate of assetPathCandidates(sourcePath, target, syntax)) {
    if (host.hasFile(candidate)) return { found: true, path: candidate };
  }
  // Obsidian finds `![[a.png]]` by name from anywhere in the vault and handles links without extension.
  const byObsidian = host.resolveLink(resolved.path, sourcePath) ?? host.resolveLink(target.trim(), sourcePath);
  if (byObsidian) return { found: true, path: byObsidian };
  return { found: false, path: resolved.path, problem: "not found in the vault" };
}

/**
 * The images in `markdown` that neither the shared rule nor Obsidian can find. `embeds` are the
 * source note's embeds from Obsidian's metadata cache; only those that appear in `markdown` (the
 * node being rendered) count.
 */
export function unresolvedImages(host: VaultImageHost, sourcePath: string, markdown: string, embeds: readonly EmbedReference[]): Array<{ path: string; problem: string }> {
  const seen = new Set<string>();
  const missing: Array<{ path: string; problem: string }> = [];
  for (const embed of embeds) {
    if (!isImagePath(embed.link) || !markdown.includes(embed.original)) continue;
    const result = findVaultImage(host, sourcePath, embed.link, syntaxOf(embed.original));
    if (result.found || seen.has(result.path)) continue;
    seen.add(result.path);
    missing.push({ path: result.path, problem: result.problem });
  }
  return missing;
}
