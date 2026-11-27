/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/core/src/asset-path.ts by the BloomMD mirror sync.
 * Source SHA-256: 1697ca0bc76b832946373b5b642d7e9d7acbd2d555ea30b1d4071920d698648b
 */
/**
 * Resolution of image and attachment references inside a note.
 *
 * Web (local workspace), Desktop and the Obsidian plugin all show images that a note refers to by a
 * relative path. They share this one rule, so `![](../img/a b.png)` means the same file everywhere.
 * Pure string logic: no `node:path`, no filesystem, safe for every bundle.
 */

export const IMAGE_EXTENSIONS = ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"] as const;

const IMAGE_MIME_TYPES: Record<(typeof IMAGE_EXTENSIONS)[number], string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export type AssetPathRejection = "empty" | "escapes-workspace" | "unsupported-scheme" | "absolute-path" | "control-characters";

export type AssetPathResult =
  /**
   * A file inside the workspace; `path` is normalized and `/`-separated. It is relative to the
   * workspace root, except when the note itself is known by an absolute path (the desktop app opens
   * notes that way): then `path` is absolute too, and the shell checks that it stays inside its
   * folder before it reads anything.
   */
  | { kind: "workspace"; path: string }
  /** A URL the browser can load itself (`https:`, `blob:`, `data:image/…`). */
  | { kind: "remote"; url: string }
  | { kind: "invalid"; reason: AssetPathRejection };

export type ImageRefSyntax = "markdown" | "wiki";

const REMOTE_PATTERN = /^(https?:\/\/|blob:|data:image\/)/i;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function imageExtension(path: string): string | null {
  const extension = path.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase();
  return extension && (IMAGE_EXTENSIONS as readonly string[]).includes(extension) ? extension : null;
}

export function isImagePath(path: string): boolean {
  return imageExtension(path) !== null;
}

export function imageMimeType(path: string): string | null {
  const extension = imageExtension(path);
  return extension ? IMAGE_MIME_TYPES[extension as keyof typeof IMAGE_MIME_TYPES] : null;
}

function decodeTarget(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray `%` in a file name is not an escape sequence; keep the text as written.
    return value;
  }
}

function directorySegments(notePath: string): string[] {
  const segments = notePath.replace(/\\/g, "/").split("/").filter((segment) => segment !== "" && segment !== ".");
  segments.pop();
  return segments;
}

function isAbsoluteNotePath(notePath: string): boolean {
  return notePath.replace(/\\/g, "/").startsWith("/");
}

/**
 * Resolves `target` as written in the note at `notePath` (`/`-separated; workspace-relative, or
 * absolute where the shell opens notes by absolute path).
 *
 * - `./a.png` and `a.png` are relative to the note's folder, `../a.png` climbs out of it.
 * - `/a.png` is relative to the workspace root (not resolvable for a note with an absolute path).
 * - Spaces, umlauts, `%20` escapes and `<a b.png>` brackets all work.
 * - Anything that would leave the workspace (`../` past the root, drive letters, `file:`) is rejected.
 */
export function resolveAssetPath(notePath: string, target: string): AssetPathResult {
  let value = target.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (!value) return { kind: "invalid", reason: "empty" };
  if (REMOTE_PATTERN.test(value)) return { kind: "remote", url: value };
  if (value.startsWith("//") || /^[A-Za-z]:[\\/]/.test(value)) return { kind: "invalid", reason: value.startsWith("//") ? "unsupported-scheme" : "absolute-path" };
  if (SCHEME_PATTERN.test(value) && !/^[A-Za-z]:/.test(value)) return { kind: "invalid", reason: "unsupported-scheme" };

  const decoded = decodeTarget(value).replace(/\\/g, "/");
  if (CONTROL_CHARACTERS.test(decoded)) return { kind: "invalid", reason: "control-characters" };

  // The last segment has to name a file: "./", ".." and "dir/" point at folders.
  const lastSegment = decoded.split("/").pop();
  if (!lastSegment || lastSegment === "." || lastSegment === "..") return { kind: "invalid", reason: "empty" };

  const fromRoot = decoded.startsWith("/");
  const absoluteNote = isAbsoluteNotePath(notePath);
  // Where the workspace root is, is not known for an absolute note: only its own folder can be reached.
  if (fromRoot && absoluteNote) return { kind: "invalid", reason: "absolute-path" };
  const resolved: string[] = fromRoot ? [] : directorySegments(notePath);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return { kind: "invalid", reason: "escapes-workspace" };
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  if (resolved.length === 0) return { kind: "invalid", reason: "empty" };
  return { kind: "workspace", path: `${absoluteNote ? "/" : ""}${resolved.join("/")}`.normalize("NFC") };
}

/**
 * Workspace paths to try, in order, for a reference.
 *
 * Markdown images are explicit: one path. An Obsidian embed (`![[a.png]]`) is looked up by name, so
 * the note's own folder comes first, then the workspace root; a host that can match by file name
 * (the browser workspace does) finds the rest. Duplicates are dropped. The decomposed (NFD) spelling
 * of the same name follows, because some file systems store umlauts that way.
 */
export function assetPathCandidates(notePath: string, target: string, syntax: ImageRefSyntax = "markdown"): string[] {
  const candidates: string[] = [];
  const add = (result: AssetPathResult) => {
    if (result.kind !== "workspace") return;
    for (const path of [result.path, result.path.normalize("NFD")]) if (!candidates.includes(path)) candidates.push(path);
  };
  const first = resolveAssetPath(notePath, target);
  add(first);
  if (syntax === "wiki" && first.kind === "workspace" && !isAbsoluteNotePath(notePath)) {
    const trimmed = target.trim();
    add(resolveAssetPath(notePath, trimmed.startsWith("/") ? trimmed : `/${trimmed}`));
  }
  return candidates;
}

/** Why a path could not be shown, for the hint that replaces the broken image icon. */
export function describeAssetRejection(reason: AssetPathRejection): string {
  switch (reason) {
    case "empty":
      return "empty path";
    case "escapes-workspace":
      return "path leaves the workspace";
    case "unsupported-scheme":
      return "unsupported address type";
    case "absolute-path":
      return "absolute paths are not allowed";
    case "control-characters":
      return "path contains control characters";
  }
}
