import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getNodesBounds,
  getStraightPath,
  getViewportForBounds,
  useEdgesState,
  useInternalNode,
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
  Cloud,
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
  CalendarDays,
  UserRound,
  PenLine,
  Link2,
  LocateFixed,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Expand,
  Eye,
  GraduationCap,
  Signature,
  ImageDown,
  RotateCcw,
  Shrink,
  ListTree,
  Music2,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Presentation,
  Redo2,
  Scaling,
  Search,
  Scale,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import type { MarkdownNodeKind, MarkdownNodeMetadata } from "./markdown-document";
import { toPng } from "html-to-image";
import { InkEditor } from "./ink-editor";
import { dataUrlToBytes, exportBounds, exportSize, jpegToPdf } from "./map-export";
import { MapInkLayer } from "./map-ink-layer";
import { inkContentBounds, serializeInkSvg, type InkDocument } from "./ink-document";
import { InkDrawingList, nodeDrawings, useInkSession, type InkVaultActions } from "./ink-panel";
import { floatingEdgeEnds, freePosition, relationEdges, studyCards, studyProgress, withKind, withRelations, type NodeRelation } from "./concept-map";
import { LinkedNoteSection, RelationsSection, hoverNoteHandler, type LinkedNoteHandlers } from "./concept-map-panel";
import { dayKey, isDue, levelOn, studyOrder, summarize, type LearningDisplay, type LearningEntry, type StudyOrder } from "./learning";
import { LearningStatus, RatingButtons, branchProgress, learnColor, type CanvasLearning } from "./learning-panel";

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
  /** Changed by the agent since the map was last opened. */
  agentChanged?: boolean;
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

export interface NodeSize {
  width: number;
  height: number;
}

export interface PersistedCanvasLayout {
  positions: Record<string, NodePosition>;
  /** Sizes the user gave nodes; nodes without an entry size themselves to their content. */
  sizes?: Record<string, NodeSize>;
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
  /** Opens the note in the BloomMD app, at the given node when there is one. */
  openBloomMD: (nodeId?: string | null) => void;
  openWikiLink: (target: string) => void;
  openExternalLink: (url: string) => void;
  switchFile: (path: string) => void;
  openFile: (path: string) => void;
  readInk: (path: string) => Promise<string | null>;
  saveInk: (nodeId: string, path: string | null, svg: string, expectedSvg: string | null, conflictOf?: string) => Promise<string | null>;
  resolveEmbed: (link: string) => string | null;
  resourceUrl: (path: string) => string;
  pickNote: () => Promise<string | null>;
  hoverLink: (event: MouseEvent, target: string, targetEl: HTMLElement) => void;
  /** Links (or with null unlinks) a note to a node and adds `[[note]]` to its content in one edit. */
  linkNote: (id: string, note: string | null, expectedMetadata: MarkdownNodeMetadata | undefined) => Promise<boolean>;
  /** Renders Markdown like Obsidian does (embeds, links, formatting); returns a cleanup. */
  renderMarkdown: (element: HTMLElement, markdown: string) => () => void;
  /** Saves the map's own drawing; creates it (and links it in the frontmatter) when `path` is null. */
  saveMapInk: (path: string | null, svg: string, expectedSvg: string | null, conflictOf?: string) => Promise<string | null>;
  /** Saves an exported map image into the vault; resolves to its path. */
  saveExport: (extension: "png" | "pdf", data: Uint8Array) => Promise<string | null>;
  /** Shows a native Obsidian menu at a screen position. */
  openMenu: (position: { x: number; y: number }, items: CanvasMenuItem[], onHide?: () => void) => void;
  /** Creates a child node of `parentId` titled `title` whose content embeds a new drawing. */
  /** Resolves to the new node's id. */
  createNodeFromInk: (parentId: string, svg: string, title: string) => Promise<string | null>;
  /** Leaves a question or instruction for the agent on this node. */
  askAgent?: (id: string, title: string) => void;
}

export interface CanvasMenuItem {
  title: string;
  /** Lucide icon name as Obsidian's setIcon expects it. */
  icon: string;
  danger?: boolean;
  onClick: () => void;
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
  sharedStatus?: "connected" | "offline" | "conflict" | "revoked" | null;
  /** Vault path of the handwriting drawn on this map, from the note's frontmatter. */
  mapInkPath?: string | null;
  /** False where no BloomMD app can open the note (Obsidian on iPad and iPhone). */
  canOpenApp?: boolean;
  /** Changes when the map drawing file was modified on disk (sync, another device). */
  mapInkRevision?: number;
  /** Personal learning progress of this map; absent for folders or when progress is turned off. */
  learning?: CanvasLearning | null;
  actions: CanvasActions;
}

/** Editing chrome that does not belong on an exported learning sheet. */
const EXPORT_HIDDEN = [".react-flow__edges", ".react-flow__resize-control", ".bloommd-node-actions", ".react-flow__handle", ".bloommd-study-bar", ".bloommd-map-ink", ".bloommd-rate"];

/** Dispatched on the view container by the "Toggle focus mode" command. */
export const FOCUS_MODE_EVENT = "bloommd:toggle-focus-mode";

export interface CanvasMount {
  /** Element React renders into; focus-mode requests are dispatched on it. */
  host: HTMLElement;
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
  drawingUrls: string[];
  sized: boolean;
  onResize: (id: string, box: NodePosition & NodeSize) => void;
  onResetSize: (id: string) => void;
  onOpenMenu: (id: string, position: { x: number; y: number }) => void;
  /** Study mode: the content is covered until revealed. */
  studyHidden: boolean;
  onReveal: (id: string) => void;
  /** Learning progress: rated level (0-based) and how the map shows it. */
  learnLevel: number | null;
  learnStyle: LearningDisplay;
  learnColor?: string;
  learnLabel?: string;
  learnDue: boolean;
  /** Mastered/total cards of this branch, when branch progress is on. */
  branchLabel?: string;
  /** Not part of the current study session (filtered out by the study order). */
  outOfSession: boolean;
  /** Rating buttons, shown on a revealed card in study mode. */
  ratings: { names: string[]; colors: string[] } | null;
  onRate: (id: string, level: number) => void;
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
  noteHandlers: LinkedNoteHandlers;
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

const ratingsKey = (ratings: BloomNodeData["ratings"]) => ratings ? `${ratings.names.join("\u0000")}\u0001${ratings.colors.join("\u0000")}` : "";

function sameCanvasNodeSync(left: BloomFlowNode[], right: BloomFlowNode[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((node, index) => {
    const next = right[index];
    if (!next || node.id !== next.id || node.position.x !== next.position.x || node.position.y !== next.position.y || node.selected !== next.selected) return false;
    if (node.width !== next.width || node.height !== next.height) return false;
    const heading = node.data.heading;
    const nextHeading = next.data.heading;
    return heading.id === nextHeading.id
      && heading.parentId === nextHeading.parentId
      && heading.level === nextHeading.level
      && heading.title === nextHeading.title
      && heading.content === nextHeading.content
      && heading.agentChanged === nextHeading.agentChanged
      && heading.children.join("\u0000") === nextHeading.children.join("\u0000")
      && metadataValue(heading.metadata) === metadataValue(nextHeading.metadata)
      && node.data.collapsed === next.data.collapsed
      && node.data.showContent === next.data.showContent
      && node.data.drawingUrls.join("\u0000") === next.data.drawingUrls.join("\u0000")
      && node.data.sized === next.data.sized
      && node.data.studyHidden === next.data.studyHidden
      && node.data.learnLevel === next.data.learnLevel
      && node.data.learnStyle === next.data.learnStyle
      && node.data.learnColor === next.data.learnColor
      && node.data.learnLabel === next.data.learnLabel
      && node.data.learnDue === next.data.learnDue
      && node.data.branchLabel === next.data.branchLabel
      && node.data.outOfSession === next.data.outOfSession
      && ratingsKey(node.data.ratings) === ratingsKey(next.data.ratings)
      && node.data.autoEdit === next.data.autoEdit;
  });
}

function sameCanvasEdgeSync(left: Edge[], right: Edge[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((edge, index) => {
    const next = right[index];
    return Boolean(next) && edge.id === next.id && edge.source === next.source && edge.target === next.target && edge.type === next.type && edge.label === next.label;
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
  // `![[…]]` embeds (images, drawings) are content, not links. No lookbehind: older iOS WebKit lacks it.
  for (const match of markdown.matchAll(/(!?)\[\[([^\]|]+)(?:\|([^\]]+))?]]/g)) {
    if (match[1]) continue;
    const target = (match[2] ?? "").trim();
    const label = (match[3] ?? target).trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    links.push({ target, label });
  }
  return links;
}

export function contentPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "Code block")
    .replace(/!\[\[[^\]]*]]/g, " ")
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

/** Spacing of the automatic layout: between levels, between siblings, and around the map. */
const RANK_GAP = 110;
const SIBLING_GAP = 48;
const LAYOUT_MARGIN = 70;

/**
 * Left-to-right tree layout for the heading hierarchy. Headings always form a tree (or a forest of
 * top-level headings), so a tidy tree is enough: each level gets a column as wide as its widest
 * node, children stack vertically with a fixed gap, and every parent is centred on its children.
 * Resized nodes keep their size. This replaces dagre, whose general graph layout cost 48 KB of the
 * plugin's bundle for a layout the tree does not need.
 */
export function autoLayout(headings: CanvasHeading[], visible: Set<string>, sizes: Record<string, NodeSize> = {}): Record<string, NodePosition> {
  const byId = new Map(headings.filter((heading) => visible.has(heading.id)).map((heading) => [heading.id, heading]));
  const children = (id: string) => (byId.get(id)?.children ?? []).filter((child) => byId.has(child));
  const size = (id: string): NodeSize => sizes[id] ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
  const roots = [...byId.values()].filter((heading) => !heading.parentId || !byId.has(heading.parentId)).map((heading) => heading.id);

  // Column x per depth: each column is as wide as its widest node.
  const depthOf = new Map<string, number>();
  const columnWidth: number[] = [];
  const assignDepth = (id: string, depth: number) => {
    depthOf.set(id, depth);
    columnWidth[depth] = Math.max(columnWidth[depth] ?? 0, size(id).width);
    children(id).forEach((child) => assignDepth(child, depth + 1));
  };
  roots.forEach((root) => assignDepth(root, 0));
  const columnX: number[] = [];
  for (let depth = 0; depth < columnWidth.length; depth += 1) {
    columnX[depth] = depth === 0 ? LAYOUT_MARGIN : columnX[depth - 1]! + columnWidth[depth - 1]! + RANK_GAP;
  }

  // Vertical extent of each subtree, then top-down placement with parents centred on children.
  const extent = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children(id);
    const stacked = kids.reduce((total, child, index) => total + measure(child) + (index > 0 ? SIBLING_GAP : 0), 0);
    const height = Math.max(size(id).height, stacked);
    extent.set(id, height);
    return height;
  };
  const positions: Record<string, NodePosition> = {};
  const place = (id: string, top: number) => {
    const height = extent.get(id)!;
    const own = size(id);
    const kids = children(id);
    const stacked = kids.reduce((total, child, index) => total + extent.get(child)! + (index > 0 ? SIBLING_GAP : 0), 0);
    let childTop = top + (height - stacked) / 2;
    const centres: number[] = [];
    for (const child of kids) {
      place(child, childTop);
      centres.push(positions[child]!.y + size(child).height / 2);
      childTop += extent.get(child)! + SIBLING_GAP;
    }
    const centre = centres.length > 0 ? (centres[0]! + centres[centres.length - 1]!) / 2 : top + height / 2;
    positions[id] = { x: columnX[depthOf.get(id)!]!, y: centre - own.height / 2 };
  };
  let top = LAYOUT_MARGIN;
  for (const root of roots) {
    const height = measure(root);
    place(root, top);
    top += height + SIBLING_GAP;
  }
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

const LONG_PRESS_MS = 500;

const DECISION_LABELS = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" } as const;

function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Due date, responsible person and decision state, so a map explains who does what by when. */
export function TaskFacts({ metadata, today = localDate() }: { metadata?: CanvasHeading["metadata"]; today?: string }) {
  if (!metadata) return null;
  const decision = metadata.kind === "decision" ? metadata.decision ?? "proposed" : null;
  if (!metadata.due && !metadata.assignee && !decision) return null;
  const overdue = Boolean(metadata.due && metadata.due < today && metadata.status !== "done");
  const dueLabel = metadata.due ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(`${metadata.due}T12:00:00`)) : "";
  return (
    <div className="bloommd-task-facts">
      {decision && <span className={`bloommd-task-fact is-decision is-${decision}`}>{DECISION_LABELS[decision]}</span>}
      {metadata.due && (
        <span className={`bloommd-task-fact${overdue ? " is-overdue" : ""}`} title={overdue ? `Overdue since ${metadata.due}` : `Due ${metadata.due}`}>
          <CalendarDays size={12} aria-hidden="true" />{dueLabel}
        </span>
      )}
      {metadata.assignee && (
        <span className="bloommd-task-fact" title={`Responsible: ${metadata.assignee}`}>
          <UserRound size={12} aria-hidden="true" />{metadata.assignee}
        </span>
      )}
    </div>
  );
}

function BloomNode({ id, data, selected }: NodeProps<BloomFlowNode>) {
  const heading = data.heading;
  const longPress = useRef<{ start: { x: number; y: number }; timer: number } | null>(null);
  const longPressFired = useRef(false);
  const [pressArmed, setPressArmed] = useState(false);
  const cancelLongPress = useCallback(() => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
  }, []);
  useEffect(() => cancelLongPress, [cancelLongPress]);
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
      className={`bloommd-flow-node bloommd-level-${Math.min(heading.level, 6)}${selected ? " is-selected" : ""}${data.sized ? " is-sized" : ""}${pressArmed ? " is-press-armed" : ""}${data.learnLevel !== null && data.learnStyle !== "off" ? ` learn-${data.learnStyle}` : ""}${data.learnDue ? " is-due" : ""}${data.outOfSession ? " is-out-of-session" : ""}${heading.agentChanged ? " is-agent-changed" : ""}`}
      style={learnColor(data.learnColor)}
      data-node-id={id}
      data-learn-level={data.learnLevel ?? undefined}
      role="treeitem"
      aria-selected={selected}
      aria-level={heading.level}
      tabIndex={selected ? 0 : -1}
      onClick={(event) => {
        if (longPressFired.current) {
          // The press that opened the menu must not also toggle the selection.
          longPressFired.current = false;
          return;
        }
        data.onSelect(id, event.shiftKey);
        event.currentTarget.focus({ preventScroll: true });
      }}
      onContextMenu={(event) => {
        // Obsidian's own document handler would otherwise close (or replace) the menu right away.
        event.preventDefault();
        event.stopPropagation();
        data.onOpenMenu(id, { x: event.clientX, y: event.clientY });
      }}
      onTouchEnd={(event) => {
        // After a long press, the browser's synthetic click would count as a click outside the menu.
        if (longPressFired.current) event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        longPressFired.current = false;
        const start = { x: event.clientX, y: event.clientY };
        longPress.current = { start, timer: window.setTimeout(() => {
          // Holding long enough arms the menu; it opens on release. Opened while the finger is
          // still down, Obsidian would close it again on the very touchend that follows.
          longPressFired.current = true;
          setPressArmed(true);
          data.onSelect(id, false);
        }, LONG_PRESS_MS) };
      }}
      onPointerMove={(event) => {
        const pending = longPress.current;
        // Moving means dragging the node, not asking for its menu.
        if (pending && Math.hypot(event.clientX - pending.start.x, event.clientY - pending.start.y) > 8) {
          cancelLongPress();
          longPress.current = null;
          longPressFired.current = false;
          setPressArmed(false);
        }
      }}
      onPointerUp={(event) => {
        const pending = longPress.current;
        cancelLongPress();
        longPress.current = null;
        if (!longPressFired.current || !pending) return;
        setPressArmed(false);
        const at = pending.start;
        // Let the release's touchend and synthetic click pass before the menu listens for taps.
        window.setTimeout(() => {
          longPressFired.current = false;
          data.onOpenMenu(id, at);
        }, 80);
        event.preventDefault();
      }}
      onPointerCancel={() => {
        cancelLongPress();
        setPressArmed(false);
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
      <NodeResizer
        isVisible={selected && editable && !editing}
        minWidth={160}
        minHeight={64}
        handleClassName="bloommd-resize-handle"
        lineClassName="bloommd-resize-line"
        onResizeEnd={(_, box) => data.onResize(id, box)}
      />
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
      <TaskFacts metadata={heading.metadata} />

      {data.studyHidden ? (
        <button
          type="button"
          className="bloommd-study-cover nodrag"
          aria-label={`Reveal ${heading.title}`}
          onClick={(event) => {
            event.stopPropagation();
            data.onReveal(id);
          }}
        >
          <Eye size={14} />
          <span>Tap to reveal</span>
        </button>
      ) : (
        <>
          {data.showContent && preview && <div className="bloommd-node-preview">{preview}</div>}
          {data.showContent && data.drawingUrls[0] && (
            <img className="bloommd-node-drawing" src={data.drawingUrls[0]} alt={`Drawing in ${heading.title}`} draggable={false} />
          )}
          {data.ratings && (
            <RatingButtons title={heading.title} names={data.ratings.names} colors={data.ratings.colors} level={data.learnLevel} onRate={(level) => data.onRate(id, level)} />
          )}
        </>
      )}

      <div className="bloommd-node-meta">
        {data.learnStyle === "badge" && data.learnLabel && (
          <span className="bloommd-learn-badge" style={learnColor(data.learnColor)}>{data.learnLabel}</span>
        )}
        {data.learnDue && <span className="bloommd-learn-due" title="Due for review">Due</span>}
        {data.branchLabel && <span className="bloommd-learn-branch" title="Mastered in this branch"><Check size={12} />{data.branchLabel}</span>}
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
        {heading.metadata?.note && (
          <button
            type="button"
            className="bloommd-node-meta-button bloommd-node-note nodrag"
            title={`Open ${heading.metadata.note}`}
            aria-label={`Open linked note ${heading.metadata.note}`}
            onClick={(event) => {
              event.stopPropagation();
              data.noteHandlers.onOpenNote(heading.metadata!.note!);
            }}
            onPointerEnter={hoverNoteHandler(heading.metadata.note, data.noteHandlers)}
          >
            <FileText size={13} />
            <span>{heading.metadata.note}</span>
          </button>
        )}
        {data.drawingUrls.length > 0 && !data.showContent && (
          <button
            type="button"
            className="bloommd-node-meta-button nodrag"
            title="Open drawings in the inspector"
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenInspector(id);
            }}
          >
            <PenLine size={13} />
            {data.drawingUrls.length}
          </button>
        )}
      </div>

      {selected && !editing && editable && (
        <div className="bloommd-node-actions nodrag">
          <button type="button" title="Add child" onClick={(event) => { event.stopPropagation(); data.onAddChild(id); }}><Plus size={15} /></button>
          {!isRoot && <button type="button" title="Add sibling" onClick={(event) => { event.stopPropagation(); data.onAddSibling(id); }}><CornerDownRight size={15} /></button>}
          <button type="button" title="Open content editor" onClick={(event) => { event.stopPropagation(); data.onOpenInspector(id); }}><FileText size={15} /></button>
          {data.sized && <button type="button" title="Reset size" aria-label="Reset size" onClick={(event) => { event.stopPropagation(); data.onResetSize(id); }}><Scaling size={15} /></button>}
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

/** Concept-map connection: dashed so it never reads as part of the heading structure. */
function RelationEdge(props: EdgeProps) {
  const source = useInternalNode(props.source);
  const target = useInternalNode(props.target);
  if (!source || !target) return null;
  const box = (node: NonNullable<typeof source>) => ({
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? NODE_WIDTH,
    height: node.measured.height ?? NODE_HEIGHT,
  });
  // Concept-map connections run straight between facing borders instead of the heading handles.
  const { sx, sy, tx, ty } = floatingEdgeEnds(box(source), box(target));
  const [path, labelX, labelY] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
  return (
    <>
      <BaseEdge path={path} className="bloommd-relation-edge" />
      {typeof props.label === "string" && props.label && (
        <EdgeLabelRenderer>
          <span className="bloommd-relation-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{props.label}</span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { bloommd: BloomNode };
const edgeTypes = { bloommd: BloomEdge, relation: RelationEdge };

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
  fullscreen,
  onToggleFullscreen,
  onClose,
  onRename,
  onSave,
  onSaveMetadata,
  onOpenWiki,
  onOpenExternal,
  onOpenFile,
  ink,
  candidates,
  onLinkNote,
}: {
  heading: CanvasHeading;
  files: Array<{ path: string; title: string }>;
  resources: ResourceEntry[];
  backlinks: BacklinkEntry[];
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onRename: (title: string, expected: string) => Promise<boolean>;
  onSave: (content: string, expected: string) => Promise<boolean>;
  onSaveMetadata: (metadata: MarkdownNodeMetadata | undefined, expected: MarkdownNodeMetadata | undefined) => Promise<boolean>;
  onOpenWiki: (target: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenFile: (path: string) => void;
  ink: InkVaultActions;
  /** Other nodes of this map, for concept-map connections. */
  candidates: Array<{ id: string; title: string }>;
  onLinkNote: (note: string | null, expected: MarkdownNodeMetadata | undefined) => Promise<boolean>;
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
  const [tab, setTab] = useState<"text" | "handwriting">("text");
  const inkSession = useInkSession(ink);
  const drawings = useMemo(() => nodeDrawings(content, ink.resolveEmbed), [content, ink.resolveEmbed]);
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
    void saveMetadata(withKind(metadataDraft, kind));
  }, [metadataDraft, saveMetadata]);

  // Links and connections are also edited outside this form (note picker, renames): follow the
  // Markdown whenever no local metadata edit is pending.
  useEffect(() => {
    if (metadataSaveState !== "saved" || metadataValue(heading.metadata) === metadataValue(metadataBaseline)) return;
    setMetadataDraft(heading.metadata);
    setMetadataBaseline(heading.metadata);
  }, [heading.metadata, metadataBaseline, metadataSaveState]);

  const linkNote = useCallback(async (note: string | null) => {
    setMetadataSaveState("saving");
    const saved = await onLinkNote(note, metadataBaseline);
    setMetadataSaveState(saved ? "saved" : "conflict");
  }, [metadataBaseline, onLinkNote]);

  const pickLinkedNote = useCallback(async () => {
    const note = await ink.pickNote();
    if (note) await linkNote(note);
  }, [ink, linkNote]);

  const changeRelations = useCallback((relations: NodeRelation[]) => {
    void saveMetadata(withRelations(metadataDraft, relations));
  }, [metadataDraft, saveMetadata]);

  const commitTextMetadata = useCallback((field: "url" | "previewTitle" | "previewDescription" | "previewImage" | "file" | "targetNodeId" | "citation", value: string) => {
    if (!metadataDraft) return;
    const next = { ...metadataDraft, [field]: value.trim() || undefined };
    void saveMetadata(next);
  }, [metadataDraft, saveMetadata]);

  const commitTaskFact = useCallback((field: "due" | "assignee", value: string) => {
    if (!metadataDraft) return;
    const trimmed = value.trim();
    if (field === "due" && trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return;
    const next = { ...metadataDraft, [field]: trimmed || undefined };
    if ((next[field] ?? undefined) === (metadataDraft[field] ?? undefined)) return;
    void saveMetadata(next);
  }, [metadataDraft, saveMetadata]);

  const commitEnumMetadata = useCallback((field: "status" | "decision", value: string) => {
    if (!metadataDraft) return;
    const next = { ...metadataDraft, [field]: value };
    void saveMetadata(next);
  }, [metadataDraft, saveMetadata]);

  /** Pending text edits are saved first so the drawing embed is appended to the latest content. */
  const flushText = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    void save(content);
  }, [content, save]);

  const asideRef = useRef<HTMLElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // A new node is named right away (#192). preact/compat, the release renderer, does not apply
  // `autoFocus` itself; the inspector remounts per node, so focusing on mount matches React's.
  useLayoutEffect(() => {
    if (heading.title === "New node") titleInputRef.current?.focus();
  }, []);
  const showHandwriting = useCallback((action: () => Promise<void>) => {
    flushText();
    setTab("handwriting");
    // A 330 px side panel is too narrow to write in; drawing starts in full screen there.
    if (!fullscreen && (asideRef.current?.clientWidth ?? 0) < 520) onToggleFullscreen();
    void action();
  }, [flushText, fullscreen, onToggleFullscreen]);

  const finishHandwriting = useCallback(() => {
    // A drawing that could not be saved stays open with its strokes; the notice explains why.
    void inkSession.close().then((closed) => { if (closed) setTab("text"); });
  }, [inkSession]);

  const websiteUrl = metadataDraft?.url;
  const portalFile = metadataDraft?.file;
  const resourceFile = metadataDraft?.file;

  const mediaLinks = external.filter((link) => {
    const kind = externalResourceKind(link.url);
    return kind === "image" || kind === "video" || kind === "audio";
  });

  return (
    <aside ref={asideRef} className={`bloommd-inspector${fullscreen ? " is-fullscreen" : ""}${tab === "handwriting" && inkSession.session ? " is-drawing" : ""}`} aria-label="Node inspector">
      <header>
        <div>
          <span className="bloommd-inspector-level">H{heading.level}</span>
          <h3>{heading.title}</h3>
        </div>
        <div className="bloommd-inspector-actions">
          <button
            type="button"
            className="bloommd-icon-control"
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            aria-pressed={fullscreen}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button type="button" className="bloommd-icon-control" title="Close inspector" aria-label="Close inspector" onClick={onClose}><PanelRightClose size={17} /></button>
        </div>
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
          ref={titleInputRef}
          value={title}
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

      <LinkedNoteSection
        note={metadataDraft?.note}
        handlers={{ onOpenNote: ink.onOpenLink, onHoverNote: ink.onHoverLink }}
        onLink={() => void pickLinkedNote()}
        onUnlink={() => void linkNote(null)}
      />
      <RelationsSection relations={metadataDraft?.relations ?? []} candidates={candidates} onChange={changeRelations} />

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
          <label className="bloommd-editor-label" htmlFor="bloommd-task-due">Due</label>
          <input id="bloommd-task-due" type="date" key={`due-${metadataDraft.due ?? ""}`} defaultValue={metadataDraft.due ?? ""} onBlur={(event) => commitTaskFact("due", event.target.value)} onChange={(event) => { if (!event.target.value || /^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) commitTaskFact("due", event.target.value); }} />
          <label className="bloommd-editor-label" htmlFor="bloommd-task-assignee">Responsible</label>
          <input id="bloommd-task-assignee" key={`assignee-${metadataDraft.assignee ?? ""}`} defaultValue={metadataDraft.assignee ?? ""} placeholder="Name" maxLength={120} onBlur={(event) => commitTaskFact("assignee", event.target.value)} />
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
          <label className="bloommd-editor-label" htmlFor="bloommd-decision-assignee">Decided by</label>
          <input id="bloommd-decision-assignee" key={`decider-${metadataDraft.assignee ?? ""}`} defaultValue={metadataDraft.assignee ?? ""} placeholder="Name" maxLength={120} onBlur={(event) => commitTaskFact("assignee", event.target.value)} />
        </section>
      )}

      <div className="bloommd-content-tabs" role="tablist" aria-label="Node content">
        <button type="button" role="tab" aria-selected={tab === "text"} className={tab === "text" ? "is-active" : ""} onClick={() => { if (inkSession.session) finishHandwriting(); else setTab("text"); }}>
          <FileText size={15} /><span>Text</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "handwriting"} className={tab === "handwriting" ? "is-active" : ""} onClick={() => { flushText(); setTab("handwriting"); }}>
          <PenLine size={15} /><span>Handwriting</span>
          {drawings.length > 0 && <span className="bloommd-content-tab-count">{drawings.length}</span>}
        </button>
        {tab === "handwriting" && inkSession.session && <SaveState state={inkSession.saveState} />}
      </div>

      {tab === "text" ? (
        <>
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
          {drawings.length > 0 && (
            <section className="bloommd-inspector-section">
              <h4>Drawings</h4>
              <InkDrawingList drawings={drawings} actions={ink} revision={inkSession.revision} onEdit={(path) => showHandwriting(() => inkSession.open(path))} />
            </section>
          )}
        </>
      ) : inkSession.session ? (
        <>
          {inkSession.saveState === "conflict" ? (
            <p className="bloommd-ink-notice" role="alert">This drawing could not be saved. Your strokes are kept here; press Done to try again.</p>
          ) : inkSession.conflictCopy && (
            <p className="bloommd-ink-notice" role="status">The drawing changed outside BloomMD. Your version continues in {inkSession.conflictCopy}.</p>
          )}
          <InkEditor
            key={inkSession.session.key}
            document={inkSession.session.document}
            readOnly={inkSession.session.readOnly}
            onChange={inkSession.change}
            onDone={finishHandwriting}
            onPickNote={ink.pickNote}
            onCreateNode={(extracted, title) => ink.createNodeFromInk(serializeInkSvg(extracted), title)}
            onHoverLink={ink.onHoverLink}
            onOpenLink={ink.onOpenLink}
          />
        </>
      ) : (
        <section className="bloommd-inspector-section bloommd-ink-overview">
          {inkSession.error && <p className="bloommd-ink-notice" role="alert">{inkSession.error}</p>}
          <InkDrawingList
            drawings={drawings}
            actions={ink}
            revision={inkSession.revision}
            onEdit={(path) => showHandwriting(() => inkSession.open(path))}
            onCreate={() => showHandwriting(inkSession.create)}
          />
          <p className="bloommd-inspector-note">Drawings are saved as SVG files in your attachment folder and embedded into this node.</p>
        </section>
      )}

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

/**
 * What the map drawing session does for the note on screen: open the note's linked drawing, close
 * a drawing that belongs to another note, or keep the session (also a just-created drawing whose
 * frontmatter link Obsidian has not indexed yet).
 */
export function mapInkStep(
  filePath: string,
  mapInkPath: string | null,
  session: { path: string | null; note: string | null } | null,
): "open" | "close" | null {
  if (mapInkPath) return session?.path === mapInkPath ? null : "open";
  return session && session.note !== filePath ? "close" : null;
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

function MarkdownBlock({ markdown, render, className }: { markdown: string; render: CanvasActions["renderMarkdown"]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return render(element, markdown);
  }, [markdown, render]);
  return <div ref={ref} className={className} />;
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
  renderMarkdown,
}: {
  heading: CanvasHeading | null;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onOpenInspector: () => void;
  onOpenExternal: (url: string) => void;
  onOpenFile: (path: string) => void;
  renderMarkdown: CanvasActions["renderMarkdown"];
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
        {heading.content && <MarkdownBlock className="bloommd-presentation-markdown markdown-rendered" markdown={heading.content} render={renderMarkdown} />}
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

const NO_ENTRIES: Record<string, LearningEntry> = {};
const noRate = () => undefined;

function CanvasInner(props: CanvasProps) {
  const reactFlow = useReactFlow<BloomFlowNode>();
  const shellRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(props.rootId || null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(props.rootId ? [props.rootId] : []));
  const selectedIdsRef = useRef<Set<string>>(new Set(props.rootId ? [props.rootId] : []));
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const [copiedBranchIds, setCopiedBranchIds] = useState<string[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorFullscreen, setInspectorFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [study, setStudy] = useState(false);
  const [drawOnMap, setDrawOnMap] = useState(false);
  const [flowHost, setFlowHost] = useState<HTMLElement | null>(null);
  const [mapNotice, setMapNotice] = useState<{ message: string; undo?: () => void } | null>(null);
  const mapNoticeTimer = useRef<number | undefined>(undefined);
  const mapInkActions = useMemo(() => ({ readInk: props.actions.readInk, saveInk: props.actions.saveMapInk }), [props.actions.readInk, props.actions.saveMapInk]);
  const mapInk = useInkSession(mapInkActions, "transparent");
  const mapInkSession = mapInk.session;
  const openMapInk = mapInk.open;
  const createMapInk = mapInk.create;
  const closeMapInk = mapInk.close;
  const refreshMapInk = mapInk.refresh;
  /** Note the open map drawing belongs to; the view is reused when another note is opened. */
  const mapInkNote = useRef<string | null>(null);
  /**
   * Note each map drawing session was started for, by session key. A drawing whose strokes could
   * not be saved stays open (the session refuses to drop them), but is never shown on another note.
   */
  const mapInkOwners = useRef(new Map<number, string>());
  if (mapInkSession && !mapInkOwners.current.has(mapInkSession.key) && mapInkNote.current) {
    mapInkOwners.current.set(mapInkSession.key, mapInkNote.current);
  }
  const mapInkOwner = mapInkSession ? mapInkOwners.current.get(mapInkSession.key) ?? null : null;
  const shownMapInk = mapInkSession && mapInkOwner === props.filePath ? mapInkSession : null;
  /** Latest strokes of the open map drawing; the session only holds what was loaded. */
  const mapInkLatest = useRef<{ key: number; document: InkDocument } | null>(null);
  const changeMapInk = mapInk.change;
  const onMapInkChange = useCallback((document: InkDocument) => {
    if (mapInkSession) mapInkLatest.current = { key: mapInkSession.key, document };
    changeMapInk(document);
  }, [changeMapInk, mapInkSession]);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const cards = useMemo(() => studyCards(props.headings), [props.headings]);
  const learning = props.learning ?? null;
  const learnSettings = learning?.settings ?? null;
  const levels = learnSettings?.levels ?? 3;
  const spaced = Boolean(learnSettings?.spacedRepetition);
  const entries = learning?.entries ?? NO_ENTRIES;
  const today = dayKey(new Date());
  const [orderChoice, setOrderChoice] = useState<StudyOrder | null>(null);
  const preferredOrder = orderChoice ?? learnSettings?.order ?? "map";
  const order: StudyOrder = !spaced && (preferredOrder === "due" || preferredOrder === "onlyDue") ? "map" : preferredOrder;
  /** The cards of the running session, fixed when it starts so rating a node does not reshuffle it. */
  const [sessionIds, setSessionIds] = useState<string[] | null>(null);
  const session = useMemo(() => {
    if (!learning || !sessionIds) return cards;
    const present = new Set(cards);
    return sessionIds.filter((id) => present.has(id));
  }, [cards, learning, sessionIds]);
  const sessionSet = useMemo(() => new Set(session), [session]);
  const startSession = useCallback((next: StudyOrder) => {
    setSessionIds(learning ? studyOrder(cards, learning.entries, levels, dayKey(new Date()), next) : null);
    setRevealed(new Set());
  }, [cards, learning, levels]);
  const progress = studyProgress(session, revealed);
  const learnSummary = learning ? summarize(cards, entries, levels, today, spaced) : null;
  const branches = useMemo(
    () => (learnSettings?.branchProgress ? branchProgress(props.headings, cards, entries, levels) : null),
    [cards, entries, learnSettings?.branchProgress, levels, props.headings],
  );
  const rateNode = learning?.rate ?? noRate;
  const reveal = useCallback((id: string) => setRevealed((current) => new Set([...current, id])), []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mode, setMode] = useState<"map" | "outline" | "presentation">(props.layout.mode ?? "map");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set(props.layout.collapsed));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const pendingChildAdds = useRef(new Set<string>());
  const pendingSiblingAdds = useRef(new Set<string>());
  const latestLayout = useRef<PersistedCanvasLayout>(props.layout ?? EMPTY_LAYOUT);
  const runtimePositions = useRef<Record<string, NodePosition>>(props.layout.positions ?? {});
  const runtimeSizes = useRef<Record<string, NodeSize>>(props.layout.sizes ?? {});

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
      ...(patch.sizes || latestLayout.current.sizes ? { sizes: patch.sizes ?? latestLayout.current.sizes } : {}),
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

  const [sizeRevision, setSizeRevision] = useState(0);
  const resizeNode = useCallback((id: string, box: NodePosition & NodeSize) => {
    runtimeSizes.current = { ...runtimeSizes.current, [id]: { width: Math.round(box.width), height: Math.round(box.height) } };
    // Resizing from the left or top edge also moves the node.
    runtimePositions.current = { ...runtimePositions.current, [id]: { x: box.x, y: box.y } };
    persist({ sizes: runtimeSizes.current, positions: runtimePositions.current });
    setSizeRevision((value) => value + 1);
  }, [persist]);

  const resetNodeSize = useCallback((id: string) => {
    const { [id]: _removed, ...rest } = runtimeSizes.current;
    runtimeSizes.current = rest;
    persist({ sizes: rest });
    setSizeRevision((value) => value + 1);
  }, [persist]);

  const exportMap = useCallback(async (format: "png" | "pdf") => {
    const shell = shellRef.current;
    const viewportElement = shell?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!shell || !viewportElement) return;
    const flowNodes = reactFlow.getNodes();
    const inkDocument = shownMapInk && (mapInkLatest.current?.key === shownMapInk.key ? mapInkLatest.current.document : shownMapInk.document);
    const bounds = exportBounds(getNodesBounds(flowNodes), inkDocument ? inkContentBounds(inkDocument) : null, flowNodes.length > 0);
    const { width, height } = exportSize(bounds);
    const view = getViewportForBounds(bounds, width, height, 0.05, 4, 0.04);
    const flow = shell.querySelector<HTMLElement>(".bloommd-flow-wrap") ?? shell;
    const flowBackground = getComputedStyle(flow).backgroundColor;
    const background = flowBackground && flowBackground !== "rgba(0, 0, 0, 0)" ? flowBackground : getComputedStyle(document.body).backgroundColor;
    try {
      // Nodes and labels come from html-to-image, without edges and without editing chrome.
      const nodesUrl = await toPng(viewportElement, {
        width,
        height,
        pixelRatio: 1,
        // Fonts are the system's; skipping the web-font scan avoids fetching Obsidian's stylesheets.
        skipFonts: true,
        filter: (node) => !(node instanceof Element && EXPORT_HIDDEN.some((selector) => node.matches(selector))),
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` },
      });
      // React Flow draws each edge in its own unsized SVG, which html-to-image loses; the edges are
      // painted directly from their path data underneath the nodes instead.
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available for the export.");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.setTransform(view.zoom, 0, 0, view.zoom, view.x, view.y);
      for (const path of shell.querySelectorAll<SVGPathElement>(".react-flow__edges path")) {
        const style = getComputedStyle(path);
        const d = path.getAttribute("d");
        if (!d || style.stroke === "none" || style.visibility === "hidden") continue;
        context.strokeStyle = style.stroke;
        context.lineWidth = Number.parseFloat(style.strokeWidth) || 1;
        context.setLineDash(style.strokeDasharray && style.strokeDasharray !== "none" ? style.strokeDasharray.split(/[ ,]+/).map(Number.parseFloat) : []);
        context.stroke(new Path2D(d));
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      const nodes = document.createElement("img");
      nodes.src = nodesUrl;
      await nodes.decode();
      context.drawImage(nodes, 0, 0);
      // Handwriting on the map sits above the nodes, painted like the edges from its own paths.
      context.setTransform(view.zoom, 0, 0, view.zoom, view.x, view.y);
      for (const path of shell.querySelectorAll<SVGPathElement>(".bloommd-map-ink path[data-stroke-id]")) {
        const d = path.getAttribute("d");
        if (!d) continue;
        context.globalAlpha = Number.parseFloat(path.getAttribute("fill-opacity") ?? "1") || 1;
        context.fillStyle = path.getAttribute("fill") ?? "#000";
        context.fill(new Path2D(d));
      }
      context.globalAlpha = 1;
      context.setTransform(1, 0, 0, 1, 0, 0);
      const data = format === "png"
        ? dataUrlToBytes(canvas.toDataURL("image/png"))
        : jpegToPdf(dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)), width, height);
      await props.actions.saveExport(format, data);
    } catch (error) {
      console.error("BloomMD could not export the map", error);
    }
  }, [shownMapInk, props.actions, reactFlow]);

  useEffect(() => {
    // Load the map's drawing when the note links one; keep an open session while the frontmatter
    // link of a just-created drawing is still being indexed, but never show it on another note.
    const step = mapInkStep(props.filePath, props.mapInkPath ?? null, mapInkSession ? { path: mapInkSession.path, note: mapInkOwner } : null);
    if (step === "open" && props.mapInkPath) {
      mapInkNote.current = props.filePath;
      void openMapInk(props.mapInkPath);
    } else if (step === "close") {
      void closeMapInk();
    }
  }, [closeMapInk, mapInkOwner, mapInkSession, openMapInk, props.filePath, props.mapInkPath]);

  useEffect(() => {
    if (drawOnMap && !mapInkSession && !props.mapInkPath) {
      mapInkNote.current = props.filePath;
      void createMapInk();
    }
  }, [createMapInk, drawOnMap, mapInkSession, props.filePath, props.mapInkPath]);

  useEffect(() => {
    // The drawing file changed on disk: load it, or report a conflict while strokes are unsaved.
    if (props.mapInkRevision) void refreshMapInk();
  }, [props.mapInkRevision, refreshMapInk]);

  // Pen gestures that change the note or the drawing say so, with a way back: the pen may have
  // meant to write.
  const showMapNotice = useCallback((message: string, undo?: () => void) => {
    window.clearTimeout(mapNoticeTimer.current);
    setMapNotice({ message, ...(undo ? { undo } : {}) });
    mapNoticeTimer.current = window.setTimeout(() => setMapNotice(null), undo ? 6000 : 2500);
  }, []);
  useEffect(() => () => window.clearTimeout(mapNoticeTimer.current), []);
  const applyHistoryRef = useRef<(direction: "undo" | "redo") => void>(() => undefined);

  const connectByStroke = useCallback((source: string, target: string) => {
    const from = headingsById.get(source);
    const to = headingsById.get(target);
    if (!from || !to || from.kind !== "heading" || to.kind !== "heading") return;
    const relations = [...(from.metadata?.relations ?? []).filter((relation) => relation.target !== target), { target }];
    void run(() => props.actions.updateMetadata(source, withRelations(from.metadata, relations), from.metadata)).then((saved) => {
      if (saved) showMapNotice(`Connected ${from.title} → ${to.title}`, () => applyHistoryRef.current("undo"));
    });
  }, [headingsById, props.actions, run, showMapNotice]);

  // Obsidian closes its menu on Escape before BloomMD's key handler sees the key; the flag stays
  // set until that keydown is over, so the same Escape does not also leave focus or draw mode.
  const menuOpen = useRef(false);
  const openMenu = useCallback((position: { x: number; y: number }, items: CanvasMenuItem[]) => {
    menuOpen.current = true;
    props.actions.openMenu(position, items, () => window.setTimeout(() => { menuOpen.current = false; }, 0));
  }, [props.actions]);

  const openNodeMenu = useCallback((id: string, position: { x: number; y: number }) => {
    const heading = headingsById.get(id);
    if (!heading || heading.kind !== "heading") return;
    const isRoot = heading.parentId === null;
    const note = heading.metadata?.note;
    const items: CanvasMenuItem[] = [
      { title: "Edit content", icon: "file-text", onClick: () => { selectNode(id); setInspectorOpen(true); } },
      { title: "Add child", icon: "plus", onClick: () => addChild(id) },
      ...(isRoot ? [] : [{ title: "Add sibling", icon: "corner-down-right", onClick: () => addSibling(id) }]),
      {
        title: note ? "Link a different note" : "Link a note",
        icon: "link",
        onClick: () => void (async () => {
          const picked = await props.actions.pickNote();
          if (picked) await run(() => props.actions.linkNote(id, picked, heading.metadata));
        })(),
      },
      ...(note ? [{ title: `Open ${note}`, icon: "file", onClick: () => props.actions.openWikiLink(note) }] : []),
      ...(props.actions.askAgent ? [{ title: "Ask agent…", icon: "bot", onClick: () => props.actions.askAgent!(id, heading.title) }] : []),
      ...(runtimeSizes.current[id] ? [{ title: "Reset size", icon: "scaling", onClick: () => resetNodeSize(id) }] : []),
      ...(isRoot ? [] : [{ title: "Delete branch", icon: "trash-2", danger: true, onClick: () => deleteNode(id) }]),
    ];
    openMenu(position, items);
  }, [addChild, addSibling, deleteNode, headingsById, openMenu, props.actions, resetNodeSize, run, selectNode]);

  const noteHandlers = useMemo<LinkedNoteHandlers>(() => ({
    onOpenNote: props.actions.openWikiLink,
    onHoverNote: props.actions.hoverLink,
  }), [props.actions]);

  /** How a node shows its learning progress, and whether it offers rating buttons right now. */
  const learnData = useCallback((id: string, isCard: boolean) => {
    const entry = learnSettings && isCard ? entries[id] : undefined;
    const level = entry ? levelOn(entry, levels) : null;
    const branch = branches?.get(id);
    const hidden = study && sessionSet.has(id) && !revealed.has(id);
    return {
      learnLevel: level,
      learnStyle: learnSettings?.display ?? "off",
      learnColor: level !== null ? learnSettings?.colors[levels][level] : undefined,
      learnLabel: level !== null ? learnSettings?.names[levels][level] : undefined,
      learnDue: Boolean(spaced && learnSettings?.display !== "off" && isDue(entry, today)),
      branchLabel: branch && (headingsById.get(id)?.children.length ?? 0) > 0 ? `${branch.mastered}/${branch.total}` : undefined,
      outOfSession: Boolean(learnSettings && study && isCard && !sessionSet.has(id)),
      ratings: learnSettings && study && isCard && sessionSet.has(id) && !hidden ? { names: learnSettings.names[levels], colors: learnSettings.colors[levels] } : null,
      onRate: rateNode,
    };
  }, [branches, entries, headingsById, learnSettings, levels, rateNode, revealed, sessionSet, spaced, study, today]);

  const flowModel = useMemo(() => {
    // Real sizes where React Flow has measured them: previews and drawings make nodes much taller
    // than the default, and layout and collision checks must see that.
    const measured: Record<string, NodeSize> = {};
    for (const heading of props.headings) {
      const node = reactFlow.getInternalNode(heading.id);
      if (node?.measured.width && node.measured.height) measured[heading.id] = { width: node.measured.width, height: node.measured.height };
    }
    const layoutSizes = { ...measured, ...runtimeSizes.current };
    const automatic = autoLayout(props.headings, visibleIds, layoutSizes);
    const stored = (id: string) => runtimePositions.current[id] ?? props.layout.positions[id];
    const boxOf = (id: string, position: NodePosition) => ({
      ...position,
      width: layoutSizes[id]?.width ?? NODE_WIDTH,
      height: layoutSizes[id]?.height ?? NODE_HEIGHT,
    });
    // Nodes the user placed by hand stay put; nodes without a stored position (new ones) take their
    // automatic spot unless that would cover one of the placed nodes.
    const placed = props.headings.filter((heading) => visibleIds.has(heading.id) && stored(heading.id)).map((heading) => boxOf(heading.id, stored(heading.id)!));
    const resolved = new Map<string, NodePosition>();
    if (placed.length > 0) {
      // Resolve unplaced nodes in document order; each one then counts as occupied for the next.
      for (const heading of props.headings) {
        if (!visibleIds.has(heading.id) || stored(heading.id)) continue;
        const position = freePosition(boxOf(heading.id, automatic[heading.id] ?? { x: 0, y: 0 }), placed);
        resolved.set(heading.id, position);
        placed.push(boxOf(heading.id, position));
      }
    }
    const positionOf = (id: string): NodePosition => stored(id) ?? resolved.get(id) ?? automatic[id] ?? { x: 0, y: 0 };
    const nodes: BloomFlowNode[] = props.headings
      .filter((heading) => visibleIds.has(heading.id))
      .map((heading) => ({
        id: heading.id,
        type: "bloommd",
        position: positionOf(heading.id),
        ...(runtimeSizes.current[heading.id] ? { width: runtimeSizes.current[heading.id]!.width, height: runtimeSizes.current[heading.id]!.height } : {}),
        data: {
          heading,
          collapsed: collapsed.has(heading.id),
          externalLinkCount: externalLinks(heading.content).length,
          wikiLinkCount: wikiLinks(heading.content).length,
          // Study mode always shows content once revealed; that is what one studies.
          showContent: props.showNodeContent || study,
          studyHidden: study && sessionSet.has(heading.id) && !revealed.has(heading.id),
          onReveal: reveal,
          ...learnData(heading.id, cards.includes(heading.id)),
          drawingUrls: nodeDrawings(heading.content, props.actions.resolveEmbed)
            .flatMap((drawing) => drawing.path ? [props.actions.resourceUrl(drawing.path)] : []),
          autoEdit: autoEditId === heading.id,
          sized: Boolean(runtimeSizes.current[heading.id]),
          onResize: resizeNode,
          onResetSize: resetNodeSize,
          onOpenMenu: openNodeMenu,
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
          noteHandlers,
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
    const relations: Edge[] = relationEdges(props.headings, visibleIds).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "relation",
      selectable: false,
      ...(edge.label ? { label: edge.label } : {}),
    }));
    return { nodes, edges: [...edges, ...relations] };
    // sizeRevision is listed because sizes live in a ref and change without new props.
  }, [addChild, addSibling, autoEditId, cards, collapsed, deleteNode, headingsById, learnData, noteHandlers, openNodeMenu, props.actions, reactFlow, reveal, revealed, sessionSet, study, props.headings, props.layout.positions, props.showNodeContent, resetNodeSize, resizeNode, run, selectNode, sizeRevision, toggleCollapse, visibleIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<BloomFlowNode>(flowModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowModel.edges);

  useEffect(() => {
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]));
      const selected = new Map(current.map((node) => [node.id, node.selected]));
      const next = flowModel.nodes.map((node) => {
        const merged = { ...node, selected: selected.get(node.id) ?? false, position: positions.get(node.id) ?? node.position };
        // A reset size must drop the fixed dimensions so the node measures its content again.
        if (node.width === undefined) {
          delete merged.width;
          delete merged.height;
        }
        return merged;
      });
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
    runtimeSizes.current = { ...(props.layout.sizes ?? {}) };
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
    setDrawOnMap(false);
    setStudy(false);
    setRevealed(new Set());
    setSessionIds(null);
    setOrderChoice(null);
    window.setTimeout(() => {
      reactFlow.setNodes((current) => current.map((node) => {
        const selected = node.id === props.rootId;
        return node.selected === selected ? node : { ...node, selected };
      }));
      if (props.layout.viewport) void reactFlow.setViewport(props.layout.viewport, { duration: 0 });
      else void reactFlow.fitView({ padding: 0.25, duration: 180 });
    }, 20);
  }, [props.filePath]);

  useEffect(() => {
    if (!inspectorOpen) setInspectorFullscreen(false);
  }, [inspectorOpen]);

  const nextCard = session.find((id) => !revealed.has(id) && id !== selectedId) ?? null;

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

  /** Selects a node the way a click on it would, including React Flow's own selection. */
  const selectOnMap = useCallback((id: string) => {
    selectNode(id);
    setNodes((current) => current.map((node) => node.selected === (node.id === id) ? node : { ...node, selected: node.id === id }));
  }, [selectNode, setNodes]);

  /** Puts a node at a map position chosen by hand (pen drag, branch end, lassoed ink). */
  const placeNode = useCallback((id: string, position: NodePosition, save = true) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, position } : node));
    if (!save) return;
    runtimePositions.current = { ...runtimePositions.current, [id]: position };
    persist({ positions: runtimePositions.current });
  }, [persist, setNodes]);

  const branchAt = useCallback((sourceId: string, end: NodePosition) => {
    if (!claimPendingAction(pendingChildAdds.current, sourceId)) return;
    void run(async () => {
      try {
        const newId = await props.actions.addChild(sourceId);
        if (newId) {
          // The stroke ends where the pen lifted; the new node sits centred on that point.
          placeNode(newId, { x: end.x - NODE_WIDTH / 2, y: end.y - NODE_HEIGHT / 2 });
          selectNode(newId);
          setAutoEditId(newId);
          const parent = headingsById.get(sourceId);
          showMapNotice(parent ? `Added a child to ${parent.title}` : "Added a child node", () => applyHistoryRef.current("undo"));
        }
        return Boolean(newId);
      } finally {
        pendingChildAdds.current.delete(sourceId);
      }
    });
  }, [headingsById, placeNode, props.actions, run, selectNode, showMapNotice]);

  const createNodeFromMapInk = useCallback(async (document: InkDocument, title: string, position: NodePosition) => {
    const parentId = selectedIdsRef.current.size === 1 ? [...selectedIdsRef.current][0]! : props.rootId;
    if (!parentId) return false;
    let createdId: string | null = null;
    const saved = await run(async () => {
      createdId = await props.actions.createNodeFromInk(parentId, serializeInkSvg(document), title);
      return Boolean(createdId);
    });
    if (saved && createdId) {
      placeNode(createdId, position);
      selectNode(createdId);
    }
    return saved;
  }, [placeNode, props.actions, props.rootId, run, selectNode]);

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
  applyHistoryRef.current = applyHistory;

  const handleKeyboard = useCallback((event: KeyboardEvent) => {
    const target = event.target;
    // An open Obsidian menu owns Escape: closing it must not also leave focus or draw mode.
    if (event.key === "Escape" && menuOpen.current) return;
    // Focus mode covers everything, so Escape leaves it wherever the keyboard focus is, unless an
    // Obsidian dialog (note picker, confirmation) is open and owns Escape.
    if (focusMode && event.key === "Escape" && !inspectorOpen && !helpOpen && !document.querySelector(".modal-container")) {
      const inField = target instanceof HTMLElement && Boolean(target.closest("input, textarea, [contenteditable='true']"));
      if (!inField) {
        event.preventDefault();
        setFocusMode(false);
        return;
      }
    }
    if (!(target instanceof HTMLElement) || !shellRef.current?.contains(target)) return;
    const inTextField = Boolean(target.closest("input, textarea, [contenteditable='true']"));
    const primary = event.metaKey || event.ctrlKey;

    if (drawOnMap && event.key === "Escape" && !inTextField) {
      event.preventDefault();
      setDrawOnMap(false);
      return;
    }

    if (inspectorFullscreen) {
      // The full-screen inspector owns the view: map shortcuts must not act on hidden nodes.
      // Escape inside a text field (e.g. a text box on a drawing) only finishes that field.
      if (event.key === "Escape" && !inTextField) {
        event.preventDefault();
        setInspectorFullscreen(false);
      }
      return;
    }

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
    // Keys pressed on inspector controls (e.g. Backspace on a drawing tool) must not edit the map.
    if (target.closest(".bloommd-inspector") && event.key !== "Escape") return;

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
    // Study mode: Space reveals the selected card, 1–5 rate a revealed one and move on to the next.
    if (study && mode === "map" && !primary && !event.altKey && sessionSet.has(currentId)) {
      if (event.key === " " && !revealed.has(currentId)) {
        event.preventDefault();
        event.stopPropagation();
        reveal(currentId);
        return;
      }
      const rating = Number(event.key) - 1;
      if (learning && revealed.has(currentId) && Number.isInteger(rating) && rating >= 0 && rating < levels) {
        event.preventDefault();
        learning.rate(currentId, rating);
        const next = session.find((id) => id !== currentId && !revealed.has(id));
        if (next) focusNode(next);
        return;
      }
    }
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
  }, [addChild, addSibling, applyHistory, changeMode, copySelection, deleteNode, drawOnMap, focusMode, focusNode, helpOpen, inspectorFullscreen, inspectorOpen, learning, levels, mode, movePresentation, navigateSelection, pasteSelection, props.rootId, reveal, revealed, run, search, selectedHeading, selectedId, selectNode, session, sessionSet, study]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard, true);
    return () => window.removeEventListener("keydown", handleKeyboard, true);
  }, [handleKeyboard]);

  useEffect(() => {
    // Obsidian's workspace (leaf containment, ribbon and sidebar stacking) cannot be covered from
    // inside a leaf. Focus mode moves the React host to <body> and back; React keeps all state.
    const host = shellRef.current?.parentElement;
    const home = host?.parentElement;
    if (!host || !home || !focusMode) return;
    const next = host.nextSibling;
    document.body.appendChild(host);
    host.classList.add("is-focus-layer");
    return () => {
      host.classList.remove("is-focus-layer");
      if (home.isConnected) home.insertBefore(host, next && next.parentNode === home ? next : null);
      else host.remove();
    };
  }, [focusMode]);

  useEffect(() => {
    const root = shellRef.current?.parentElement;
    if (!root) return;
    // The Obsidian command reaches the canvas through its host element.
    const toggle = () => setFocusMode((current) => !current);
    root.addEventListener(FOCUS_MODE_EVENT, toggle);
    return () => root.removeEventListener(FOCUS_MODE_EVENT, toggle);
  }, []);

  useEffect(() => {
    // The React root container: listeners here run after React's own root listener (registered
    // first), so React still sees every touch while Obsidian's ancestors do not.
    const root = shellRef.current?.parentElement;
    if (!root) return;
    // Obsidian mobile opens its sidebars on horizontal swipes. Panning the map or a drawing with a
    // finger must stay inside BloomMD, so those touches never reach Obsidian's gesture handlers.
    const keepTouch = (event: TouchEvent) => {
      if (event.target instanceof Element && event.target.closest(".bloommd-ink-surface, .react-flow__renderer, .react-flow__pane")) {
        event.stopPropagation();
      }
    };
    root.addEventListener("touchstart", keepTouch, { passive: true });
    root.addEventListener("touchmove", keepTouch, { passive: true });
    return () => {
      root.removeEventListener("touchstart", keepTouch);
      root.removeEventListener("touchmove", keepTouch);
    };
  }, []);

  const performAutoLayout = useCallback(() => {
    const measured: Record<string, NodeSize> = {};
    for (const heading of props.headings) {
      const node = reactFlow.getInternalNode(heading.id);
      if (node?.measured.width && node.measured.height) measured[heading.id] = { width: node.measured.width, height: node.measured.height };
    }
    const automatic = autoLayout(props.headings, visibleIds, { ...measured, ...runtimeSizes.current });
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
      className={`bloommd-react-shell${focusMode ? " is-focus" : ""}`}
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
          {props.sharedStatus && <span className={`bloommd-share-status is-${props.sharedStatus}`} title={sharedStatusLabel(props.sharedStatus)}><Cloud size={14} />{sharedStatusLabel(props.sharedStatus)}</span>}
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
          {mode === "map" && (
            <button
              type="button"
              className="bloommd-icon-control"
              title={drawOnMap ? "Stop drawing on the map (Esc)" : "Draw on the map with pen or mouse; fingers still pan"}
              aria-label="Draw on map"
              aria-pressed={drawOnMap}
              onClick={() => {
                if (drawOnMap) void mapInk.flush();
                setDrawOnMap((current) => !current);
              }}
            >
              <Signature size={17} />
            </button>
          )}
          {mode === "map" && (
            <button
              type="button"
              className="bloommd-icon-control"
              title="Export map as PNG or PDF"
              aria-label="Export map"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                openMenu({ x: rect.left, y: rect.bottom + 4 }, [
                  { title: "Export as PNG", icon: "image", onClick: () => void exportMap("png") },
                  { title: "Export as PDF", icon: "file-text", onClick: () => void exportMap("pdf") },
                ]);
              }}
            >
              <ImageDown size={17} />
            </button>
          )}
          <button
            type="button"
            className="bloommd-icon-control"
            title={study ? "Leave study mode" : "Study mode: cover node contents"}
            aria-label="Study mode"
            aria-pressed={study}
            onClick={() => {
              if (!study) startSession(order);
              setStudy(!study);
              setRevealed(new Set());
            }}
          >
            <GraduationCap size={17} />
          </button>
          <button
            type="button"
            className="bloommd-icon-control"
            title={focusMode ? "Leave focus mode (Esc)" : "Focus mode: use the whole window"}
            aria-label={focusMode ? "Leave focus mode" : "Focus mode"}
            aria-pressed={focusMode}
            onClick={() => setFocusMode((current) => !current)}
          >
            {focusMode ? <Shrink size={17} /> : <Expand size={17} />}
          </button>
          <button type="button" className="bloommd-icon-control" title="Shortcut help (F1 or ?)" aria-label="Shortcut help" onClick={() => setHelpOpen(true)}><Keyboard size={17} /></button>
          {props.canOpenApp !== false && <button type="button" className="bloommd-text-control" title="Open this note in BloomMD Desktop, at the selected node" aria-label="Open app" onClick={() => props.actions.openBloomMD(selectedId)}><ExternalLink size={15} /><span>Open app</span></button>}
        </div>
      </div>

      <div className="bloommd-workspace">
        <main className={`bloommd-flow-wrap${drawOnMap ? " is-drawing-on-map" : ""}`} ref={setFlowHost}>
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
            {shownMapInk && (
              <MapInkLayer
                key={shownMapInk.key}
                document={shownMapInk.document}
                readOnly={shownMapInk.readOnly}
                active={drawOnMap}
                host={flowHost}
                onChange={onMapInkChange}
                onConnect={connectByStroke}
                onSelectNode={selectOnMap}
                onOpenNode={openInspector}
                onNodeMenu={openNodeMenu}
                onMoveNode={(id, position, final) => placeNode(id, position, final)}
                onBranch={branchAt}
                onNotice={showMapNotice}
                onCreateNode={createNodeFromMapInk}
                onDone={() => {
                  setDrawOnMap(false);
                  void mapInk.flush();
                }}
              />
            )}
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
              renderMarkdown={props.actions.renderMarkdown}
            />
          )}
          {mapNotice && (
            <div className={`bloommd-map-notice${mapNotice.undo ? " has-undo" : ""}`} role="status">
              <span>{mapNotice.message}</span>
              {mapNotice.undo && (
                <button type="button" className="bloommd-map-notice-undo" onClick={() => { mapNotice.undo?.(); window.clearTimeout(mapNoticeTimer.current); setMapNotice(null); }}>Undo</button>
              )}
            </div>
          )}
          {mode === "map" && (mapInk.error || mapInk.saveState === "conflict") && (
            <div className="bloommd-map-ink-status" role="alert">
              <AlertTriangle size={14} />
              <span>{mapInk.error ?? "The map drawing changed on another device. Your latest strokes are not saved."}</span>
              {mapInk.saveState === "conflict" && <button type="button" onClick={() => void mapInk.reload()}><RotateCcw size={14} /> Load saved drawing</button>}
            </div>
          )}
          {study && mode === "map" && (
            <div className="bloommd-study-bar" role="status">
              <GraduationCap size={15} />
              <span>{progress.revealed}/{progress.total} revealed</span>
              <button type="button" onClick={() => setRevealed(new Set(session))} disabled={progress.revealed === progress.total}><Eye size={14} /> Reveal all</button>
              <button type="button" onClick={() => setRevealed(new Set())} disabled={progress.revealed === 0}><RotateCcw size={14} /> Reset</button>
              {learning && learnSummary && (
                <LearningStatus
                  summary={learnSummary}
                  spaced={spaced}
                  order={order}
                  onOrder={(next) => {
                    setOrderChoice(next);
                    startSession(next);
                  }}
                  onNext={nextCard ? () => focusNode(nextCard) : null}
                  examDate={learning.examDate}
                  today={today}
                  onExamDate={learning.setExamDate}
                />
              )}
            </div>
          )}
          {/* In study mode the editor would show covered content, and the study bar needs the room. */}
          {!inspectorOpen && !study && mode === "map" && selectedHeading?.kind === "heading" && (
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
            fullscreen={inspectorFullscreen}
            onToggleFullscreen={() => setInspectorFullscreen((current) => !current)}
            onClose={() => setInspectorOpen(false)}
            onRename={(title, expected) => run(() => props.actions.renameNode(selectedHeading.id, title, expected))}
            onSave={(content, expected) => run(() => props.actions.updateContent(selectedHeading.id, content, expected))}
            onSaveMetadata={(metadata, expected) => run(() => props.actions.updateMetadata(selectedHeading.id, metadata, expected))}
            onOpenWiki={props.actions.openWikiLink}
            onOpenExternal={props.actions.openExternalLink}
            onOpenFile={props.actions.openFile}
            ink={{
              readInk: props.actions.readInk,
              // The drawing session keeps this closure from when it opened, so saves stay with this node.
              saveInk: (path, svg, expected, conflictOf) => props.actions.saveInk(selectedHeading.id, path, svg, expected, conflictOf),
              resolveEmbed: props.actions.resolveEmbed,
              resourceUrl: props.actions.resourceUrl,
              pickNote: props.actions.pickNote,
              createNodeFromInk: (svg, title) => run(async () => Boolean(await props.actions.createNodeFromInk(selectedHeading.id, svg, title))),
              onHoverLink: props.actions.hoverLink,
              onOpenLink: props.actions.openWikiLink,
            }}
            candidates={props.headings.filter((heading) => heading.kind === "heading" && heading.id !== selectedHeading.id).map((heading) => ({ id: heading.id, title: heading.title }))}
            onLinkNote={(note, expected) => run(() => props.actions.linkNote(selectedHeading.id, note, expected))}
          />
        )}
      </div>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function sharedStatusLabel(status: NonNullable<CanvasProps["sharedStatus"]>): string {
  if (status === "connected") return "Shared · connected";
  if (status === "offline") return "Shared · offline";
  if (status === "conflict") return "Shared · conflict needs attention";
  return "Shared · access revoked";
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
  // React renders into a host element rather than Obsidian's view container, so focus mode can
  // lift the whole canvas above the workspace and put it back without remounting.
  const host = document.createElement("div");
  host.className = "bloommd-canvas-host";
  container.appendChild(host);
  const root: Root = createRoot(host);
  return {
    host,
    render: (props) => root.render(
      <CanvasErrorBoundary onBack={props.actions.openMarkdown}>
        <BloomMDCanvas {...props} />
      </CanvasErrorBoundary>,
    ),
    unmount: () => {
      root.unmount();
      host.remove();
    },
  };
}
