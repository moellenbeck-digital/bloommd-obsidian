/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ink/src/pen-gestures.ts by the BloomMD mirror sync.
 * Source SHA-256: 177f0bcf121cc35da5096d7b358d1c5b3cf75b16ccabaef9d94e8c627c878367
 */
/**
 * Pen gestures on the map (draw mode): the Apple Pencil operates the whole concept map, so writing,
 * connecting, branching, erasing and selecting never need a tool switch.
 */

export interface GestureNodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Point = [number, number, ...number[]];

/** A pen held still this long on a node picks the node up (drag) or opens its menu on release. */
export const PEN_HOLD_MS = 450;
/** Screen distance a held pen may wobble and still count as holding still. */
export const PEN_HOLD_SLOP = 8;
/** Two taps on the same node within this time open it. */
export const DOUBLE_TAP_MS = 350;
/** A touch that landed this shortly before the pen is taken for the writing hand. */
export const PALM_WINDOW_MS = 600;
/** Fingers are ignored this long after the pen lifts; the writing hand is still resting. */
export const PEN_COOLDOWN_MS = 400;

const TAP_DISTANCE = 8;
const TAP_DURATION_MS = 350;
const BRANCH_MIN_LENGTH = 80;
const BRANCH_MAX_WIGGLE = 1.35;
/** Screen distance inside a node's border where a branch stroke may start. */
const BRANCH_EDGE_BAND = 16;
/** A connection must start and end at least this far (screen) inside its nodes. */
const CONNECT_INSET = 4;
/** A mostly horizontal stroke that runs along this share of a node's width strikes through or underlines its title. */
const TITLE_STRIKE_SHARE = 0.7;
/** Rise over run below which a stroke counts as mostly horizontal. */
const HORIZONTAL_SLOPE = 0.35;
const SCRATCH_MIN_REVERSALS = 4;
/** Share of a stroke's points that must lie inside a scratch-out's box for it to be erased. */
const SCRATCH_COVERAGE = 0.5;

export function nodeAt(nodes: GestureNodeBox[], x: number, y: number): GestureNodeBox | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) return node;
  }
  return null;
}

function inside(node: GestureNodeBox, x: number, y: number, inset: number): boolean {
  return x >= node.x + inset && x <= node.x + node.width - inset && y >= node.y + inset && y <= node.y + node.height - inset;
}

/**
 * The node whose inner rim (within `reach` of its border) holds a point. A branch is drawn out of a
 * node from its edge; a stroke starting deep inside is writing on the node, and one starting next
 * to it is handwriting on the map.
 */
export function nodeEdgeAt(nodes: GestureNodeBox[], x: number, y: number, reach: number): GestureNodeBox | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (inside(node, x, y, 0)) return inside(node, x, y, reach) ? null : node;
  }
  return null;
}

/** Path length from the start until the stroke first leaves `node`; Infinity when it never does. */
function runInside(points: Point[], node: GestureNodeBox): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    if (!inside(node, point[0], point[1], 0)) return length;
    length += Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]);
  }
  return Infinity;
}

/** A mostly horizontal stroke running along most of a node's width: a strike-through or underline. */
function strikesThrough(points: Point[], node: GestureNodeBox): boolean {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.abs(last[1] - first[1]) > Math.abs(last[0] - first[0]) * HORIZONTAL_SLOPE) return false;
  const xs = points.map((point) => point[0]);
  const overlap = Math.min(Math.max(...xs), node.x + node.width) - Math.max(Math.min(...xs), node.x);
  return overlap >= node.width * TITLE_STRIKE_SHARE;
}

function pathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  }
  return length;
}

/** Direction changes along one axis, ignoring jitter below `minLeg`. */
function reversals(points: Point[], axis: 0 | 1, minLeg: number): number {
  let count = 0;
  let direction = 0;
  let anchor = points[0]?.[axis] ?? 0;
  for (const point of points) {
    const delta = point[axis] - anchor;
    if (Math.abs(delta) < minLeg) {
      // Keep following the current leg so a long leg is not split by small pauses.
      if (direction !== 0 && Math.sign(delta) === direction) anchor = point[axis];
      continue;
    }
    const sign = Math.sign(delta);
    if (direction !== 0 && sign !== direction) count += 1;
    direction = sign;
    anchor = point[axis];
  }
  return count;
}

/**
 * A quick zigzag, the paper way of crossing something out. Needs several back-and-forth legs that
 * each cover a good part of the scribble's width, so ordinary handwriting (m, w, n) does not count.
 */
export function isScratchOut(points: Point[], zoom = 1): boolean {
  if (points.length < 6) return false;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const span = Math.max(width, height);
  if (span * zoom < 24) return false;
  const axis: 0 | 1 = width >= height ? 0 : 1;
  const minLeg = Math.max(4 / zoom, (axis === 0 ? width : height) * 0.4);
  return reversals(points, axis, minLeg) >= SCRATCH_MIN_REVERSALS && pathLength(points) >= span * 3.5;
}

/**
 * Strokes a scratch-out crosses out: those lying mostly inside its bounding box. Highlighter marks a
 * scratch merely crosses stay, so shading over a highlighted passage does not wipe it.
 */
export function strokesUnderScratch(
  scratch: Point[],
  strokes: Array<{ id: string; tool: string; points: Point[] }>,
  tolerance = 0,
): string[] {
  if (scratch.length === 0) return [];
  const xs = scratch.map((point) => point[0]);
  const ys = scratch.map((point) => point[1]);
  const minX = Math.min(...xs) - tolerance;
  const maxX = Math.max(...xs) + tolerance;
  const minY = Math.min(...ys) - tolerance;
  const maxY = Math.max(...ys) + tolerance;
  return strokes.filter((stroke) => {
    if (stroke.tool === "highlighter" || stroke.points.length === 0) return false;
    const covered = stroke.points.filter(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY).length;
    return covered / stroke.points.length >= SCRATCH_COVERAGE;
  }).map((stroke) => stroke.id);
}

export type PenStrokeGesture =
  | { kind: "tap"; node: string | null }
  | { kind: "connect"; source: string; target: string }
  | { kind: "branch"; source: string; end: [number, number] }
  | { kind: "scratch" }
  | { kind: "ink" };

/**
 * What a finished pen stroke on the map means. Points are in map coordinates; `zoom` converts them
 * to screen distances so gestures feel the same at every zoom level.
 */
export function classifyPenStroke(points: Point[], nodes: GestureNodeBox[], zoom: number, durationMs: number): PenStrokeGesture {
  if (points.length === 0) return { kind: "ink" };
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const start = nodeAt(nodes, first[0], first[1]);
  const end = nodeAt(nodes, last[0], last[1]);
  const length = pathLength(points);
  // On a node a short touch is a tap however long it rests, until it becomes a hold; on empty map a
  // slow one is the dot on an i.
  if (length * zoom < TAP_DISTANCE && (durationMs < TAP_DURATION_MS || (start && durationMs < PEN_HOLD_MS))) return { kind: "tap", node: start?.id ?? null };
  if (isScratchOut(points, zoom)) return { kind: "scratch" };
  const inset = CONNECT_INSET / zoom;
  if (start && end && start.id !== end.id) {
    // Clearly from one node into another, not a line through a title that happens to end on a neighbour.
    const clear = inside(start, first[0], first[1], inset) && inside(end, last[0], last[1], inset);
    if (clear && !strikesThrough(points, start) && !strikesThrough(points, end)) return { kind: "connect", source: start.id, target: end.id };
    return { kind: "ink" };
  }
  if (!end) {
    // A branch is pulled out of a node from its edge and leaves it right away; a line that starts in
    // the middle of a node or runs along it is writing (striking through, underlining).
    const reach = BRANCH_EDGE_BAND / zoom;
    const source = nodeEdgeAt(nodes, first[0], first[1], reach);
    const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
    const leaves = source ? runInside(points, source) : Infinity;
    if (source && leaves <= reach * 1.5 && chord * zoom >= BRANCH_MIN_LENGTH && length <= chord * BRANCH_MAX_WIGGLE) {
      return { kind: "branch", source: source.id, end: [last[0], last[1]] };
    }
  }
  return { kind: "ink" };
}

/**
 * Tracks the finger touches around a pen stroke so a resting hand never moves the map: touches
 * already down when the pen lands, touches that start while it writes and touches right after it
 * lifts stay blocked until they end.
 */
export class PalmGuard {
  private readonly active = new Set<number>();
  private readonly blocked = new Set<number>();
  private firstTouchAt = -Infinity;
  private penIsDown = false;
  private penPointer: number | null = null;
  private penLiftedAt = -Infinity;

  /** A finger touch started. Returns true when it must not move the map. */
  touchStart(id: number, now: number): boolean {
    if (this.active.size === 0) this.firstTouchAt = now;
    this.active.add(id);
    if (this.blocksNewTouch(now)) {
      this.blocked.add(id);
      return true;
    }
    return false;
  }

  /** Whether a finger landing now is taken for the writing hand (pen down or only just lifted). */
  blocksNewTouch(now: number): boolean {
    return this.penIsDown || now - this.penLiftedAt < PEN_COOLDOWN_MS;
  }

  /** Returns true when a move of these touches must not reach the map. */
  touchMove(ids: Iterable<number>): boolean {
    if (this.penIsDown) return true;
    for (const id of ids) if (this.blocked.has(id)) return true;
    return false;
  }

  touchEnd(id: number): void {
    this.active.delete(id);
    this.blocked.delete(id);
  }

  /**
   * The pen touched down. Every finger still on the glass is taken for the writing hand. Returns
   * true when that hand started panning only moments ago, so the caller should undo that pan.
   */
  penDown(now: number, pointerId?: number): boolean {
    this.penIsDown = true;
    this.penPointer = pointerId ?? null;
    for (const id of this.active) this.blocked.add(id);
    return this.active.size > 0 && now - this.firstTouchAt < PALM_WINDOW_MS;
  }

  /**
   * The pen lifted. Ignored unless it is the pen that touched down: a hovering Apple Pencil (iPad Pro
   * M2 and later) sends pen pointer events without ever touching, and those must not start the
   * finger cooldown.
   */
  penUp(now: number, pointerId?: number): void {
    if (!this.penIsDown) return;
    if (pointerId !== undefined && this.penPointer !== null && pointerId !== this.penPointer) return;
    this.penIsDown = false;
    this.penPointer = null;
    this.penLiftedAt = now;
  }

  /** Number of finger touches currently on the glass. */
  get touching(): number {
    return this.active.size;
  }

  get penActive(): boolean {
    return this.penIsDown;
  }

  isBlocked(id: number): boolean {
    return this.blocked.has(id);
  }
}
