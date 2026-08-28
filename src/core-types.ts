/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/core/src/types.ts.
 * Source SHA-256: b388139887ca53b5b39d78c302f51ae2098b67e1ecc694dde2b1fb8593789e08
 */
export interface MindMapFrontmatter {
  title: string;
  id: string;
  created: string;
  updated: string;
  tags?: string[];
  layout?: {
    direction?: "LR" | "TB";
    collapsed?: string[];
  };
}

export type MindMapNodeKind =
  | "topic"
  | "workspace"
  | "folder"
  | "portal"
  | "web"
  | "file"
  | "pdf"
  | "source"
  | "task"
  | "decision";

export interface MindMapNodeMetadata {
  kind: MindMapNodeKind;
  url?: string;
  previewTitle?: string;
  previewDescription?: string;
  previewImage?: string;
  file?: string;
  targetNodeId?: string;
  citation?: string;
  status?: "open" | "in_progress" | "done";
  decision?: "proposed" | "accepted" | "rejected";
}

export interface MindMapNode {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  content: string;
  children: string[];
  collapsed?: boolean;
  metadata?: MindMapNodeMetadata;
}

export interface MindMapDocument {
  filePath: string;
  frontmatter: MindMapFrontmatter;
  nodes: Map<string, MindMapNode>;
  rootId: string;
  /**
   * Derived cross-node references. These are not Markdown hierarchy and are never serialized into
   * a source file.
   */
  references?: MindMapReference[];
  /**
   * Metadata for documents derived from more than one Markdown file, such as the workspace map.
   * Derived documents are views over source files; writing them as one Markdown file would corrupt
   * the user's workspace model.
   */
  derived?: {
    kind: "workspace";
    writable: false;
    source?: string;
  };
  /** Markdown blocks before the first heading. */
  preamble?: string;
  /**
   * Server-side storage metadata. It is never serialized into Markdown.
   *
   * The mode was called `"neon"` while BloomMD was tied to that provider. It is derived at runtime
   * from the stored row and never read back from the database, so naming it after what it actually
   * means cost nothing and stops the code from advertising a vendor that is no longer used.
   */
  storage?: {
    mode: "database";
    documentId: string;
    workspaceId: string;
    version: number;
    permission?: "read" | "write";
  };
  rawMarkdown: string;
}

export interface MindMapReference {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "reference";
  raw?: string;
  sourceFile?: string;
  sourceFileId?: string;
  targetFile?: string;
  targetFileId?: string;
  targetAnchor?: string;
  line?: number;
}

export interface MindMapListEntry {
  filename: string;
  frontmatter: MindMapFrontmatter;
}

export interface FileStoreConfig {
  baseDir: string;
  backupsEnabled?: boolean;
}

/**
 * Markdown only defines six heading levels. A deeper node would serialize to `####### Title`,
 * which CommonMark reads back as paragraph text, so the node and its subtree would be lost on the
 * next save/reload cycle. Every structural operation must refuse to exceed this depth.
 */
export const MAX_HEADING_LEVEL = 6;

export class HeadingDepthError extends Error {
  constructor() {
    super("Markdown supports at most six heading levels.");
    this.name = "HeadingDepthError";
  }
}
