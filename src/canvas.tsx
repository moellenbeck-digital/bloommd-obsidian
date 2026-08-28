import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import dagre from "dagre";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CornerDownRight,
  ExternalLink,
  FileText,
  Film,
  Focus,
  FolderOpen,
  Globe2,
  Image,
  Keyboard,
  ListTodo,
  Link2,
  LocateFixed,
  Map as MapIcon,
  ListTree,
  Music2,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Presentation,
  Redo2,
  Search,
  Scale,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import type { MarkdownNodeKind, MarkdownNodeMetadata } from "./markdown-document";

export interface CanvasHeading {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  content: string;
  children: string[];
  kind: "heading" | "file" | "folder";
  filePath?: string;
  metadata?: MarkdownNodeMetadata;
}

export interface ResourceEntry {
  path: string;
  title: string;
  extension: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface PersistedCanvasLayout {
  positions: Record<string, NodePosition>;
  collapsed: string[];
  viewport?: Viewport;
  mode?: "map" | "outline" | "presentation";
}

export interface BacklinkEntry {
  path: string;
  title: string;
}

export interface CanvasActions {
  renameNode: (id: string, title: string, expectedTitle: string) => Promise<boolean>;
  updateContent: (id: string, content: string, expectedContent: string) => Promise<boolean>;
  updateMetadata: (id: string, metadata: MarkdownNodeMetadata | undefined, expectedMetadata: MarkdownNodeMetadata | undefined) => Promise<boolean>;
  addChild: (id: string) => Promise<string | null>;
  addSibling: (id: string) => Promise<string | null>;
  deleteBranch: (id: string) => Promise<boolean>;
  reparentBranch: (id: string, parentId: string) => Promise<boolean>;
  copyBranches: (sourceIds: string[], targetParentId: string) => Promise<boolean>;
  undo: (selectedId: string | null) => Promise<string | null>;
  redo: (selectedId: string | null) => Promise<string | null>;
  persistLayout: (layout: PersistedCanvasLayout) => void;
  openMarkdown: () => void;
  openBloomMD: () => void;
  openWikiLink: (target: string) => void;
  openExternalLink: (url: string) => void;
  switchFile: (path: string) => void;
  openFile: (path: string) => void;
}

export interface CanvasProps {
  filePath: string;
  headings: CanvasHeading[];
  rootId: string;
  files: Array<{ path: string; title: string }>;
  resources: ResourceEntry[];
  backlinks: BacklinkEntry[];
  layout: PersistedCanvasLayout;
  canUndo: boolean;
  canRedo: boolean;
  showNodeContent: boolean;
  actions: CanvasActions;
}

export interface CanvasMount {
  render: (props: CanvasProps) => void;
  unmount: () => void;
}

export function claimPendingAction(pending: Set<string>, id: string): boolean {
  if (pending.has(id)) return false;
  pending.add(id);
  return true;
}

/** Focus a rendered map or outline node without moving the Obsidian page scroll position. */
export function focusNodeElement(nodeId: string): boolean {
  if (typeof document === "undefined") return false;
  const element = [...document.querySelectorAll<HTMLElement>("[data-node-id]")]
    .find((candidate) => candidate.dataset.nodeId === nodeId);
  if (!element) return false;
  element.focus({ preventScroll: true });
  return true;
}

/** Retry after a mutation because React Flow may need a render frame before the node exists. */
export function requestNodeFocus(nodeId: string): void {
  if (typeof window === "undefined") return;

  let attempts = 0;
  const tryFocus = () => {
    if (focusNodeElement(nodeId) || attempts >= 4) return;
    attempts += 1;
    window.setTimeout(tryFocus, 50);
  };

  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(tryFocus);
  else window.setTimeout(tryFocus, 0);
}

interface ExternalLink {
  label: string;
  url: string;
  host: string;
}

type ExternalResourceKind = "website" | "image" | "video" | "audio" | "pdf";

export function externalResourceKind(url: string): ExternalResourceKind {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg|avif)(?:$|\?)/.test(pathname)) return "image";
    if (/\.(mp4|webm|mov|m4v)(?:$|\?)/.test(pathname)) return "video";
    if (/\.(mp3|wav|ogg|m4a|flac)(?:$|\?)/.test(pathname)) return "audio";
    if (/\.pdf(?:$|\?)/.test(pathname)) return "pdf";
  } catch {
    // Keep incomplete URLs openable as ordinary external links.
  }
  return "website";
}

function ExternalResourceIcon({ kind }: { kind: ExternalResourceKind }) {
  if (kind === "image") return <Image size={15} />;
  if (kind === "video") return <Film size={15} />;
  if (kind === "audio") return <Music2 size={15} />;
  return kind === "pdf" ? <FileText size={15} /> : <ExternalLink size={15} />;
}

interface WikiLink {
  label: string;
  target: string;
}

interface BloomNodeData extends Record<string, unknown> {
  heading: CanvasHeading;
  collapsed: boolean;
  externalLinkCount: number;
  wikiLinkCount: number;
  showContent: boolean;
  autoEdit: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onAutoEditConsumed: () => void;
  onRename: (id: string, title: string, expectedTitle: string) => Promise<boolean>;
  onToggleCollapse: (id: string) => void;
  onAddChild: (id: string) => void;
  onAddSibling: (id: string) => void;
  onToggleTask: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenInspector: (id: string) => void;
  onOpenFile: (path: string) => void;
}

type BloomFlowNode = Node<BloomNodeData, "bloommd">;

const EMPTY_LAYOUT: PersistedCanvasLayout = { positions: {}, collapsed: [] };
const NODE_WIDTH = 236;
const NODE_HEIGHT = 92;

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function sameCanvasNodeSync(left: BloomFlowNode[], right: BloomFlowNode[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((node, index) => {
    const next = right[index];
    if (!next || node.id !== next.id || node.position.x !== next.position.x || node.position.y !== next.position.y || node.selected !== next.selected) return false;
    const heading = node.data.heading;
    const nextHeading = next.data.heading;
    return heading.id === nextHeading.id
      && heading.parentId === nextHeading.parentId
      && heading.level === nextHeading.level
      && heading.title === nextHeading.title
      && heading.content === nextHeading.content
      && heading.children.join("\u0000") === nextHeading.children.join("\u0000")
      && metadataValue(heading.metadata) === metadataValue(nextHeading.metadata)
      && node.data.collapsed === next.data.collapsed
      && node.data.showContent === next.data.showContent
      && node.data.autoEdit === next.data.autoEdit;
  });
}

function sameCanvasEdgeSync(left: Edge[], right: Edge[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((edge, index) => {
    const next = right[index];
    return Boolean(next) && edge.id === next.id && edge.source === next.source && edge.target === next.target && edge.type === next.type;
  });
}

export function externalLinks(markdown: string): ExternalLink[] {
  const links: ExternalLink[] = [];
  const seen = new Set<string>();
  const add = (url: string, label: string) => {
    const cleaned = url.replace(/[.,;:!?]+$/, "");
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    let host = cleaned;
    try {
      host = new URL(cleaned).host.replace(/^www\./, "");
    } catch {
      // Keep the URL as its own label when parsing fails.
    }
    links.push({ url: cleaned, label: label || host, host });
  };

  for (const match of markdown.matchAll(/\[([^\]]+)]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g)) {
    add(match[2] ?? "", (match[1] ?? "").trim());
  }
  for (const match of markdown.matchAll(/(^|[\s(])(https?:\/\/[^\s<>)\]]+)/g)) {
    add(match[2] ?? "", "");
  }
  return links;
}

export function wikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g)) {
    const target = (match[1] ?? "").trim();
    const label = (match[2] ?? target).trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    links.push({ target, label });
  }
  return links;
}

export function contentPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "Code block")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function visibleHeadingIds(headings: CanvasHeading[], collapsed: Set<string>, rootId: string): Set<string> {
  const byId = new Map(headings.map((heading) => [heading.id, heading]));
  const visible = new Set<string>();
  const walk = (id: string) => {
    const heading = byId.get(id);
    if (!heading || visible.has(id)) return;
    visible.add(id);
    if (!collapsed.has(id)) heading.children.forEach(walk);
  };
  walk(rootId);
  headings.filter((heading) => !heading.parentId).forEach((heading) => walk(heading.id));
  return visible;
}

export function autoLayout(headings: CanvasHeading[], visible: Set<string>): Record<string, NodePosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 48, marginx: 70, marginy: 70 });
  graph.setDefaultEdgeLabel(() => ({}));

  headings.forEach((heading) => {
    if (!visible.has(heading.id)) return;
    graph.setNode(heading.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    if (heading.parentId && visible.has(heading.parentId)) graph.setEdge(heading.parentId, heading.id);
  });
  dagre.layout(graph);

  const positions: Record<string, NodePosition> = {};
  headings.forEach((heading) => {
    if (!visible.has(heading.id)) return;
    const point = graph.node(heading.id);
    positions[heading.id] = { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 };
  });
  return positions;
}

function BloomEdge(props: EdgeProps) {
  const [path] = getBezierPath(props);
  return <BaseEdge path={path} markerEnd={props.markerEnd} style={{ strokeWidth: 2 }} className="bloommd-flow-edge" />;
}

function nodeKindLabel(kind: MarkdownNodeKind): string {
  const labels: Record<MarkdownNodeKind, string> = {
    topic: "Topic",
    portal: "Map portal",
    web: "Website",
    file: "File",
    pdf: "PDF",
    source: "Source",
    task: "Task",
    decision: "Decision",
  };
  return labels[kind];
}

function NodeKindIcon({ kind }: { kind: MarkdownNodeKind }) {
  if (kind === "portal") return <MapIcon size={15} />;
  if (kind === "web" || kind === "source") return <Globe2 size={15} />;
  if (kind === "file") return <FileText size={15} />;
  if (kind === "pdf") return <FileText size={15} />;
  if (kind === "task") return <ListTodo size={15} />;
  if (kind === "decision") return <Scale size={15} />;
  return <FolderOpen size={15} />;
}

function BloomNode({ id, data, selected }: NodeProps<BloomFlowNode>) {
  const heading = data.heading;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(heading.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const editStartTitleRef = useRef(heading.title);
  const skipBlurCommitRef = useRef(false);
  const preview = contentPreview(heading.content);
  const isRoot = heading.parentId === null;
  const editable = heading.kind === "heading";

  useEffect(() => setTitle(heading.title), [heading.title]);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [editing]);

  const startEditing = useCallback(() => {
    if (!editable) return;
    skipBlurCommitRef.current = false;
    editStartTitleRef.current = heading.title;
    setTitle(heading.title);
    setEditing(true);
  }, [editable, heading.title]);

  useEffect(() => {
    if (!data.autoEdit || !editable) return;
    startEditing();
    data.onAutoEditConsumed();
  }, [data.autoEdit, data.onAutoEditConsumed, editable, startEditing]);

  const commitTitle = useCallback(async (restoreFocus = false) => {
    const nextTitle = title.trim();
    if (nextTitle && nextTitle !== heading.title) {
      const saved = await data.onRename(id, nextTitle, heading.title);
      if (!saved) setTitle(heading.title);
    } else {
      setTitle(heading.title);
    }
    setEditing(false);
    if (restoreFocus) requestNodeFocus(id);
  }, [data, heading.title, id, title]);

  const cancelEditing = useCallback(() => {
    skipBlurCommitRef.current = true;
    setTitle(editStartTitleRef.current);
    setEditing(false);
    requestNodeFocus(id);
  }, [id]);

  return (
    <div
      className={`bloommd-flow-node bloommd-level-${Math.min(heading.level, 6)}${selected ? " is-selected" : ""}`}
      data-node-id={id}
      role="treeitem"
      aria-selected={selected}
      aria-level={heading.level}
      tabIndex={selected ? 0 : -1}
      onClick={(event) => {
        data.onSelect(id, event.shiftKey);
        event.currentTarget.focus({ preventScroll: true });
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (editable) startEditing();
        else if (heading.filePath) data.onOpenFile(heading.filePath);
      }}
      onKeyDown={(event) => {
        if (editing || !editable) return;
        if (event.key === "F2" || event.key.toLowerCase() === "r") {
          event.preventDefault();
          startEditing();
        }
      }}
    >
      {!isRoot && <Handle type="target" position={Position.Left} isConnectable={editable} className="bloommd-flow-handle bloommd-flow-handle--target" />}
      <div className="bloommd-node-heading">
        <span className="bloommd-node-level-dot" aria-label={editable ? `Heading level ${heading.level}` : heading.kind}>
          {editable ? `H${heading.level}` : heading.kind === "folder" ? "DIR" : "MD"}
        </span>
        {heading.metadata && heading.metadata.kind !== "topic" && (
          heading.metadata.kind === "task" ? (
            <button
              type="button"
              className="bloommd-node-kind nodrag"
              title={heading.metadata.status === "done" ? "Mark task open" : "Mark task done"}
              aria-label={heading.metadata.status === "done" ? "Mark task open" : "Mark task done"}
              onClick={(event) => { event.stopPropagation(); data.onToggleTask(id); }}
            >
              {heading.metadata.status === "done" ? <Check size={15} /> : <ListTodo size={15} />}
            </button>
          ) : (
            <span className="bloommd-node-kind" title={nodeKindLabel(heading.metadata.kind)} aria-label={nodeKindLabel(heading.metadata.kind)}>
              <NodeKindIcon kind={heading.metadata.kind} />
            </span>
          )
        )}
        {editing ? (
          <input
            ref={inputRef}
            className="bloommd-inline-title nodrag"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              void commitTitle();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                skipBlurCommitRef.current = true;
                void commitTitle(true);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
          />
        ) : (
          <span className="bloommd-node-label">{heading.title}</span>
        )}
      </div>

      {data.showContent && preview && <div className="bloommd-node-preview">{preview}</div>}

      <div className="bloommd-node-meta">
        {heading.children.length > 0 && (
          <button
            type="button"
            className="bloommd-node-meta-button nodrag"
            title={data.collapsed ? "Expand branch" : "Collapse branch"}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleCollapse(id);
            }}
          >
            {data.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            {heading.children.length}
          </button>
        )}
        {(data.externalLinkCount > 0 || data.wikiLinkCount > 0) && (
          <button
            type="button"
            className="bloommd-node-meta-button nodrag"
            title="Open links in the inspector"
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenInspector(id);
            }}
          >
            <Link2 size={13} />
            {data.externalLinkCount + data.wikiLinkCount}
          </button>
        )}
      </div>

      {selected && !editing && editable && (
        <div className="bloommd-node-actions nodrag">
          <button type="button" title="Add child" onClick={(event) => { event.stopPropagation(); data.onAddChild(id); }}><Plus size={15} /></button>
          {!isRoot && <button type="button" title="Add sibling" onClick={(event) => { event.stopPropagation(); data.onAddSibling(id); }}><CornerDownRight size={15} /></button>}
          <button type="button" title="Open content editor" onClick={(event) => { event.stopPropagation(); data.onOpenInspector(id); }}><FileText size={15} /></button>
          {!isRoot && <button type="button" className="is-danger" title="Delete branch" onClick={(event) => { event.stopPropagation(); data.onDelete(id); }}><Trash2 size={15} /></button>}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="bloommd-flow-handle bloommd-flow-handle--source"
        title="Drag to a node to make it a child"
        isConnectable={editable}
      />
    </div>
  );
}

const nodeTypes = { bloommd: BloomNode };
const edgeTypes = { bloommd: BloomEdge };

function SaveState({ state }: { state: "saved" | "saving" | "conflict" }) {
  if (state === "saving") return <span className="bloommd-save-state">Saving...</span>;
  if (state === "conflict") return <span className="bloommd-save-state is-conflict"><AlertTriangle size={14} /> Conflict</span>;
  return <span className="bloommd-save-state"><Check size={14} /> Saved locally</span>;
}

function metadataValue(metadata: MarkdownNodeMetadata | undefined): string {
  return JSON.stringify(metadata ?? null);
}

function Inspector({
  heading,
  files,
  resources,
  backlinks,
  onClose,
  onRename,
  onSave,
  onSaveMetadata,
  onOpenWiki,
  onOpenExternal,
  onOpenFile,
}: {
  heading: CanvasHeading;
  files: Array<{ path: string; title: string }>;
  resources: ResourceEntry[];
  backlinks: BacklinkEntry[];
  onClose: () => void;
  onRename: (title: string, expected: string) => Promise<boolean>;
  onSave: (content: string, expected: string) => Promise<boolean>;
  onSaveMetadata: (metadata: MarkdownNodeMetadata | undefined, expected: MarkdownNodeMetadata | undefined) => Promise<boolean>;
  onOpenWiki: (target: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const [title, setTitle] = useState(heading.title);
  const [titleBaseline, setTitleBaseline] = useState(heading.title);
  const [titleSaveState, setTitleSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const [content, setContent] = useState(heading.content);
  const [baseline, setBaseline] = useState(heading.content);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const [metadataDraft, setMetadataDraft] = useState<MarkdownNodeMetadata | undefined>(heading.metadata);
  const [metadataBaseline, setMetadataBaseline] = useState<MarkdownNodeMetadata | undefined>(heading.metadata);
  const [metadataSaveState, setMetadataSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const timer = useRef<number | null>(null);
  const external = useMemo(() => externalLinks(content), [content]);
  const wiki = useMemo(() => wikiLinks(content), [content]);
  const resourceOptions = useMemo(() => {
    const kind = metadataDraft?.kind;
    return resources.filter((resource) => {
      if (kind === "portal") return resource.extension === "md";
      if (kind === "pdf") return resource.extension === "pdf";
      return kind === "file" ? resource.extension !== "md" : false;
    });
  }, [metadataDraft?.kind, resources]);

  useEffect(() => {
    setTitle(heading.title);
    setTitleBaseline(heading.title);
    setTitleSaveState("saved");
    setContent(heading.content);
    setBaseline(heading.content);
    setSaveState("saved");
    setMetadataDraft(heading.metadata);
    setMetadataBaseline(heading.metadata);
    setMetadataSaveState("saved");
  }, [heading.id]);

  useEffect(() => {
    if (titleSaveState !== "saved" || heading.title === titleBaseline) return;
    setTitle(heading.title);
    setTitleBaseline(heading.title);
  }, [heading.title, titleBaseline, titleSaveState]);

  useEffect(() => {
    if (saveState !== "saved" || heading.content === baseline) return;
    setContent(heading.content);
    setBaseline(heading.content);
  }, [baseline, heading.content, saveState]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const save = useCallback(async (nextContent: string) => {
    if (nextContent === baseline) return;
    setSaveState("saving");
    const saved = await onSave(nextContent, baseline);
    if (saved) {
      setBaseline(nextContent);
      setSaveState("saved");
    } else {
      setSaveState("conflict");
    }
  }, [baseline, onSave]);

  const saveTitle = useCallback(async (nextTitle: string) => {
    const normalizedTitle = nextTitle.trim();
    if (!normalizedTitle) {
      setTitle(heading.title);
      setTitleSaveState("saved");
      return;
    }
    if (normalizedTitle === titleBaseline) {
      setTitleSaveState("saved");
      return;
    }
    setTitleSaveState("saving");
    const saved = await onRename(normalizedTitle, titleBaseline);
    if (saved) {
      setTitle(normalizedTitle);
      setTitleBaseline(normalizedTitle);
      setTitleSaveState("saved");
    } else {
      setTitleSaveState("conflict");
    }
  }, [heading.title, onRename, titleBaseline]);

  const saveMetadata = useCallback(async (nextMetadata: MarkdownNodeMetadata | undefined) => {
    if (metadataValue(nextMetadata) === metadataValue(metadataBaseline)) return;
    setMetadataDraft(nextMetadata);
    setMetadataSaveState("saving");
    const saved = await onSaveMetadata(nextMetadata, metadataBaseline);
    if (saved) {
      setMetadataBaseline(nextMetadata);
      setMetadataSaveState("saved");
    } else {
      setMetadataSaveState("conflict");
    }
  }, [metadataBaseline, onSaveMetadata]);

  const changeKind = useCallback((kind: MarkdownNodeKind) => {
    const next: MarkdownNodeMetadata | undefined = kind === "topic"
      ? undefined
      : { ...(metadataDraft?.kind === "topic" ? {} : metadataDraft), kind };
    void saveMetadata(next);
  }, [metadataDraft, saveMetadata]);

  const commitTextMetadata = useCallback((field: "url" | "previewTitle" | "previewDescription" | "previewImage" | "file" | "targetNodeId" | "citation", value: string) => {
    if (!metadataDraft) return;
    const next = { ...metadataDraft, [field]: value.trim() || undefined };
    void saveMetadata(next);
  }, [metadataDraft, saveMetadata]);

  const commitEnumMetadata = useCallback((field: "status" | "decision", value: string) => {
    if (!metadataDraft) return;
    const next = { ...metadataDraft, [field]: value };
    void saveMetadata(next);
  }, [metadataDraft, saveMetadata]);

  const websiteUrl = metadataDraft?.url;
  const portalFile = metadataDraft?.file;
  const resourceFile = metadataDraft?.file;

  const mediaLinks = external.filter((link) => {
    const kind = externalResourceKind(link.url);
    return kind === "image" || kind === "video" || kind === "audio";
  });

  return (
    <aside className="bloommd-inspector">
      <header>
        <div>
          <span className="bloommd-inspector-level">H{heading.level}</span>
          <h3>{heading.title}</h3>
        </div>
        <button type="button" className="bloommd-icon-control" title="Close inspector" onClick={onClose}><PanelRightClose size={17} /></button>
      </header>

      <div className="bloommd-inspector-status"><SaveState state={saveState} /></div>
      <section className="bloommd-inspector-section bloommd-node-title-editor">
        <div className="bloommd-editor-row">
          <label className="bloommd-editor-label" htmlFor="bloommd-node-title">Node title</label>
          <SaveState state={titleSaveState} />
        </div>
        <input
          id="bloommd-node-title"
          type="text"
          value={title}
          autoFocus={heading.title === "New node"}
          onFocus={(event) => {
            if (heading.title === "New node") event.currentTarget.select();
          }}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleSaveState("saving");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setTitle(titleBaseline);
              setTitleSaveState("saved");
              event.currentTarget.blur();
            }
          }}
          onBlur={() => void saveTitle(title)}
          placeholder="Name this node"
        />
      </section>
      <section className="bloommd-inspector-section bloommd-node-metadata-editor">
        <label className="bloommd-editor-label" htmlFor="bloommd-node-type">Node type</label>
        <select
          id="bloommd-node-type"
          value={metadataDraft?.kind ?? "topic"}
          onChange={(event) => changeKind(event.target.value as MarkdownNodeKind)}
        >
          <option value="topic">Topic</option>
          <option value="portal">Map portal</option>
          <option value="web">Website</option>
          <option value="file">File</option>
          <option value="pdf">PDF</option>
          <option value="source">Source</option>
          <option value="task">Task</option>
          <option value="decision">Decision</option>
        </select>
        <div className="bloommd-inspector-status"><SaveState state={metadataSaveState} /></div>
      </section>

      {metadataDraft?.kind === "web" || metadataDraft?.kind === "source" ? (
        <section className="bloommd-inspector-section">
          <h4>{metadataDraft.kind === "source" ? "Source details" : "Website preview"}</h4>
          <label className="bloommd-editor-label" htmlFor="bloommd-node-url">URL</label>
          <input id="bloommd-node-url" type="url" defaultValue={metadataDraft.url ?? ""} placeholder="https://example.com" onBlur={(event) => commitTextMetadata("url", event.target.value)} />
          <p className="bloommd-inspector-note">Preview fields are stored in the note. BloomMD does not fetch websites automatically inside Obsidian.</p>
          <label className="bloommd-editor-label" htmlFor="bloommd-preview-title">Preview title</label>
          <input id="bloommd-preview-title" defaultValue={metadataDraft.previewTitle ?? ""} placeholder={heading.title} onBlur={(event) => commitTextMetadata("previewTitle", event.target.value)} />
          <label className="bloommd-editor-label" htmlFor="bloommd-preview-description">Preview description</label>
          <textarea id="bloommd-preview-description" defaultValue={metadataDraft.previewDescription ?? ""} placeholder="Short description shown in presentation mode" onBlur={(event) => commitTextMetadata("previewDescription", event.target.value)} />
          <label className="bloommd-editor-label" htmlFor="bloommd-preview-image">Preview image URL</label>
          <input id="bloommd-preview-image" type="url" defaultValue={metadataDraft.previewImage ?? ""} placeholder="https://example.com/preview.png" onBlur={(event) => commitTextMetadata("previewImage", event.target.value)} />
          {websiteUrl && <button type="button" className="bloommd-secondary-button" onClick={() => onOpenExternal(websiteUrl)}><Globe2 size={15} />Open website</button>}
          {metadataDraft.kind === "source" && (
            <>
              <label className="bloommd-editor-label" htmlFor="bloommd-citation">Citation</label>
              <input id="bloommd-citation" defaultValue={metadataDraft.citation ?? ""} placeholder="Author, title, year" onBlur={(event) => commitTextMetadata("citation", event.target.value)} />
            </>
          )}
        </section>
      ) : null}

      {metadataDraft?.kind === "portal" && (
        <section className="bloommd-inspector-section">
          <h4>Map portal</h4>
          <label className="bloommd-editor-label" htmlFor="bloommd-portal-file">Markdown map</label>
          <select id="bloommd-portal-file" value={metadataDraft.file ?? ""} onChange={(event) => commitTextMetadata("file", event.target.value)}>
            <option value="">Select a note</option>
            {files.map((file) => <option key={file.path} value={file.path}>{file.title}</option>)}
          </select>
          <label className="bloommd-editor-label" htmlFor="bloommd-portal-node">Target node ID (optional)</label>
          <input id="bloommd-portal-node" defaultValue={metadataDraft.targetNodeId ?? ""} placeholder="Open the map root" onBlur={(event) => commitTextMetadata("targetNodeId", event.target.value)} />
          {portalFile && <button type="button" className="bloommd-secondary-button" onClick={() => onOpenFile(portalFile)}><MapIcon size={15} />Open map</button>}
        </section>
      )}

      {(metadataDraft?.kind === "file" || metadataDraft?.kind === "pdf") && (
        <section className="bloommd-inspector-section">
          <h4>{metadataDraft.kind === "pdf" ? "PDF resource" : "File resource"}</h4>
          <label className="bloommd-editor-label" htmlFor="bloommd-resource-file">Vault file</label>
          <select id="bloommd-resource-file" value={metadataDraft.file ?? ""} onChange={(event) => commitTextMetadata("file", event.target.value)}>
            <option value="">Select a vault file</option>
            {resourceOptions.map((resource) => <option key={resource.path} value={resource.path}>{resource.path}</option>)}
          </select>
          {resourceFile && <button type="button" className="bloommd-secondary-button" onClick={() => onOpenFile(resourceFile)}><FileText size={15} />Open file</button>}
        </section>
      )}

      {metadataDraft?.kind === "task" && (
        <section className="bloommd-inspector-section">
          <h4>Task status</h4>
          <select value={metadataDraft.status ?? "open"} onChange={(event) => commitEnumMetadata("status", event.target.value)}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </section>
      )}

      {metadataDraft?.kind === "decision" && (
        <section className="bloommd-inspector-section">
          <h4>Decision state</h4>
          <select value={metadataDraft.decision ?? "proposed"} onChange={(event) => commitEnumMetadata("decision", event.target.value)}>
            <option value="proposed">Proposed</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </section>
      )}

      <label className="bloommd-editor-label" htmlFor="bloommd-node-content">Markdown content</label>
      <textarea
        id="bloommd-node-content"
        value={content}
        onChange={(event) => {
          const next = event.target.value;
          setContent(next);
          setSaveState("saving");
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void save(next), 550);
        }}
        onBlur={() => {
          if (timer.current !== null) window.clearTimeout(timer.current);
          void save(content);
        }}
      />

      {(external.length > 0 || wiki.length > 0) && (
        <section className="bloommd-inspector-section">
          <h4>Links</h4>
          <div className="bloommd-resource-list">
            {wiki.map((link) => (
              <button key={link.target} type="button" onClick={() => onOpenWiki(link.target)}>
                <FileText size={15} /><span>{link.label}</span>
              </button>
            ))}
            {external.map((link) => (
              <button key={link.url} type="button" onClick={() => onOpenExternal(link.url)}>
                <ExternalResourceIcon kind={externalResourceKind(link.url)} /><span><strong>{link.label}</strong><small>{link.host}</small></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {mediaLinks.length > 0 && (
        <section className="bloommd-inspector-section">
          <h4>Media previews</h4>
          <div className="bloommd-resource-preview-list">
            {mediaLinks.map((link) => <ExternalMediaPreview key={link.url} link={link} />)}
          </div>
        </section>
      )}

      {backlinks.length > 0 && (
        <section className="bloommd-inspector-section">
          <h4>Linked mentions</h4>
          <div className="bloommd-resource-list">
            {backlinks.map((backlink) => (
              <button key={backlink.path} type="button" onClick={() => onOpenWiki(backlink.path)}>
                <Link2 size={15} /><span>{backlink.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

function ExternalMediaPreview({ link }: { link: ExternalLink }) {
  const [open, setOpen] = useState(false);
  const kind = externalResourceKind(link.url);
  return (
    <details className="bloommd-resource-preview" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><ExternalResourceIcon kind={kind} /><span>{link.label}</span><small>{link.host}</small></summary>
      {kind === "image" && <img src={link.url} alt={link.label} loading="lazy" referrerPolicy="no-referrer" />}
      {kind === "video" && <video src={link.url} controls preload="metadata" />}
      {kind === "audio" && <audio src={link.url} controls preload="metadata" />}
    </details>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="bloommd-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="bloommd-shortcut-help" role="dialog" aria-modal="true" aria-labelledby="bloommd-shortcut-help-title">
        <header>
          <div>
            <span className="bloommd-inspector-level">KEYBOARD</span>
            <h2 id="bloommd-shortcut-help-title">BloomMD shortcuts</h2>
          </div>
          <button type="button" className="bloommd-icon-control" title="Close shortcut help" onClick={onClose}>×</button>
        </header>
        <div className="bloommd-shortcut-list">
          <div><kbd>Tab</kbd><span>Add a child node</span></div>
          <div><kbd>Enter</kbd><span>Add a sibling node</span></div>
          <div><kbd>R / F2</kbd><span>Rename the focused node</span></div>
          <div><kbd>Delete / Backspace</kbd><span>Delete the selected branch and focus its parent</span></div>
          <div><kbd>Arrow keys</kbd><span>Move between parent, children and siblings</span></div>
          <div><kbd>Cmd/Ctrl + C</kbd><span>Copy selected branches</span></div>
          <div><kbd>Cmd/Ctrl + V</kbd><span>Paste branches below the selected node</span></div>
          <div><kbd>Cmd/Ctrl + Z</kbd><span>Undo the last Markdown change</span></div>
          <div><kbd>Cmd/Ctrl + Shift + Z</kbd><span>Redo the last Markdown change</span></div>
          <div><kbd>Return / Escape</kbd><span>Finish or cancel rename and keep node focus</span></div>
          <div><kbd>Alt + 1 / 2 / 3</kbd><span>Switch map, outline and presentation</span></div>
          <div><kbd>?</kbd><span>Open this help</span></div>
        </div>
        <p className="bloommd-shortcut-note">The vault remains local. Layout and view state are stored by the plugin, while Markdown stays the source of truth.</p>
        <button type="button" className="bloommd-primary-button" onClick={onClose}>Done</button>
      </section>
    </div>
  );
}

export function orderedHeadingIds(headings: CanvasHeading[], rootId: string): string[] {
  const byId = new Map(headings.map((heading) => [heading.id, heading]));
  const result: string[] = [];
  const walk = (id: string) => {
    const heading = byId.get(id);
    if (!heading || result.includes(id)) return;
    result.push(id);
    heading.children.forEach(walk);
  };
  if (rootId) walk(rootId);
  headings.filter((heading) => !heading.parentId).forEach((heading) => walk(heading.id));
  return result;
}

function OutlineMode({
  headings,
  rootId,
  selectedId,
  onSelect,
  onOpenInspector,
}: {
  headings: CanvasHeading[];
  rootId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenInspector: (id: string) => void;
}) {
  const byId = new Map(headings.map((heading) => [heading.id, heading]));
  const rows: Array<{ heading: CanvasHeading; depth: number }> = [];
  const walk = (id: string, depth: number) => {
    const heading = byId.get(id);
    if (!heading || rows.some((row) => row.heading.id === id)) return;
    rows.push({ heading, depth });
    heading.children.forEach((child) => walk(child, depth + 1));
  };
  if (rootId) walk(rootId, 0);
  headings.filter((heading) => !heading.parentId).forEach((heading) => walk(heading.id, 0));

  return (
    <section className="bloommd-outline-mode" aria-label="Markdown outline">
      <div className="bloommd-mode-heading"><ListTree size={18} /><div><strong>Outline</strong><span>Scan the note structure and open any section.</span></div></div>
      <div className="bloommd-outline-list">
        {rows.map(({ heading, depth }) => (
          <button
            key={heading.id}
            type="button"
            data-node-id={heading.id}
            aria-selected={selectedId === heading.id}
            className={selectedId === heading.id ? "is-selected" : ""}
            style={{ paddingLeft: `${16 + depth * 26}px` }}
            onClick={(event) => {
              onSelect(heading.id);
              onOpenInspector(heading.id);
              event.currentTarget.focus();
            }}
          >
            <span className="bloommd-outline-level">H{heading.level}</span>
            <span className="bloommd-outline-title">{heading.title}</span>
            {heading.children.length > 0 && <span className="bloommd-outline-count">{heading.children.length}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function PresentationMode({
  heading,
  index,
  total,
  onPrevious,
  onNext,
  onOpenInspector,
  onOpenExternal,
  onOpenFile,
}: {
  heading: CanvasHeading | null;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onOpenInspector: () => void;
  onOpenExternal: (url: string) => void;
  onOpenFile: (path: string) => void;
}) {
  if (!heading) return <div className="bloommd-empty-state"><Presentation size={32} /><h3>No section selected</h3><p>Select a heading in the map or outline first.</p></div>;
  const links = externalLinks(heading.content);
  const metadata = heading.metadata;
  const webResource = metadata && (metadata.kind === "web" || metadata.kind === "source") && metadata.url ? metadata : null;
  const fileResource = metadata && (metadata.kind === "portal" || metadata.kind === "file" || metadata.kind === "pdf") && metadata.file ? metadata : null;
  const webResourceUrl = webResource?.url;
  const fileResourcePath = fileResource?.file;
  return (
    <section className="bloommd-presentation-mode" aria-label="Presentation mode">
      <div className="bloommd-presentation-content">
        <span className="bloommd-presentation-kicker">H{heading.level} · {index + 1}/{total}</span>
        <h1>{heading.title}</h1>
        {metadata && metadata.kind !== "topic" && (
          <div className="bloommd-presentation-type"><NodeKindIcon kind={metadata.kind} /> {nodeKindLabel(metadata.kind)}</div>
        )}
        {webResource && webResourceUrl && (
          <article className="bloommd-presentation-resource-card">
            {webResource.previewImage && <img src={webResource.previewImage} alt={webResource.previewTitle || heading.title} loading="lazy" referrerPolicy="no-referrer" />}
            <div><strong>{webResource.previewTitle || heading.title}</strong><small>{webResource.previewDescription || webResourceUrl}</small></div>
            <button type="button" className="bloommd-secondary-button" onClick={() => onOpenExternal(webResourceUrl)}><ExternalLink size={15} />Open resource</button>
          </article>
        )}
        {fileResource && fileResourcePath && (
          <button type="button" className="bloommd-presentation-resource-card" onClick={() => onOpenFile(fileResourcePath)}>
            <NodeKindIcon kind={fileResource.kind} /><span><strong>{fileResourcePath}</strong><small>Open from this vault</small></span><ExternalLink size={15} />
          </button>
        )}
        {metadata?.kind === "task" && <div className="bloommd-presentation-status">Task: {metadata.status ?? "open"}</div>}
        {metadata?.kind === "decision" && <div className="bloommd-presentation-status">Decision: {metadata.decision ?? "proposed"}</div>}
        {heading.content && <p>{heading.content}</p>}
        {links.length > 0 && (
          <div className="bloommd-presentation-resources">
            {links.map((link) => (
              <button key={link.url} type="button" onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}>
                {externalResourceKind(link.url) === "image" ? <Image size={16} /> : externalResourceKind(link.url) === "video" ? <Film size={16} /> : <ExternalLink size={16} />}
                <span><strong>{link.label}</strong><small>{link.host}</small></span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="bloommd-secondary-button" onClick={onOpenInspector}><FileText size={16} />Edit section</button>
      </div>
      <footer className="bloommd-presentation-footer">
        <button type="button" className="bloommd-icon-control" disabled={index === 0} title="Previous section" onClick={onPrevious}>←</button>
        <div className="bloommd-presentation-progress"><span style={{ width: `${((index + 1) / Math.max(total, 1)) * 100}%` }} /></div>
        <button type="button" className="bloommd-icon-control" disabled={index >= total - 1} title="Next section" onClick={onNext}>→</button>
      </footer>
    </section>
  );
}

function CanvasInner(props: CanvasProps) {
  const reactFlow = useReactFlow<BloomFlowNode>();
  const shellRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(props.rootId || null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(props.rootId ? [props.rootId] : []));
  const selectedIdsRef = useRef<Set<string>>(new Set(props.rootId ? [props.rootId] : []));
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const [copiedBranchIds, setCopiedBranchIds] = useState<string[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mode, setMode] = useState<"map" | "outline" | "presentation">(props.layout.mode ?? "map");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set(props.layout.collapsed));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const pendingChildAdds = useRef(new Set<string>());
  const pendingSiblingAdds = useRef(new Set<string>());
  const latestLayout = useRef<PersistedCanvasLayout>(props.layout ?? EMPTY_LAYOUT);
  const runtimePositions = useRef<Record<string, NodePosition>>(props.layout.positions ?? {});

  const headingsById = useMemo(() => new Map(props.headings.map((heading) => [heading.id, heading])), [props.headings]);
  const selectedHeading = selectedId ? headingsById.get(selectedId) ?? null : null;
  const visibleIds = useMemo(() => visibleHeadingIds(props.headings, collapsed, props.rootId), [collapsed, props.headings, props.rootId]);
  const presentationIds = useMemo(() => orderedHeadingIds(props.headings, props.rootId), [props.headings, props.rootId]);
  const presentationIndex = Math.max(0, presentationIds.indexOf(selectedId ?? ""));

  const selectNode = useCallback((id: string, additive = false) => {
    const next = additive ? new Set(selectedIdsRef.current) : new Set<string>();
    if (additive && next.has(id)) next.delete(id);
    else next.add(id);
    selectedIdsRef.current = next;
    setSelectedIds(next);
    setSelectedId(next.has(id) ? id : [...next][0] ?? null);
  }, []);

  const run = useCallback(async (action: () => Promise<boolean>) => {
    setSaveState("saving");
    const saved = await action();
    setSaveState(saved ? "saved" : "conflict");
    return saved;
  }, []);

  const persist = useCallback((patch: Partial<PersistedCanvasLayout>) => {
    const next: PersistedCanvasLayout = {
      positions: patch.positions ?? latestLayout.current.positions ?? {},
      collapsed: patch.collapsed ?? latestLayout.current.collapsed ?? [],
      ...(patch.viewport || latestLayout.current.viewport ? { viewport: patch.viewport ?? latestLayout.current.viewport } : {}),
      ...(patch.mode || latestLayout.current.mode ? { mode: patch.mode ?? latestLayout.current.mode } : {}),
    };
    latestLayout.current = next;
    props.actions.persistLayout(next);
  }, [props.actions]);

  const changeMode = useCallback((next: "map" | "outline" | "presentation") => {
    setMode(next);
    persist({ mode: next });
  }, [persist]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist({ collapsed: [...next] });
      return next;
    });
  }, [persist]);

  const addChild = useCallback((id: string) => {
    if (!claimPendingAction(pendingChildAdds.current, id)) return;
    void run(async () => {
      try {
        const newId = await props.actions.addChild(id);
        if (newId) {
          selectNode(newId);
          setInspectorOpen(false);
          setAutoEditId(newId);
        }
        return Boolean(newId);
      } finally {
        pendingChildAdds.current.delete(id);
      }
    });
  }, [props.actions, run, selectNode]);

  const addSibling = useCallback((id: string) => {
    if (!claimPendingAction(pendingSiblingAdds.current, id)) return;
    void run(async () => {
      try {
        const newId = await props.actions.addSibling(id);
        if (newId) {
          selectNode(newId);
          setInspectorOpen(false);
          setAutoEditId(newId);
        }
        return Boolean(newId);
      } finally {
        pendingSiblingAdds.current.delete(id);
      }
    });
  }, [props.actions, run, selectNode]);

  const deleteNode = useCallback((id: string) => {
    const parentId = headingsById.get(id)?.parentId;
    if (!parentId) return;
    void run(async () => {
      const saved = await props.actions.deleteBranch(id);
      if (saved) {
        selectNode(parentId);
        setInspectorOpen(false);
        requestNodeFocus(parentId);
      }
      return saved;
    });
  }, [headingsById, props.actions, run, selectNode]);

  const flowModel = useMemo(() => {
    const automatic = autoLayout(props.headings, visibleIds);
    const nodes: BloomFlowNode[] = props.headings
      .filter((heading) => visibleIds.has(heading.id))
      .map((heading) => ({
        id: heading.id,
        type: "bloommd",
        position: runtimePositions.current[heading.id] ?? props.layout.positions[heading.id] ?? automatic[heading.id] ?? { x: 0, y: 0 },
        data: {
          heading,
          collapsed: collapsed.has(heading.id),
          externalLinkCount: externalLinks(heading.content).length,
          wikiLinkCount: wikiLinks(heading.content).length,
          showContent: props.showNodeContent,
          autoEdit: autoEditId === heading.id,
          onSelect: selectNode,
          onAutoEditConsumed: () => setAutoEditId(null),
          onRename: (id, title, expected) => run(() => props.actions.renameNode(id, title, expected)),
          onToggleCollapse: toggleCollapse,
          onAddChild: addChild,
          onAddSibling: addSibling,
          onToggleTask: (id) => {
            const heading = headingsById.get(id);
            if (heading?.metadata?.kind !== "task") return;
            const metadata: MarkdownNodeMetadata = {
              ...heading.metadata,
              status: heading.metadata.status === "done" ? "open" : "done",
            };
            void run(() => props.actions.updateMetadata(id, metadata, heading.metadata));
          },
          onDelete: (id) => deleteNode(id),
          onOpenInspector: (id) => {
            selectNode(id);
            setInspectorOpen(true);
          },
          onOpenFile: props.actions.openFile,
        },
      }));
    const edges: Edge[] = props.headings
      .filter((heading) => heading.parentId && visibleIds.has(heading.id) && visibleIds.has(heading.parentId))
      .flatMap((heading) => {
        const parentId = heading.parentId;
        return parentId
          ? [{ id: `${parentId}-${heading.id}`, source: parentId, target: heading.id, type: "bloommd" }]
          : [];
      });
    return { nodes, edges };
  }, [addChild, addSibling, autoEditId, collapsed, deleteNode, headingsById, props.actions, props.headings, props.layout.positions, props.showNodeContent, run, selectNode, toggleCollapse, visibleIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<BloomFlowNode>(flowModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowModel.edges);

  useEffect(() => {
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]));
      const selected = new Map(current.map((node) => [node.id, node.selected]));
      const next = flowModel.nodes.map((node) => ({
        ...node,
        selected: selected.get(node.id) ?? false,
        position: positions.get(node.id) ?? node.position,
      }));
      return sameCanvasNodeSync(current, next) ? current : next;
    });
    setEdges((current) => sameCanvasEdgeSync(current, flowModel.edges) ? current : flowModel.edges);
  }, [flowModel, setEdges, setNodes]);

  useEffect(() => {
    if (selectedId && !headingsById.has(selectedId)) {
      setSelectedId(props.rootId || null);
      const next = new Set(props.rootId ? [props.rootId] : []);
      selectedIdsRef.current = next;
      setSelectedIds(next);
      setInspectorOpen(false);
    }
  }, [headingsById, props.rootId, selectedId]);

  useEffect(() => {
    runtimePositions.current = { ...(props.layout.positions ?? {}) };
    latestLayout.current = props.layout ?? EMPTY_LAYOUT;
    setCollapsed(new Set(props.layout.collapsed ?? []));
    setSelectedId(props.rootId || null);
    const next = new Set(props.rootId ? [props.rootId] : []);
    selectedIdsRef.current = next;
    setSelectedIds(next);
    setCopiedBranchIds([]);
    setInspectorOpen(false);
    setAutoEditId(null);
    setHelpOpen(false);
    setMode(props.layout.mode ?? "map");
    setSearch("");
    window.setTimeout(() => {
      reactFlow.setNodes((current) => current.map((node) => {
        const selected = node.id === props.rootId;
        return node.selected === selected ? node : { ...node, selected };
      }));
      if (props.layout.viewport) void reactFlow.setViewport(props.layout.viewport, { duration: 0 });
      else void reactFlow.fitView({ padding: 0.25, duration: 180 });
    }, 20);
  }, [props.filePath]);

  const focusNode = useCallback((id: string) => {
    const node = reactFlow.getNode(id);
    selectNode(id);
    requestNodeFocus(id);
    if (mode === "map" && node) {
      void reactFlow.fitView({ nodes: [node], padding: 1.3, duration: 240, maxZoom: 1.15 });
    }
  }, [mode, reactFlow, selectNode]);

  const openInspector = useCallback((id: string) => {
    selectNode(id);
    setInspectorOpen(true);
  }, [selectNode]);

  const navigateSelection = useCallback((direction: "parent" | "child" | "next" | "previous") => {
    if (!selectedId) return;
    const current = headingsById.get(selectedId);
    if (!current) return;
    let nextId: string | undefined;
    if (direction === "parent") nextId = current.parentId ?? undefined;
    if (direction === "child") nextId = current.children[0];
    if (direction === "next" || direction === "previous") {
      const siblings = current.parentId ? headingsById.get(current.parentId)?.children ?? [] : props.headings.filter((heading) => !heading.parentId).map((heading) => heading.id);
      const index = siblings.indexOf(current.id);
      const nextIndex = direction === "next" ? index + 1 : index - 1;
      nextId = siblings[nextIndex];
    }
    if (!nextId) return;
    focusNode(nextId);
  }, [focusNode, headingsById, props.headings, selectedId]);

  const movePresentation = useCallback((delta: number) => {
    const nextId = presentationIds[presentationIndex + delta];
    if (nextId) selectNode(nextId);
  }, [presentationIds, presentationIndex, selectNode]);

  const copySelection = useCallback(() => {
    const copyable = [...selectedIds].filter((id) => headingsById.get(id)?.kind === "heading");
    if (copyable.length > 0) setCopiedBranchIds(copyable);
  }, [headingsById, selectedIds]);

  const pasteSelection = useCallback(() => {
    if (!selectedId || copiedBranchIds.length === 0 || headingsById.get(selectedId)?.kind !== "heading") return;
    void run(() => props.actions.copyBranches(copiedBranchIds, selectedId));
  }, [copiedBranchIds, headingsById, props.actions, run, selectedId]);

  const applyHistory = useCallback((direction: "undo" | "redo") => {
    void run(async () => {
      const focusId = await props.actions[direction](selectedId);
      if (focusId) {
        selectNode(focusId);
        requestNodeFocus(focusId);
      }
      return Boolean(focusId);
    });
  }, [props.actions, run, selectNode, selectedId]);

  const handleKeyboard = useCallback((event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !shellRef.current?.contains(target)) return;
    const inTextField = Boolean(target.closest("input, textarea, [contenteditable='true']"));
    const primary = event.metaKey || event.ctrlKey;

    if (!inTextField && (event.key === "?" || event.key === "F1")) {
      event.preventDefault();
      setHelpOpen((current) => !current);
      return;
    }
    if (!inTextField && event.altKey && ["1", "2", "3"].includes(event.key)) {
      event.preventDefault();
      changeMode(event.key === "1" ? "map" : event.key === "2" ? "outline" : "presentation");
      return;
    }
    if (helpOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setHelpOpen(false);
      }
      return;
    }
    if (inTextField) return;

    if (primary && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection();
      return;
    }
    if (primary && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteSelection();
      return;
    }
    if (primary && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      applyHistory("undo");
      return;
    }
    if ((primary && event.key.toLowerCase() === "z" && event.shiftKey) || (primary && event.key.toLowerCase() === "y")) {
      event.preventDefault();
      applyHistory("redo");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (inspectorOpen) setInspectorOpen(false);
      else if (search) setSearch("");
      else selectNode(props.rootId);
      return;
    }
    if (!selectedId || !selectedHeading || selectedHeading.kind !== "heading") return;
    const currentId = selectedId;
    if (event.key === "F2" || event.key.toLowerCase() === "r") {
      event.preventDefault();
      setAutoEditId(currentId);
      return;
    }
    if (event.key === "ArrowRight") { event.preventDefault(); navigateSelection("child"); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); navigateSelection("parent"); return; }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (mode === "presentation") movePresentation(1);
      else navigateSelection("next");
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (mode === "presentation") movePresentation(-1);
      else navigateSelection("previous");
      return;
    }
    if (mode !== "presentation" && event.key === "Tab" && !event.repeat) {
      event.preventDefault();
      addChild(currentId);
      return;
    }
    if (mode !== "presentation" && event.key === "Enter" && !primary && !event.altKey) {
      event.preventDefault();
      if (!event.repeat && selectedHeading.parentId) addSibling(currentId);
      return;
    }
    if (mode !== "presentation" && (event.key === "Delete" || event.key === "Backspace") && currentId !== props.rootId) {
      event.preventDefault();
      if (!event.repeat) deleteNode(currentId);
    }
  }, [addChild, addSibling, applyHistory, changeMode, copySelection, deleteNode, helpOpen, inspectorOpen, mode, movePresentation, navigateSelection, pasteSelection, props.rootId, run, search, selectedHeading, selectedId, selectNode]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard, true);
    return () => window.removeEventListener("keydown", handleKeyboard, true);
  }, [handleKeyboard]);

  const performAutoLayout = useCallback(() => {
    const automatic = autoLayout(props.headings, visibleIds);
    runtimePositions.current = { ...runtimePositions.current, ...automatic };
    setNodes((current) => current.map((node) => ({ ...node, position: automatic[node.id] ?? node.position })));
    persist({ positions: runtimePositions.current });
    window.setTimeout(() => void reactFlow.fitView({ padding: 0.25, duration: 260 }), 30);
  }, [persist, props.headings, reactFlow, setNodes, visibleIds]);

  const searchMatches = search.trim()
    ? props.headings.filter((heading) => heading.title.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div
      ref={shellRef}
      className="bloommd-react-shell"
    >
      <div className="bloommd-app-toolbar">
        <div className="bloommd-toolbar-group" aria-label="File navigation">
          <button type="button" className="bloommd-icon-control" title="Back to Markdown" aria-label="Back to Markdown" onClick={props.actions.openMarkdown}><ArrowLeft size={17} /></button>
          <div className="bloommd-file-picker">
            <FileText size={15} />
            <select value={props.filePath} onChange={(event) => props.actions.switchFile(event.target.value)} aria-label="Switch Markdown note">
              {props.files.map((file) => <option key={file.path} value={file.path}>{file.title}</option>)}
            </select>
          </div>
          <div className="bloommd-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && searchMatches[0]) {
                  event.preventDefault();
                  focusNode(searchMatches[0].id);
                  setSearch("");
                }
              }}
              placeholder="Find node"
              aria-label="Find node"
            />
            {searchMatches.length > 0 && (
              <div className="bloommd-search-results">
                {searchMatches.map((heading) => <button key={heading.id} type="button" onClick={() => { focusNode(heading.id); setSearch(""); }}>{heading.title}</button>)}
              </div>
            )}
          </div>
        </div>
        <div className="bloommd-toolbar-group bloommd-mode-group" aria-label="View mode">
          <button type="button" className={`bloommd-mode-button${mode === "map" ? " is-active" : ""}`} aria-pressed={mode === "map"} title="Map mode (Alt+1)" onClick={() => changeMode("map")}><Network size={15} /><span>Map</span></button>
          <button type="button" className={`bloommd-mode-button${mode === "outline" ? " is-active" : ""}`} aria-pressed={mode === "outline"} title="Outline mode (Alt+2)" onClick={() => changeMode("outline")}><ListTree size={15} /><span>Outline</span></button>
          <button type="button" className={`bloommd-mode-button${mode === "presentation" ? " is-active" : ""}`} aria-pressed={mode === "presentation"} title="Presentation mode (Alt+3)" onClick={() => changeMode("presentation")}><Presentation size={15} /><span>Present</span></button>
        </div>
        <span className="bloommd-toolbar-spacer" />
        <div className="bloommd-toolbar-group" aria-label="Editing tools">
          <SaveState state={saveState} />
          <button type="button" className="bloommd-icon-control" title="Copy selected branches (Cmd/Ctrl+C)" aria-label="Copy selected branches" disabled={selectedIds.size === 0} onClick={copySelection}><Copy size={17} /></button>
          <button type="button" className="bloommd-icon-control" title="Paste branches as children (Cmd/Ctrl+V)" aria-label="Paste branches as children" disabled={!selectedId || copiedBranchIds.length === 0} onClick={pasteSelection}><ClipboardPaste size={17} /></button>
          <button type="button" className="bloommd-icon-control" title="Undo (Cmd/Ctrl+Z)" aria-label="Undo" disabled={!props.canUndo} onClick={() => applyHistory("undo")}><Undo2 size={17} /></button>
          <button type="button" className="bloommd-icon-control" title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo" disabled={!props.canRedo} onClick={() => applyHistory("redo")}><Redo2 size={17} /></button>
        </div>
        <div className="bloommd-toolbar-group" aria-label="Canvas tools">
          {mode === "map" && <button type="button" className="bloommd-icon-control" title="Auto layout" aria-label="Auto layout" onClick={performAutoLayout}><Sparkles size={17} /></button>}
          {mode === "map" && <button type="button" className="bloommd-icon-control" title="Fit view" aria-label="Fit view" onClick={() => void reactFlow.fitView({ padding: 0.25, duration: 240 })}><LocateFixed size={17} /></button>}
          {selectedId && <button type="button" className="bloommd-icon-control" title="Focus selected node" aria-label="Focus selected node" onClick={() => focusNode(selectedId)}><Focus size={17} /></button>}
          <button type="button" className="bloommd-icon-control" title="Shortcut help (F1 or ?)" aria-label="Shortcut help" onClick={() => setHelpOpen(true)}><Keyboard size={17} /></button>
          <button type="button" className="bloommd-text-control" title="Open the selected note in BloomMD" onClick={props.actions.openBloomMD}><ExternalLink size={15} /><span>Open app</span></button>
        </div>
      </div>

      <div className="bloommd-workspace">
        <main className="bloommd-flow-wrap">
          {mode === "map" ? (
          <ReactFlow<BloomFlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onPaneClick={() => {
              setSelectedId((current) => current === null ? current : null);
              const next = new Set<string>();
              selectedIdsRef.current = next;
              setSelectedIds((current) => current.size === 0 ? current : next);
            }}
            onSelectionChange={({ nodes: selectedNodes }) => {
              const ids = new Set(selectedNodes.map((node) => node.id));
              if (!sameStringSet(selectedIdsRef.current, ids)) {
                selectedIdsRef.current = ids;
                setSelectedIds(ids);
              }
              setSelectedId((current) => {
                if (ids.size === 0) return current === null ? current : null;
                if (current && ids.has(current)) return current;
                return [...ids][0] ?? null;
              });
            }}
            onNodeDragStop={(_, node) => {
              runtimePositions.current = { ...runtimePositions.current, [node.id]: node.position };
              persist({ positions: runtimePositions.current });
            }}
            onConnect={(connection: Connection) => {
              if (!connection.source || !connection.target || connection.source === connection.target) return;
              void run(() => props.actions.reparentBranch(connection.target, connection.source));
            }}
            isValidConnection={(connection) => Boolean(connection.source && connection.target && connection.source !== connection.target && connection.target !== props.rootId)}
            defaultViewport={props.layout.viewport ?? { x: 30, y: 30, zoom: 0.9 }}
            minZoom={0.15}
            maxZoom={2.2}
            panOnScroll={false}
            zoomOnScroll
            zoomOnPinch
            panOnDrag
            nodesDraggable
            nodesConnectable
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode="Shift"
            onMoveEnd={(_, viewport) => persist({ viewport })}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls position="bottom-right" showInteractive={false} />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeColor={(node) => node.id === props.rootId ? "#ff6b35" : "#6f6f73"}
              maskColor="rgba(20, 20, 22, 0.7)"
            />
          </ReactFlow>
          ) : mode === "outline" ? (
            <OutlineMode headings={props.headings} rootId={props.rootId} selectedId={selectedId} onSelect={selectNode} onOpenInspector={openInspector} />
          ) : (
            <PresentationMode
              heading={selectedHeading?.kind === "heading" ? selectedHeading : null}
              index={presentationIndex}
              total={presentationIds.length}
              onPrevious={() => movePresentation(-1)}
              onNext={() => movePresentation(1)}
              onOpenInspector={() => { if (selectedId) openInspector(selectedId); }}
              onOpenExternal={props.actions.openExternalLink}
              onOpenFile={props.actions.openFile}
            />
          )}
          {!inspectorOpen && mode === "map" && selectedHeading?.kind === "heading" && (
            <button type="button" className="bloommd-open-inspector" onClick={() => setInspectorOpen(true)} title="Open content editor">
              <PanelRightOpen size={16} />
              Edit content
            </button>
          )}
        </main>

        {inspectorOpen && selectedHeading?.kind === "heading" && (
          <Inspector
            key={selectedHeading.id}
            heading={selectedHeading}
            files={props.files}
            resources={props.resources}
            backlinks={props.backlinks}
            onClose={() => setInspectorOpen(false)}
            onRename={(title, expected) => run(() => props.actions.renameNode(selectedHeading.id, title, expected))}
            onSave={(content, expected) => run(() => props.actions.updateContent(selectedHeading.id, content, expected))}
            onSaveMetadata={(metadata, expected) => run(() => props.actions.updateMetadata(selectedHeading.id, metadata, expected))}
            onOpenWiki={props.actions.openWikiLink}
            onOpenExternal={props.actions.openExternalLink}
            onOpenFile={props.actions.openFile}
          />
        )}
      </div>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function BloomMDCanvas(props: CanvasProps) {
  if (props.headings.length === 0) {
    return <div className="bloommd-empty-state"><Network size={32} /><h3>No Markdown headings found</h3><p>Add a heading to the note and the mind map will update automatically.</p></div>;
  }
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}

interface CanvasErrorBoundaryProps {
  children: ReactNode;
  onBack: () => void;
}

interface CanvasErrorBoundaryState {
  error: Error | null;
}

class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("BloomMD canvas failed to render", error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="bloommd-render-error" role="alert">
        <AlertTriangle size={32} />
        <h3>BloomMD could not render this map</h3>
        <p>The note is still safe in Markdown. Reload the map or return to the note.</p>
        <code>{this.state.error.message || "Unknown rendering error"}</code>
        <div className="bloommd-render-error-actions">
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" onClick={this.props.onBack}>Back to Markdown</button>
        </div>
      </div>
    );
  }
}

export function createCanvasMount(container: HTMLElement): CanvasMount {
  const root: Root = createRoot(container);
  return {
    render: (props) => root.render(
      <CanvasErrorBoundary onBack={props.actions.openMarkdown}>
        <BloomMDCanvas {...props} />
      </CanvasErrorBoundary>,
    ),
    unmount: () => root.unmount(),
  };
}
