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
