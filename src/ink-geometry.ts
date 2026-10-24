/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ink/src/ink-geometry.ts by the BloomMD mirror sync.
 * Source SHA-256: 2db2e18923db576e4f779b74774ac50676db033286164fc7d4d466fa5a9c5669
 */
import { getStroke } from "perfect-freehand";

/** A sampled pen position in world coordinates: x, y and normalized pressure (0..1). */
export type InkPoint = [x: number, y: number, pressure: number];

export type InkTool = "pen" | "highlighter";

export interface InkStroke {
  id: string;
  tool: InkTool;
  color: string;
  size: number;
  points: InkPoint[];
  /** Mouse and finger input have no real pressure; perfect-freehand then derives it from speed. */
  simulatePressure?: boolean;
}

export interface InkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface InkTransform {
  dx: number;
  dy: number;
  scale: number;
  /** Scaling happens around this world point before the translation is applied. */
  originX: number;
  originY: number;
}

export const HIGHLIGHTER_OPACITY = 0.35;

export function roundInk(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Smallest stroke width kept in a drawing. Two-decimal rounding would otherwise shrink a repeatedly
 * downscaled stroke to 0, which the file format rejects as damaged.
 */
export const MIN_STROKE_SIZE = 0.05;

export function clampStrokeSize(size: number): number {
  return Math.max(MIN_STROKE_SIZE, roundInk(size));
}

export function strokeBounds(stroke: InkStroke): InkBounds | null {
  if (stroke.points.length === 0) return null;
  const radius = stroke.size / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of stroke.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX: minX - radius, minY: minY - radius, maxX: maxX + radius, maxY: maxY + radius };
}

export function unionBounds(bounds: Array<InkBounds | null>): InkBounds | null {
  let result: InkBounds | null = null;
  for (const entry of bounds) {
    if (!entry) continue;
    result = result
      ? {
          minX: Math.min(result.minX, entry.minX),
          minY: Math.min(result.minY, entry.minY),
          maxX: Math.max(result.maxX, entry.maxX),
          maxY: Math.max(result.maxY, entry.maxY),
        }
      : { ...entry };
  }
  return result;
}

export function strokesBounds(strokes: InkStroke[]): InkBounds | null {
  return unionBounds(strokes.map(strokeBounds));
}

/** Ray casting; the polygon is implicitly closed. */
export function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True when a circle of `tolerance` around (x, y) touches the stroke's centre line widened by its size. */
export function strokeHitsPoint(stroke: InkStroke, x: number, y: number, tolerance: number): boolean {
  const reach = stroke.size / 2 + tolerance;
  const points = stroke.points;
  if (points.length === 1) return Math.hypot(points[0]![0] - x, points[0]![1] - y) <= reach;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1]!;
    const [bx, by] = points[index]!;
    if (distanceToSegment(x, y, ax, ay, bx, by) <= reach) return true;
  }
  return false;
}

/** A stroke counts as lassoed when most of its sampled points lie inside the lasso polygon. */
export function strokeInLasso(stroke: InkStroke, polygon: Array<[number, number]>): boolean {
  if (polygon.length < 3 || stroke.points.length === 0) return false;
  const inside = stroke.points.filter(([x, y]) => pointInPolygon(x, y, polygon)).length;
  return inside / stroke.points.length > 0.5;
}

export function transformStroke(stroke: InkStroke, transform: InkTransform): InkStroke {
  const { dx, dy, scale, originX, originY } = transform;
  return {
    ...stroke,
    size: clampStrokeSize(stroke.size * scale),
    points: stroke.points.map(([x, y, pressure]) => [
      roundInk(originX + (x - originX) * scale + dx),
      roundInk(originY + (y - originY) * scale + dy),
      pressure,
    ]),
  };
}

/** Ramer–Douglas–Peucker simplification; keeps first/last point and the pressure of kept samples. */
export function simplifyPoints(points: InkPoint[], epsilon: number): InkPoint[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = points[start]!;
    const [bx, by] = points[end]!;
    let maxDistance = 0;
    let maxIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const [px, py] = points[index]!;
      const distance = distanceToSegment(px, py, ax, ay, bx, by);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxIndex >= 0 && maxDistance > epsilon) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

/** Closed SVG path of the stroke outline; highlighters use a constant width like a marker. */
export function strokeOutlinePath(stroke: InkStroke): string {
  const highlighter = stroke.tool === "highlighter";
  const outline = getStroke(stroke.points, {
    size: stroke.size,
    thinning: highlighter ? 0 : 0.6,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !highlighter && Boolean(stroke.simulatePressure),
    last: true,
    start: { cap: !highlighter },
    end: { cap: !highlighter },
  });
  if (outline.length === 0) return "";
  const [first, ...rest] = outline;
  let path = `M${roundInk(first![0])} ${roundInk(first![1])}`;
  // Quadratic segments through midpoints give a smooth outline with few path commands.
  for (let index = 0; index < rest.length; index += 1) {
    const [x0, y0] = rest[index]!;
    const [x1, y1] = rest[index + 1] ?? first!;
    path += `Q${roundInk(x0)} ${roundInk(y0)} ${roundInk((x0 + x1) / 2)} ${roundInk((y0 + y1) / 2)}`;
  }
  return `${path}Z`;
}

export interface InkViewport {
  x: number;
  y: number;
  zoom: number;
}

export function screenToWorld(viewport: InkViewport, screenX: number, screenY: number): [number, number] {
  return [(screenX - viewport.x) / viewport.zoom, (screenY - viewport.y) / viewport.zoom];
}

export function worldToScreen(viewport: InkViewport, worldX: number, worldY: number): [number, number] {
  return [worldX * viewport.zoom + viewport.x, worldY * viewport.zoom + viewport.y];
}

/** Zoom by `factor` while keeping the world point under (screenX, screenY) fixed. */
export function zoomViewportAt(viewport: InkViewport, screenX: number, screenY: number, factor: number, minZoom = 0.2, maxZoom = 6): InkViewport {
  const zoom = Math.min(maxZoom, Math.max(minZoom, viewport.zoom * factor));
  const [worldX, worldY] = screenToWorld(viewport, screenX, screenY);
  return { zoom, x: screenX - worldX * zoom, y: screenY - worldY * zoom };
}

/**
 * Proportional scale factor for dragging a selection corner: the pointer is projected onto the
 * diagonal from the fixed opposite corner (`anchor`) to where the drag started.
 */
export function handleScale(anchor: [number, number], start: [number, number], current: [number, number], minScale = 0.05): number {
  const dx = start[0] - anchor[0];
  const dy = start[1] - anchor[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 1;
  const projected = ((current[0] - anchor[0]) * dx + (current[1] - anchor[1]) * dy) / lengthSquared;
  return Math.max(minScale, projected);
}

/** Typed text placed on a drawing, e.g. handwriting converted by iPadOS Scribble. */
export interface InkText {
  id: string;
  /** Top-left corner in world coordinates. */
  x: number;
  y: number;
  text: string;
  /** Font size in world units. */
  size: number;
  color: string;
}

export const INK_TEXT_LINE_HEIGHT = 1.25;
/** Average glyph width relative to the font size; exact metrics differ per device font. */
const INK_TEXT_CHAR_WIDTH = 0.56;

export function textLines(text: InkText): string[] {
  return text.text.split(/\r?\n/);
}

export function textBounds(text: InkText): InkBounds {
  const lines = textLines(text);
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return {
    minX: text.x,
    minY: text.y,
    maxX: text.x + longest * text.size * INK_TEXT_CHAR_WIDTH,
    maxY: text.y + lines.length * text.size * INK_TEXT_LINE_HEIGHT,
  };
}

export function textHitsPoint(text: InkText, x: number, y: number, tolerance: number): boolean {
  const box = textBounds(text);
  return x >= box.minX - tolerance && x <= box.maxX + tolerance && y >= box.minY - tolerance && y <= box.maxY + tolerance;
}

export function textInLasso(text: InkText, polygon: Array<[number, number]>): boolean {
  const box = textBounds(text);
  return polygon.length >= 3 && pointInPolygon((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, polygon);
}

export function transformText(text: InkText, transform: InkTransform): InkText {
  const { dx, dy, scale, originX, originY } = transform;
  return {
    ...text,
    x: roundInk(originX + (text.x - originX) * scale + dx),
    y: roundInk(originY + (text.y - originY) * scale + dy),
    size: roundInk(text.size * scale),
  };
}
