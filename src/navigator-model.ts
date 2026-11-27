/**
 * Pure model of the vault navigator: a snapshot of the folder tree, the rows the tree shows, the
 * Markdown files of a folder and the viewport maths for the virtualised lists. Nothing here touches
 * Obsidian, so it can be tested without a vault.
 */

/** Path of the vault root folder, as Obsidian reports it. */
export const ROOT_PATH = "/";

export interface FileNode {
  /** Vault-relative path; unique, unlike the name. */
  path: string;
  /** File name with extension. */
  name: string;
}

export interface FolderNode {
  path: string;
  name: string;
  folders: FolderNode[];
  files: FileNode[];
}

/** The structural part of Obsidian's TFolder/TFile the snapshot is built from. */
export interface SourceEntry {
  path: string;
  name: string;
  extension?: string;
  children?: SourceEntry[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Snapshot of a folder: sub-folders and Markdown files only, each sorted by name. Dot folders are skipped. */
export function buildFolderNode(source: SourceEntry, name = source.name): FolderNode {
  const folders: FolderNode[] = [];
  const files: FileNode[] = [];
  for (const child of source.children ?? []) {
    if (child.children) {
      if (!child.name.startsWith(".")) folders.push(buildFolderNode(child));
    } else if (child.extension === "md") {
      files.push({ path: child.path, name: child.name });
    }
  }
  return { path: source.path || ROOT_PATH, name: name || ROOT_PATH, folders: folders.sort(byName), files: files.sort(byName) };
}

/** Folder that contains a vault path: "a/b/c.md" → "a/b", "c.md" → "/". */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? ROOT_PATH : path.slice(0, slash);
}

/** Folders from the vault root down to (and including) the folder that holds `path`: for the file "a/b/c.md" → ["/", "a", "a/b"]. */
export function ancestorFolders(path: string): string[] {
  const chain = [ROOT_PATH];
  const parts = path.split("/").filter(Boolean).slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    chain.push(current);
  }
  return chain;
}

export function findFolder(root: FolderNode, path: string): FolderNode | null {
  if (path === root.path) return root;
  let current: FolderNode | undefined = root;
  for (const folderPath of ancestorFolders(`${path}/x`).slice(1)) {
    current = current.folders.find((folder) => folder.path === folderPath);
    if (!current) return null;
  }
  return current;
}

export function findFile(root: FolderNode, path: string): FileNode | null {
  return findFolder(root, parentPath(path))?.files.find((file) => file.path === path) ?? null;
}

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** The rows the tree shows: the root and every folder below an expanded folder, in order. */
export function visibleRows(root: FolderNode, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (folder: FolderNode, depth: number) => {
    const isExpanded = folder.path === root.path || expanded.has(folder.path);
    rows.push({ path: folder.path, name: folder.name, depth, hasChildren: folder.folders.length > 0, expanded: isExpanded && folder.folders.length > 0 });
    if (isExpanded) for (const child of folder.folders) walk(child, depth + 1);
  };
  walk(root, 0);
  return rows;
}

/** Parent folder of a folder path, or null for the root. */
export function parentFolderPath(path: string): string | null {
  return path === ROOT_PATH ? null : parentPath(path);
}

/** Re-roots a path after a rename: a path equal to or below `from` moves below `to`. */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

/**
 * Shortens a long name in the middle so the beginning and the end (including the extension) stay
 * readable: "Quarterly planning for the whole organisation.md" → "Quarterly pla…ation.md".
 */
export function shortenMiddle(text: string, max: number): string {
  if (max < 3 || text.length <= max) return text;
  const keepEnd = Math.ceil((max - 1) / 2);
  const keepStart = max - 1 - keepEnd;
  return `${text.slice(0, keepStart)}…${text.slice(text.length - keepEnd)}`;
}

export interface Viewport {
  /** Index of the first row to render. */
  start: number;
  /** Index after the last row to render. */
  end: number;
}

/** Rows to render for a scroll position: the visible ones plus some overscan on both sides. */
export function visibleWindow(total: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan = 6): Viewport {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(total, last + overscan) };
}

/** The scroll position that brings row `index` fully into view, changing it as little as possible. */
export function scrollToReveal(index: number, scrollTop: number, viewportHeight: number, rowHeight: number): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}
