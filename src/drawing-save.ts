import { ensureWikiLink, inkFileName } from "./ink-embeds";
import { findHeading, parseHeadingTree, updateHeadingContent } from "./markdown-document";

/** The vault operations behind saving one drawing of a node; implemented by the Obsidian view. */
export interface DrawingStore {
  /** Replaces the drawing while it still equals `expected`; throws when it changed or vanished. */
  replace: (path: string, svg: string, expected: string | null) => Promise<void>;
  /** Writes a new drawing under a free name derived from `fileName`; resolves to its vault path. */
  create: (fileName: string, svg: string) => Promise<string>;
  /** Adds the drawing's note links (and the embed of a new file) to the node; false when that failed. */
  link: (svg: string, createdPath: string | null) => Promise<boolean>;
  notify: (message: string) => void;
}

export interface DrawingSaveRequest {
  path: string | null;
  svg: string;
  expectedSvg: string | null;
  /** The drawing whose save failed; the new file is its conflict copy. */
  conflictOf?: string;
  noteBasename: string;
}

/** `Physik/Arbeit ink.svg` → `Arbeit ink (conflict).svg`; the attachment API appends a counter when taken. */
export function conflictFileName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/i, "");
  return `${name} (conflict).svg`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function linkSafely(store: DrawingStore, svg: string, createdPath: string | null): Promise<boolean> {
  try {
    return await store.link(svg, createdPath);
  } catch (error) {
    console.error("BloomMD could not link the drawing into its node", error);
    return false;
  }
}

/**
 * Saves a drawing and reports its path once the SVG is written, even when linking it into the node
 * fails afterwards (e.g. the node was deleted meanwhile): a later save must target the same file, or
 * every autosave would leave another orphaned copy, and an existing file would keep a stale baseline.
 *
 * A failed replace stays silent and resolves to null: the editor then keeps the other version and
 * saves its strokes as a conflict copy, which reports once what happened.
 */
export async function saveDrawing(store: DrawingStore, request: DrawingSaveRequest): Promise<string | null> {
  const { path, svg, expectedSvg, conflictOf } = request;
  if (path) {
    try {
      await store.replace(path, svg, expectedSvg);
    } catch (error) {
      console.warn(`BloomMD did not overwrite ${path}`, error);
      return null;
    }
    if (!(await linkSafely(store, svg, null))) store.notify("The drawing was saved, but its note links could not be added to the node.");
    return path;
  }
  let created: string;
  try {
    created = await store.create(conflictOf ? conflictFileName(conflictOf) : inkFileName(request.noteBasename), svg);
  } catch (error) {
    store.notify(errorMessage(error));
    return null;
  }
  const linked = await linkSafely(store, svg, created);
  if (conflictOf) {
    store.notify(`${conflictOf} changed outside BloomMD or was moved. Your drawing was kept as ${created}${linked ? " and added to the node" : ", but it could not be added to the node"}.`);
  } else if (!linked) {
    store.notify(`The drawing was saved as ${created}, but it could not be added to the node.`);
  }
  return created;
}

/**
 * Applies `prepare` to a node's content and adds `[[target]]` for every note the drawing links to.
 * Never throws: `found` is false when the node no longer exists, and the Markdown stays unchanged.
 */
export function linkDrawingIntoNode(markdown: string, nodeId: string, targets: string[], prepare: (content: string) => string): { markdown: string; found: boolean } {
  const node = findHeading(parseHeadingTree(markdown), nodeId);
  if (!node) return { markdown, found: false };
  const content = targets.reduce(ensureWikiLink, prepare(node.content));
  return { markdown: content === node.content ? markdown : updateHeadingContent(markdown, nodeId, content), found: true };
}
