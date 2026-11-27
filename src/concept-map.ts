import { linkTargetsPath } from "./ink-document";
import { parseHeadingTree, updateHeadingMetadata, type MarkdownHeadingNode, type MarkdownNodeMetadata } from "./markdown-document";

export interface NodeRelation {
  target: string;
  label?: string;
}

export interface RelationEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/** A plain topic without links carries no metadata comment at all. */
function normalize(metadata: MarkdownNodeMetadata): MarkdownNodeMetadata | undefined {
  const { note, relations, ...rest } = metadata;
  const next: MarkdownNodeMetadata = {
    ...rest,
    ...(note?.trim() ? { note: note.trim() } : {}),
    ...(relations && relations.length > 0 ? { relations } : {}),
  };
  return next.kind === "topic" && !next.note && !next.relations ? undefined : next;
}

export function withLinkedNote(metadata: MarkdownNodeMetadata | undefined, note: string | null): MarkdownNodeMetadata | undefined {
  const { note: _previous, ...rest } = metadata ?? { kind: "topic" as const };
  return normalize(note ? { ...rest, note } : rest);
}

export function withRelations(metadata: MarkdownNodeMetadata | undefined, relations: NodeRelation[]): MarkdownNodeMetadata | undefined {
  const { relations: _previous, ...rest } = metadata ?? { kind: "topic" as const };
  const seen = new Set<string>();
  const unique = relations.filter((relation) => {
    if (!relation.target || seen.has(relation.target)) return false;
    seen.add(relation.target);
    return true;
  }).map((relation) => (relation.label?.trim() ? { target: relation.target, label: relation.label.trim() } : { target: relation.target }));
  return normalize({ ...rest, relations: unique });
}

/**
 * Changing a node's type keeps what makes it part of the concept map: its linked note and its
 * relations survive a switch to or from "topic".
 */
export function withKind(metadata: MarkdownNodeMetadata | undefined, kind: MarkdownNodeMetadata["kind"]): MarkdownNodeMetadata | undefined {
  const conceptMap = {
    ...(metadata?.note ? { note: metadata.note } : {}),
    ...(metadata?.relations?.length ? { relations: metadata.relations } : {}),
  };
  if (kind === "topic") return normalize({ kind, ...conceptMap });
  return normalize({ ...(metadata?.kind === "topic" ? conceptMap : metadata), kind });
}

/**
 * Concept-map connections beyond the heading hierarchy. Relations to nodes that are gone or hidden
 * (collapsed) are not drawn but stay in the Markdown, so collapsing or undoing never loses them.
 */
export function relationEdges(
  headings: Array<{ id: string; parentId: string | null; metadata?: MarkdownNodeMetadata }>,
  visible: Set<string>,
): RelationEdge[] {
  const parentOf = new Map(headings.map((heading) => [heading.id, heading.parentId]));
  const edges: RelationEdge[] = [];
  const seen = new Set<string>();
  for (const heading of headings) {
    for (const relation of heading.metadata?.relations ?? []) {
      const { target } = relation;
      if (target === heading.id || !visible.has(heading.id) || !visible.has(target) || !parentOf.has(target)) continue;
      // A relation that repeats the hierarchy edge would draw on top of it.
      if (parentOf.get(target) === heading.id || parentOf.get(heading.id) === target) continue;
      const key = [heading.id, target].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: `relation:${heading.id}:${target}`, source: heading.id, target, ...(relation.label ? { label: relation.label } : {}) });
    }
  }
  return edges;
}

export type BacklinkProblem = "broken" | "ambiguous";

export interface BacklinkEdge {
  id: string;
  /** The node whose content links... */
  source: string;
  /** ...to this node. The arrow runs source → target. */
  target: string;
}

/** A link that was not turned into an edge, shown as a warning on its source node. */
export interface UnresolvedBacklink {
  source: string;
  /** The link as written, without brackets or alias. */
  link: string;
  reason: BacklinkProblem;
}

export interface BacklinkNode {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  kind: "heading" | "file" | "folder";
  /** Vault path of a file node. */
  filePath?: string;
}

export interface BacklinkResolver {
  /** Vault path of the note a single-note map shows; null for a folder map. */
  notePath: string | null;
  /** Obsidian's link resolution: where `linkpath` (no `#fragment`) written in `fromPath` points, or null. */
  resolve: (linkpath: string, fromPath: string) => string | null;
  /** Links a note writes, as link text; folder-map file nodes have no content of their own. */
  linksOf?: (path: string) => string[];
}

/** `[[…]]` links as written (target with fragment, no alias); embeds and fenced code do not count. */
export function wikiLinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  // No lookbehind: older iOS WebKit lacks it.
  for (const match of markdown.replace(/```[\s\S]*?```/g, " ").matchAll(/(!?)\[\[([^\]|]+)(?:\|[^\]]+)?]]/g)) {
    const target = (match[2] ?? "").trim();
    if (match[1] || !target || seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
}

const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Which heading nodes a fragment (`Heading`, `Page#Heading#Sub`, a BloomMD node id or
 * `bloommd:id=<id>`) names. Titles match like Obsidian does: ignoring case and spacing; a nested
 * fragment narrows the candidates to those under the outer headings.
 */
function headingsForFragment(fragment: string, nodes: BacklinkNode[], parentOf: Map<string, string | null>, byId: Map<string, BacklinkNode>): BacklinkNode[] {
  const segments = fragment.split("#").map((segment) => segment.trim()).filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return [];
  const id = last.replace(/^bloommd:id=/i, "");
  const byNodeId = byId.get(id);
  if (byNodeId?.kind === "heading") return [byNodeId];
  const wanted = normalizeTitle(last);
  const candidates = nodes.filter((node) => node.kind === "heading" && normalizeTitle(node.title) === wanted);
  if (segments.length === 1) return candidates;
  return candidates.filter((candidate) => {
    let index = segments.length - 2;
    let current = parentOf.get(candidate.id) ?? null;
    while (current && index >= 0) {
      if (normalizeTitle(byId.get(current)?.title ?? "") === normalizeTitle(segments[index]!)) index -= 1;
      current = parentOf.get(current) ?? null;
    }
    return index < 0;
  });
}

/**
 * Backlink edges: an edge from node B to node A when B links to A. A pure view derived from the
 * links; it never writes anything. In a single-note map, headings link to headings of the same
 * note (`[[#Heading]]`, `[[Note#Heading]]`, or the node id as the fragment). In a folder map, file
 * nodes link to file nodes. A link whose target cannot be found (`broken`) or names several nodes
 * (`ambiguous`) is not guessed at; it lands in `unresolved`. Links that leave the map (another note,
 * a file outside the folder) are not part of it and are ignored. Nodes that are not `visible`
 * (collapsed away) get neither edges nor warnings, and an edge that would only repeat a
 * hierarchy edge or one of the `relations` is left out, like relation edges do.
 */
export function backlinkEdges(
  nodes: BacklinkNode[],
  visible: Set<string>,
  resolver: BacklinkResolver,
  relations: Array<{ source: string; target: string }> = [],
): { edges: BacklinkEdge[]; unresolved: UnresolvedBacklink[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const fileNodes = new Map<string, string>();
  for (const node of nodes) if (node.kind === "file" && node.filePath) fileNodes.set(node.filePath, node.id);
  const pair = (a: string, b: string) => [a, b].sort().join("\u0000");
  const covered = new Set(relations.map((relation) => pair(relation.source, relation.target)));
  const edges: BacklinkEdge[] = [];
  const unresolved: UnresolvedBacklink[] = [];
  const seenEdges = new Set<string>();
  const seenProblems = new Set<string>();

  const problem = (source: string, link: string, reason: BacklinkProblem) => {
    const key = `${source}\u0000${link}`;
    if (seenProblems.has(key)) return;
    seenProblems.add(key);
    unresolved.push({ source, link, reason });
  };
  const connect = (source: string, target: string) => {
    if (source === target || !visible.has(target)) return;
    if (parentOf.get(target) === source || parentOf.get(source) === target || covered.has(pair(source, target))) return;
    const id = `backlink:${source}:${target}`;
    if (seenEdges.has(id)) return;
    seenEdges.add(id);
    edges.push({ id, source, target });
  };

  for (const node of nodes) {
    if (!visible.has(node.id)) continue;
    if (node.kind === "heading" && resolver.notePath !== null) {
      const notePath = resolver.notePath;
      for (const link of wikiLinkTargets(node.content)) {
        const hash = link.indexOf("#");
        const linkpath = (hash < 0 ? link : link.slice(0, hash)).trim();
        const fragment = hash < 0 ? "" : link.slice(hash + 1);
        const destination = linkpath ? resolver.resolve(linkpath, notePath) : notePath;
        if (destination === null) problem(node.id, link, "broken");
        // The whole note, a block reference, or another note: no heading of this map is meant.
        else if (destination !== notePath || !fragment.trim() || fragment.startsWith("^")) continue;
        else {
          const found = headingsForFragment(fragment, nodes, parentOf, byId);
          if (found.length === 0) problem(node.id, link, "broken");
          else if (found.length > 1) problem(node.id, link, "ambiguous");
          else connect(node.id, found[0]!.id);
        }
      }
    } else if (node.kind === "file" && node.filePath && resolver.linksOf) {
      for (const link of resolver.linksOf(node.filePath)) {
        const hash = link.indexOf("#");
        const linkpath = (hash < 0 ? link : link.slice(0, hash)).trim();
        const destination = linkpath ? resolver.resolve(linkpath, node.filePath) : node.filePath;
        if (destination === null) problem(node.id, link, "broken");
        else {
          const target = fileNodes.get(destination);
          if (target) connect(node.id, target);
        }
      }
    }
  }
  return { edges, unresolved };
}

function walk(nodes: MarkdownHeadingNode[], visit: (node: MarkdownHeadingNode) => void): void {
  for (const node of nodes) {
    visit(node);
    walk(node.children, visit);
  }
}

/**
 * Rewrites `note` links after a note was renamed; returns the input when nothing pointed at it.
 * `pointedAtOld` confirms a candidate link really meant the renamed note from this file (a link
 * that still resolves to another note with the same name is left alone).
 */
export function retargetLinkedNotes(
  markdown: string,
  oldPath: string,
  linktext: string,
  pointedAtOld: (note: string) => boolean = () => true,
): string {
  if (!markdown.includes("bloommd:meta")) return markdown;
  let next = markdown;
  walk(parseHeadingTree(markdown), (node) => {
    const note = node.metadata?.note;
    if (!note || !linkTargetsPath(note, oldPath) || !pointedAtOld(note)) return;
    const heading = note.includes("#") ? note.slice(note.indexOf("#")) : "";
    next = updateHeadingMetadata(next, node.id, { ...node.metadata!, note: `${linktext}${heading}` });
  });
  return next;
}

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the line from the box centre towards `toward` leaves the box border. */
export function borderPoint(box: NodeBox, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** Straight connection between the facing borders of two nodes, wherever they sit on the map. */
export function floatingEdgeEnds(source: NodeBox, target: NodeBox): { sx: number; sy: number; tx: number; ty: number } {
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const start = borderPoint(source, targetCenter);
  const end = borderPoint(target, sourceCenter);
  return { sx: start.x, sy: start.y, tx: end.x, ty: end.y };
}

/** Nodes that have something to reveal in study mode: text or embedded drawings under the title. */
export function studyCards(headings: Array<{ id: string; kind: string; content: string }>): string[] {
  return headings.filter((heading) => heading.kind === "heading" && heading.content.trim().length > 0).map((heading) => heading.id);
}

export function studyProgress(cards: string[], revealed: ReadonlySet<string>): { revealed: number; total: number } {
  return { revealed: cards.filter((id) => revealed.has(id)).length, total: cards.length };
}

/** Frontmatter property that links a note to the handwriting drawn directly on its map. */
export const MAP_INK_PROPERTY = "bloommd-map-ink";

/** Link text of the map drawing from the frontmatter value (`[[x.svg]]` or a plain path). */
export function mapInkLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = value.trim().replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0]!.trim();
  return link.toLowerCase().endsWith(".svg") ? link : null;
}

/**
 * Creates a new map drawing, then links it from the note. The created file is returned even when
 * the link fails: autosave keeps writing into it instead of creating a fresh copy on every save.
 */
export async function createLinkedMapInk(store: {
  create: () => Promise<string>;
  link: (path: string) => Promise<boolean>;
  warn: (message: string) => void;
}): Promise<string> {
  const path = await store.create();
  const linked = await store.link(path).catch((error: unknown) => {
    console.error("BloomMD could not link the map drawing", error);
    return false;
  });
  if (!linked) store.warn(`BloomMD: The map drawing was saved as ${path}, but it could not be linked from the note.`);
  return path;
}

/**
 * A stroke that starts on one node and ends on another is a connection gesture, like drawing a
 * line between two boxes on paper. Returns the two node ids, or null for ordinary handwriting.
 */
export function connectionFromStroke(
  points: Array<[number, number, ...number[]]>,
  nodes: Array<NodeBox & { id: string }>,
): { source: string; target: string } | null {
  if (points.length < 2) return null;
  const inside = (point: [number, number, ...number[]]) => nodes.find((node) =>
    point[0] >= node.x && point[0] <= node.x + node.width && point[1] >= node.y && point[1] <= node.y + node.height);
  const start = inside(points[0]!);
  const end = inside(points[points.length - 1]!);
  return start && end && start.id !== end.id ? { source: start.id, target: end.id } : null;
}

/**
 * Moves a node that has no stored position down from its automatic spot until it no longer covers
 * a node the user placed by hand.
 */
export function freePosition(candidate: NodeBox, occupied: NodeBox[], gap = 24, maxSteps = 60): { x: number; y: number } {
  const overlaps = (y: number) => occupied.some((box) =>
    candidate.x < box.x + box.width + gap && box.x < candidate.x + candidate.width + gap &&
    y < box.y + box.height + gap && box.y < y + candidate.height + gap);
  let y = candidate.y;
  for (let step = 0; step < maxSteps && overlaps(y); step += 1) {
    const blocking = occupied.filter((box) =>
      candidate.x < box.x + box.width + gap && box.x < candidate.x + candidate.width + gap &&
      y < box.y + box.height + gap && box.y < y + candidate.height + gap);
    y = Math.max(...blocking.map((box) => box.y + box.height + gap));
  }
  return { x: candidate.x, y };
}
