import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Focus,
  Link2,
  LocateFixed,
  Network,
  PanelRightClose,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";

export interface CanvasHeading {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  content: string;
  children: string[];
  kind: "heading" | "file" | "folder";
  filePath?: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface PersistedCanvasLayout {
  positions: Record<string, NodePosition>;
  collapsed: string[];
  viewport?: Viewport;
}

export interface BacklinkEntry {
  path: string;
  title: string;
}

export interface CanvasActions {
  renameNode: (id: string, title: string, expectedTitle: string) => Promise<boolean>;
  updateContent: (id: string, content: string, expectedContent: string) => Promise<boolean>;
  addChild: (id: string) => Promise<string | null>;
  addSibling: (id: string) => Promise<string | null>;
  deleteBranch: (id: string) => Promise<boolean>;
  reparentBranch: (id: string, parentId: string) => Promise<boolean>;
  copyBranches: (sourceIds: string[], targetParentId: string) => Promise<boolean>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
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

interface ExternalLink {
  label: string;
  url: string;
  host: string;
}

interface WikiLink {
  label: string;
  target: string;
}

interface BloomNodeData extends Record<string, unknown> {
  heading: CanvasHeading;
  selected: boolean;
  collapsed: boolean;
  externalLinkCount: number;
  wikiLinkCount: number;
  showContent: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onRename: (id: string, title: string, expectedTitle: string) => Promise<boolean>;
  onToggleCollapse: (id: string) => void;
  onAddChild: (id: string) => void;
  onAddSibling: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenInspector: (id: string) => void;
  onOpenFile: (path: string) => void;
}

type BloomFlowNode = Node<BloomNodeData, "bloommd">;

const EMPTY_LAYOUT: PersistedCanvasLayout = { positions: {}, collapsed: [] };
const NODE_WIDTH = 236;
const NODE_HEIGHT = 92;

function externalLinks(markdown: string): ExternalLink[] {
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

  for (const match of markdown.matchAll(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g)) {
    add(match[2] ?? "", (match[1] ?? "").trim());
  }
  for (const match of markdown.matchAll(/(^|[\s(])(https?:\/\/[^\s<>)\]]+)/g)) {
    add(match[2] ?? "", "");
  }
  return links;
}

function wikiLinks(markdown: string): WikiLink[] {
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

function contentPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "Code block")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, "$2$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleHeadingIds(headings: CanvasHeading[], collapsed: Set<string>, rootId: string): Set<string> {
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

function autoLayout(headings: CanvasHeading[], visible: Set<string>): Record<string, NodePosition> {
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

function BloomNode({ id, data }: NodeProps<BloomFlowNode>) {
  const heading = data.heading;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(heading.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = contentPreview(heading.content);
  const isRoot = heading.parentId === null;
  const editable = heading.kind === "heading";

  useEffect(() => setTitle(heading.title), [heading.title]);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commitTitle = useCallback(async () => {
    const nextTitle = title.trim();
    if (nextTitle && nextTitle !== heading.title) {
      const saved = await data.onRename(id, nextTitle, heading.title);
      if (!saved) setTitle(heading.title);
    } else {
      setTitle(heading.title);
    }
    setEditing(false);
  }, [data, heading.title, id, title]);

  return (
    <div
      className={`bloommd-flow-node bloommd-level-${Math.min(heading.level, 6)}${data.selected ? " is-selected" : ""}`}
      tabIndex={0}
      onClick={(event) => data.onSelect(id, event.shiftKey)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (editable) setEditing(true);
        else if (heading.filePath) data.onOpenFile(heading.filePath);
      }}
      onKeyDown={(event) => {
        if (editing || !editable) return;
        if (event.key === "F2") {
          event.preventDefault();
          setEditing(true);
        } else if (event.key === "Tab") {
          event.preventDefault();
          data.onAddChild(id);
        } else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !isRoot) {
          event.preventDefault();
          data.onAddSibling(id);
        } else if ((event.key === "Delete" || event.key === "Backspace") && !isRoot) {
          event.preventDefault();
          data.onDelete(id);
        }
      }}
    >
      {!isRoot && <Handle type="target" position={Position.Left} isConnectable={editable} className="bloommd-flow-handle bloommd-flow-handle--target" />}
      <div className="bloommd-node-heading">
        <span className="bloommd-node-level-dot" aria-label={editable ? `Heading level ${heading.level}` : heading.kind}>
          {editable ? `H${heading.level}` : heading.kind === "folder" ? "DIR" : "MD"}
        </span>
        {editing ? (
          <input
            ref={inputRef}
            className="bloommd-inline-title nodrag"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") void commitTitle();
              if (event.key === "Escape") {
                setTitle(heading.title);
                setEditing(false);
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

      {data.selected && !editing && editable && (
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

function Inspector({
  heading,
  backlinks,
  onClose,
  onSave,
  onOpenWiki,
  onOpenExternal,
}: {
  heading: CanvasHeading;
  backlinks: BacklinkEntry[];
  onClose: () => void;
  onSave: (content: string, expected: string) => Promise<boolean>;
  onOpenWiki: (target: string) => void;
  onOpenExternal: (url: string) => void;
}) {
  const [content, setContent] = useState(heading.content);
  const [baseline, setBaseline] = useState(heading.content);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const timer = useRef<number | null>(null);
  const external = useMemo(() => externalLinks(content), [content]);
  const wiki = useMemo(() => wikiLinks(content), [content]);

  useEffect(() => {
    setContent(heading.content);
    setBaseline(heading.content);
    setSaveState("saved");
  }, [heading.id]);

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
                <ExternalLink size={15} /><span><strong>{link.label}</strong><small>{link.host}</small></span>
              </button>
            ))}
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

function CanvasInner(props: CanvasProps) {
  const reactFlow = useReactFlow<BloomFlowNode>();
  const [selectedId, setSelectedId] = useState<string | null>(props.rootId || null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(props.rootId ? [props.rootId] : []));
  const [copiedBranchIds, setCopiedBranchIds] = useState<string[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set(props.layout.collapsed));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const latestLayout = useRef<PersistedCanvasLayout>(props.layout ?? EMPTY_LAYOUT);
  const runtimePositions = useRef<Record<string, NodePosition>>(props.layout.positions ?? {});

  const headingsById = useMemo(() => new Map(props.headings.map((heading) => [heading.id, heading])), [props.headings]);
  const selectedHeading = selectedId ? headingsById.get(selectedId) ?? null : null;
  const visibleIds = useMemo(() => visibleHeadingIds(props.headings, collapsed, props.rootId), [collapsed, props.headings, props.rootId]);

  const selectNode = useCallback((id: string, additive = false) => {
    setSelectedIds((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedId(next.has(id) ? id : [...next][0] ?? null);
      return next;
    });
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
    };
    latestLayout.current = next;
    props.actions.persistLayout(next);
  }, [props.actions]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist({ collapsed: [...next] });
      return next;
    });
  }, [persist]);

  const flowModel = useMemo(() => {
    const automatic = autoLayout(props.headings, visibleIds);
    const nodes: BloomFlowNode[] = props.headings
      .filter((heading) => visibleIds.has(heading.id))
      .map((heading) => ({
        id: heading.id,
        type: "bloommd",
        selected: selectedIds.has(heading.id),
        position: runtimePositions.current[heading.id] ?? props.layout.positions[heading.id] ?? automatic[heading.id] ?? { x: 0, y: 0 },
        data: {
          heading,
          selected: selectedIds.has(heading.id),
          collapsed: collapsed.has(heading.id),
          externalLinkCount: externalLinks(heading.content).length,
          wikiLinkCount: wikiLinks(heading.content).length,
          showContent: props.showNodeContent,
          onSelect: selectNode,
          onRename: (id, title, expected) => run(() => props.actions.renameNode(id, title, expected)),
          onToggleCollapse: toggleCollapse,
          onAddChild: (id) => {
            void run(async () => {
              const newId = await props.actions.addChild(id);
              if (newId) {
                selectNode(newId);
                setInspectorOpen(true);
              }
              return Boolean(newId);
            });
          },
          onAddSibling: (id) => {
            void run(async () => {
              const newId = await props.actions.addSibling(id);
              if (newId) {
                selectNode(newId);
                setInspectorOpen(true);
              }
              return Boolean(newId);
            });
          },
          onDelete: (id) => void run(() => props.actions.deleteBranch(id)),
          onOpenInspector: (id) => {
            selectNode(id);
            setInspectorOpen(true);
          },
          onOpenFile: props.actions.openFile,
        },
      }));
    const edges: Edge[] = props.headings
      .filter((heading) => heading.parentId && visibleIds.has(heading.id) && visibleIds.has(heading.parentId))
      .map((heading) => ({ id: `${heading.parentId}-${heading.id}`, source: heading.parentId!, target: heading.id, type: "bloommd" }));
    return { nodes, edges };
  }, [collapsed, props.actions, props.headings, props.layout.positions, props.showNodeContent, run, selectNode, selectedIds, toggleCollapse, visibleIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<BloomFlowNode>(flowModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowModel.edges);

  useEffect(() => {
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]));
      return flowModel.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
    });
    setEdges(flowModel.edges);
  }, [flowModel, setEdges, setNodes]);

  useEffect(() => {
    if (selectedId && !headingsById.has(selectedId)) {
      setSelectedId(props.rootId || null);
      setSelectedIds(new Set(props.rootId ? [props.rootId] : []));
      setInspectorOpen(false);
    }
  }, [headingsById, props.rootId, selectedId]);

  useEffect(() => {
    runtimePositions.current = { ...(props.layout.positions ?? {}) };
    latestLayout.current = props.layout ?? EMPTY_LAYOUT;
    setCollapsed(new Set(props.layout.collapsed ?? []));
    setSelectedId(props.rootId || null);
    setSelectedIds(new Set(props.rootId ? [props.rootId] : []));
    setCopiedBranchIds([]);
    setInspectorOpen(false);
    setSearch("");
    window.setTimeout(() => {
      if (props.layout.viewport) void reactFlow.setViewport(props.layout.viewport, { duration: 0 });
      else void reactFlow.fitView({ padding: 0.25, duration: 180 });
    }, 20);
  }, [props.filePath]);

  const focusNode = useCallback((id: string) => {
    const node = reactFlow.getNode(id);
    if (!node) return;
    selectNode(id);
    void reactFlow.fitView({ nodes: [node], padding: 1.3, duration: 240, maxZoom: 1.15 });
  }, [reactFlow, selectNode]);

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

  const copySelection = useCallback(() => {
    const copyable = [...selectedIds].filter((id) => headingsById.get(id)?.kind === "heading");
    if (copyable.length > 0) setCopiedBranchIds(copyable);
  }, [headingsById, selectedIds]);

  const pasteSelection = useCallback(() => {
    if (!selectedId || copiedBranchIds.length === 0 || headingsById.get(selectedId)?.kind !== "heading") return;
    void run(() => props.actions.copyBranches(copiedBranchIds, selectedId));
  }, [copiedBranchIds, headingsById, props.actions, run, selectedId]);

  return (
    <div
      className="bloommd-react-shell"
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) return;
        if (!(event.metaKey || event.ctrlKey)) return;
        if (event.key.toLowerCase() === "c") {
          event.preventDefault();
          copySelection();
        } else if (event.key.toLowerCase() === "v") {
          event.preventDefault();
          pasteSelection();
        } else if (event.key.toLowerCase() === "z" && !event.shiftKey) {
          event.preventDefault();
          void run(props.actions.undo);
        } else if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
          event.preventDefault();
          void run(props.actions.redo);
        }
      }}
    >
      <div className="bloommd-app-toolbar">
        <button type="button" className="bloommd-icon-control" title="Back to Markdown" onClick={props.actions.openMarkdown}><ArrowLeft size={17} /></button>
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
          />
          {searchMatches.length > 0 && (
            <div className="bloommd-search-results">
              {searchMatches.map((heading) => <button key={heading.id} type="button" onClick={() => { focusNode(heading.id); setSearch(""); }}>{heading.title}</button>)}
            </div>
          )}
        </div>
        <span className="bloommd-toolbar-spacer" />
        <SaveState state={saveState} />
        <button type="button" className="bloommd-icon-control" title="Copy selected branches (Cmd/Ctrl+C)" disabled={selectedIds.size === 0} onClick={copySelection}><Copy size={17} /></button>
        <button type="button" className="bloommd-icon-control" title="Paste branches as children (Cmd/Ctrl+V)" disabled={!selectedId || copiedBranchIds.length === 0} onClick={pasteSelection}><ClipboardPaste size={17} /></button>
        <button type="button" className="bloommd-icon-control" title="Undo (Cmd/Ctrl+Z)" disabled={!props.canUndo} onClick={() => void run(props.actions.undo)}><Undo2 size={17} /></button>
        <button type="button" className="bloommd-icon-control" title="Redo (Cmd/Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={() => void run(props.actions.redo)}><Redo2 size={17} /></button>
        <button type="button" className="bloommd-icon-control" title="Auto layout" onClick={performAutoLayout}><Sparkles size={17} /></button>
        <button type="button" className="bloommd-icon-control" title="Fit view" onClick={() => void reactFlow.fitView({ padding: 0.25, duration: 240 })}><LocateFixed size={17} /></button>
        {selectedId && <button type="button" className="bloommd-icon-control" title="Focus selected node" onClick={() => focusNode(selectedId)}><Focus size={17} /></button>}
        <button type="button" className="bloommd-icon-control" title="Open in BloomMD" onClick={props.actions.openBloomMD}><ExternalLink size={17} /></button>
      </div>

      <div className="bloommd-workspace">
        <main className="bloommd-flow-wrap">
          <ReactFlow<BloomFlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onPaneClick={() => { setSelectedId(null); setSelectedIds(new Set()); }}
            onSelectionChange={({ nodes: selectedNodes }) => {
              const ids = new Set(selectedNodes.map((node) => node.id));
              setSelectedIds(ids);
              if (ids.size > 0 && (!selectedId || !ids.has(selectedId))) setSelectedId([...ids][0] ?? null);
            }}
            onNodeDragStop={(_, node) => {
              runtimePositions.current = { ...runtimePositions.current, [node.id]: node.position };
              persist({ positions: runtimePositions.current });
            }}
            onConnect={(connection: Connection) => {
              if (!connection.source || !connection.target || connection.source === connection.target) return;
              void run(() => props.actions.reparentBranch(connection.target!, connection.source!));
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
          {!inspectorOpen && selectedHeading?.kind === "heading" && (
            <button type="button" className="bloommd-open-inspector" onClick={() => setInspectorOpen(true)} title="Open content editor">
              <PanelRightClose size={16} />
              Edit content
            </button>
          )}
        </main>

        {inspectorOpen && selectedHeading?.kind === "heading" && (
          <Inspector
            key={selectedHeading.id}
            heading={selectedHeading}
            backlinks={props.backlinks}
            onClose={() => setInspectorOpen(false)}
            onSave={(content, expected) => run(() => props.actions.updateContent(selectedHeading.id, content, expected))}
            onOpenWiki={props.actions.openWikiLink}
            onOpenExternal={props.actions.openExternalLink}
          />
        )}
      </div>
    </div>
  );
}

function BloomMDCanvas(props: CanvasProps) {
  if (props.headings.length === 0) {
    return <div className="bloommd-empty-state"><Network size={32} /><h3>No Markdown headings found</h3><p>Add a heading to the note and the mind map will update automatically.</p></div>;
  }
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}

export function createCanvasMount(container: HTMLElement): CanvasMount {
  const root: Root = createRoot(container);
  return {
    render: (props) => root.render(<BloomMDCanvas {...props} />),
    unmount: () => root.unmount(),
  };
}
