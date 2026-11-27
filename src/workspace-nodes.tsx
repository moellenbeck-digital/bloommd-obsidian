/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ui/src/workspace/workspace-nodes.tsx by the BloomMD mirror sync.
 * Source SHA-256: e16b79bd6cace359015ad4657af71970f267a927d22e4a89e3f0969447a5c75c
 */
import { ChevronRight, FileText, Folder, Heading } from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceNodeKind = "folder" | "file" | "heading";

export interface WorkspaceNodeLabels {
  folder: string;
  file: string;
  heading: string;
  open: string;
  openFile: string;
}

const labels: Record<"de" | "en", WorkspaceNodeLabels> = {
  de: { folder: "Ordner", file: "Markdown-Datei", heading: "Inhaltsvorschau", open: "Öffnen", openFile: "Datei öffnen" },
  en: { folder: "Folder", file: "Markdown file", heading: "Content preview", open: "Open", openFile: "Open file" },
};

export function workspaceNodeLabels(language: string): WorkspaceNodeLabels {
  return language.toLowerCase().startsWith("de") ? labels.de : labels.en;
}

export interface WorkspaceNodeContentProps {
  kind: WorkspaceNodeKind;
  title: string;
  path?: string;
  labels: WorkspaceNodeLabels;
  /** Omit when the host cannot open this source. Navigation and errors belong to the host. */
  onOpen?: () => void;
  opening?: boolean;
  /** Host-owned task control, when an overview heading represents a task. */
  titleAdornment?: ReactNode;
  completed?: boolean;
}

/**
 * Shared presentation only: no store, file access or canvas dependency. The host owns the
 * treeitem, selection and handles. Apply workspace-nodes.css and `bloommd-workspace-node`
 * to that wrapper, with data-workspace-kind, data-selected and data-node-root attributes.
 */
export function WorkspaceNodeContent({ kind, title, path, labels, onOpen, opening = false, titleAdornment, completed = false }: WorkspaceNodeContentProps) {
  return <>
    {kind !== "heading" && <div className="bloommd-workspace-type">
      {kind === "folder" ? <Folder size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
      <span>{labels[kind]}</span>
    </div>}
    <div className="bloommd-workspace-title">
      {kind === "heading" && <>
        <Heading size={14} aria-hidden="true" />
        <span className="bloommd-workspace-sr-only">{labels.heading}: </span>
      </>}
      {titleAdornment}
      <span className="bloommd-workspace-label" data-completed={completed || undefined} title={title}>{title}</span>
    </div>
    {kind === "file" && path && <div className="bloommd-workspace-source">
      <span className="bloommd-workspace-path" title={path}>{path}</span>
      {onOpen && <button
        type="button"
        className="bloommd-workspace-open nodrag nopan"
        data-testid="workspace-open-file"
        aria-label={`${labels.openFile}: ${path}`}
        aria-busy={opening || undefined}
        disabled={opening}
        onClick={(event) => { event.stopPropagation(); onOpen(); }}
        onDoubleClick={(event) => event.stopPropagation()}
      >{labels.open}<ChevronRight size={13} aria-hidden="true" /></button>}
    </div>}
  </>;
}
