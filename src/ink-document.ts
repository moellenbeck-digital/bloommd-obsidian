/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ink/src/ink-document.ts by the BloomMD mirror sync.
 * Source SHA-256: 583177f80d033a15aa82869a161b1676f8219b08b202171a94f32983f00030db
 */
import {
  HIGHLIGHTER_OPACITY,
  MIN_STROKE_SIZE,
  clampStrokeSize,
  roundInk,
  simplifyPoints,
  strokeOutlinePath,
  strokesBounds,
  textBounds,
  textLines,
  unionBounds,
  INK_TEXT_LINE_HEIGHT,
  type InkBounds,
  type InkText,
  type InkPoint,
  type InkStroke,
} from "./ink-geometry";

export const INK_FORMAT = "bloommd-ink";
/**
 * Highest format version this plugin reads and writes. Version 2 added typed text and dark paper;
 * a reader treats a higher version as read-only, so older plugins never save over what they drop.
 */
export const INK_VERSION = 2;
export const INK_PAPER_COLOR = "#ffffff";
export const INK_DARK_COLOR = "#1c1c1e";

export type InkBackground = "paper" | "dark" | "transparent";

/** Background fill of the drawing, or null when it is transparent. */
export function inkBackgroundFill(background: InkBackground): string | null {
  if (background === "paper") return INK_PAPER_COLOR;
  if (background === "dark") return INK_DARK_COLOR;
  return null;
}
const INK_PADDING = 16;
const EMPTY_BOUNDS: InkBounds = { minX: 0, minY: 0, maxX: 320, maxY: 180 };

/** Links a group of strokes (e.g. the handwritten word "Arbeit") to an Obsidian note. */
export interface InkLink {
  id: string;
  /** Link text as it would appear inside [[…]], resolved by Obsidian relative to the source note. */
  target: string;
  /** Ids of the linked strokes and text boxes. */
  strokeIds: string[];
}

export interface InkDocument {
  format: typeof INK_FORMAT;
  version: number;
  background: InkBackground;
  strokes: InkStroke[];
  links: InkLink[];
  /** Typed text boxes; optional so drawings without text stay unchanged on disk. */
  texts?: InkText[];
}

export interface ParsedInk {
  document: InkDocument;
  /** Written by a newer plugin version: show it, but never overwrite what we do not understand. */
  readOnly: boolean;
}

export class InkFormatError extends Error {
  constructor(message: string) {
    super(`BloomMD ink: ${message}`);
    this.name = "InkFormatError";
  }
}

export function createInkDocument(background: InkBackground = "paper"): InkDocument {
  return { format: INK_FORMAT, version: INK_VERSION, background, strokes: [], links: [] };
}

/** Escaping `<`, `>` and `&` as JSON unicode escapes keeps the payload valid JSON and valid XML text. */
function jsonForXml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

export const INK_TEXT_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseText(value: unknown, index: number): InkText {
  if (!isRecord(value)) throw new InkFormatError(`text ${index} is not an object.`);
  const { id, x, y, text, size, color } = value;
  if (typeof id !== "string" || !id) throw new InkFormatError(`text ${index} has no id.`);
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) throw new InkFormatError(`text ${id} has no position.`);
  if (typeof text !== "string") throw new InkFormatError(`text ${id} has no text.`);
  if (!isFiniteNumber(size) || size <= 0) throw new InkFormatError(`text ${id} has an invalid size.`);
  if (typeof color !== "string") throw new InkFormatError(`text ${id} has no color.`);
  return { id, x, y, text, size, color };
}

function compactStroke(stroke: InkStroke): InkStroke {
  const points = simplifyPoints(stroke.points, 0.3).map(([x, y, pressure]): InkPoint => [roundInk(x), roundInk(y), roundInk(pressure)]);
  return { ...stroke, size: clampStrokeSize(stroke.size), points };
}

/** Bounds of everything drawn or written, or null for an empty drawing. */
export function inkContentBounds(document: InkDocument): InkBounds | null {
  return unionBounds([strokesBounds(document.strokes), ...(document.texts ?? []).map(textBounds)]);
}

export function inkViewBox(document: InkDocument): InkBounds {
  const bounds = inkContentBounds(document) ?? EMPTY_BOUNDS;
  return {
    minX: Math.floor(bounds.minX - INK_PADDING),
    minY: Math.floor(bounds.minY - INK_PADDING),
    maxX: Math.ceil(bounds.maxX + INK_PADDING),
    maxY: Math.ceil(bounds.maxY + INK_PADDING),
  };
}

/**
 * Serializes a drawing as a standalone SVG. Obsidian renders it natively as an image embed, while
 * the editable stroke data travels inside <metadata> so the plugin can reopen it losslessly.
 */
export function serializeInkSvg(document: InkDocument): string {
  const texts = (document.texts ?? []).filter((text) => text.text.trim()).map((text) => ({ ...text, x: roundInk(text.x), y: roundInk(text.y), size: roundInk(text.size) }));
  const { texts: _texts, ...rest } = document;
  const compact: InkDocument = {
    ...rest,
    // Drawings without version 2 features stay version 1, so older plugins can still edit them.
    version: texts.length > 0 || document.background === "dark" ? 2 : 1,
    strokes: document.strokes.filter((stroke) => stroke.points.length > 0).map(compactStroke),
    ...(texts.length > 0 ? { texts } : {}),
  };
  const box = inkViewBox(compact);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.minX} ${box.minY} ${width} ${height}" width="${width}" height="${height}" data-bloommd-ink="${compact.version}">`,
    `<metadata id="bloommd-ink">${jsonForXml(compact)}</metadata>`,
  ];
  const fill = inkBackgroundFill(compact.background);
  if (fill) {
    lines.push(`<rect x="${box.minX}" y="${box.minY}" width="${width}" height="${height}" fill="${fill}"/>`);
  }
  for (const stroke of compact.strokes) {
    const path = strokeOutlinePath(stroke);
    if (!path) continue;
    const opacity = stroke.tool === "highlighter" ? ` fill-opacity="${HIGHLIGHTER_OPACITY}"` : "";
    lines.push(`<path data-stroke-id="${escapeAttribute(stroke.id)}" d="${path}" fill="${escapeAttribute(stroke.color)}"${opacity}/>`);
  }
  for (const text of compact.texts ?? []) {
    // Real <text> keeps typed words readable and searchable wherever the SVG is shown.
    const spans = textLines(text)
      .map((line, index) => `<tspan x="${text.x}" dy="${index === 0 ? text.size : roundInk(text.size * INK_TEXT_LINE_HEIGHT)}">${escapeText(line)}</tspan>`)
      .join("");
    lines.push(`<text data-text-id="${escapeAttribute(text.id)}" x="${text.x}" y="${text.y}" font-size="${text.size}" font-family="${INK_TEXT_FONT}" fill="${escapeAttribute(text.color)}">${spans}</text>`);
  }
  lines.push("</svg>");
  return `${lines.join("\n")}\n`;
}

export function isInkSvg(svg: string): boolean {
  return /<svg\b[^>]*\bdata-bloommd-ink="/.test(svg);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const FALLBACK_COLOR = "#1f2937";

/**
 * `lenient` is set for files from a newer plugin version: they open read-only, so a tool or colour
 * this version does not know is shown as a plain pen stroke instead of rejecting the whole drawing.
 */
function parseStroke(value: unknown, index: number, lenient: boolean): InkStroke {
  if (!isRecord(value)) throw new InkFormatError(`stroke ${index} is not an object.`);
  const { id, tool, color, size, points, simulatePressure } = value;
  if (typeof id !== "string" || !id) throw new InkFormatError(`stroke ${index} has no id.`);
  const knownTool = tool === "pen" || tool === "highlighter";
  if (!knownTool && !lenient) throw new InkFormatError(`stroke ${id} has an unknown tool.`);
  if (typeof color !== "string" && !lenient) throw new InkFormatError(`stroke ${id} has no color.`);
  if (!isFiniteNumber(size) && !lenient) throw new InkFormatError(`stroke ${id} has an invalid size.`);
  if (!Array.isArray(points)) throw new InkFormatError(`stroke ${id} has no points.`);
  const parsedPoints = points.map((point, pointIndex): InkPoint => {
    if (!Array.isArray(point) || point.length < 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) {
      throw new InkFormatError(`stroke ${id} point ${pointIndex} is invalid.`);
    }
    return [point[0], point[1], isFiniteNumber(point[2]) ? point[2] : 0.5];
  });
  return {
    id,
    tool: knownTool ? tool : "pen",
    color: typeof color === "string" ? color : FALLBACK_COLOR,
    // Tiny or zero widths come from repeated downscaling; clamping keeps such drawings editable.
    size: isFiniteNumber(size) ? Math.max(MIN_STROKE_SIZE, size) : MIN_STROKE_SIZE,
    points: parsedPoints,
    ...(simulatePressure === true ? { simulatePressure: true } : {}),
  };
}

function parseLink(value: unknown, index: number): InkLink {
  if (!isRecord(value)) throw new InkFormatError(`link ${index} is not an object.`);
  const { id, target, strokeIds } = value;
  if (typeof id !== "string" || !id) throw new InkFormatError(`link ${index} has no id.`);
  if (typeof target !== "string" || !target.trim()) throw new InkFormatError(`link ${id} has no target.`);
  if (!Array.isArray(strokeIds) || !strokeIds.every((strokeId) => typeof strokeId === "string")) {
    throw new InkFormatError(`link ${id} has invalid stroke ids.`);
  }
  return { id, target, strokeIds: strokeIds as string[] };
}

/**
 * Reads the editable drawing from an SVG. Returns `null` for ordinary SVGs that were not written by
 * BloomMD, and throws `InkFormatError` for BloomMD ink whose data is damaged, so callers never mistake
 * a broken drawing for an empty one and overwrite it.
 */
export function parseInkSvg(svg: string): ParsedInk | null {
  if (!isInkSvg(svg)) return null;
  const match = /<metadata id="bloommd-ink">([\s\S]*?)<\/metadata>/.exec(svg);
  if (!match) throw new InkFormatError("the drawing data is missing.");
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]!.trim());
  } catch (error) {
    throw new InkFormatError(`the drawing data is not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (!isRecord(raw) || raw.format !== INK_FORMAT) throw new InkFormatError("the drawing data has an unknown format.");
  if (!isFiniteNumber(raw.version) || raw.version < 1) throw new InkFormatError("the drawing data has no valid version.");
  if (!Array.isArray(raw.strokes)) throw new InkFormatError("the drawing has no stroke list.");
  const newer = raw.version > INK_VERSION;
  const strokes = raw.strokes.map((stroke, index) => parseStroke(stroke, index, newer));
  const links = Array.isArray(raw.links) ? raw.links.map(parseLink) : [];
  const texts = Array.isArray(raw.texts) ? raw.texts.map(parseText) : [];
  return {
    document: {
      format: INK_FORMAT,
      version: INK_VERSION,
      background: raw.background === "transparent" || raw.background === "dark" ? raw.background : "paper",
      strokes,
      links,
      ...(texts.length > 0 ? { texts } : {}),
    },
    readOnly: newer,
  };
}

/** True when a `[[link]]` target written relative to anywhere in the vault points at `notePath`. */
export function linkTargetsPath(target: string, notePath: string): boolean {
  const withoutHeading = target.split("#")[0]!.trim();
  const normalized = withoutHeading.replace(/\.md$/i, "");
  const path = notePath.replace(/\.md$/i, "");
  return normalized === path || path.endsWith(`/${normalized}`);
}

/**
 * Rewrites links after a note was renamed or moved; Obsidian only updates `[[…]]` in Markdown, so
 * drawings are kept in step here. Returns the same document when no link pointed at the old path.
 *
 * `resolve` looks a link up in the vault after the rename. A link that still resolves to an existing
 * note (e.g. another note with the same name in a different folder) was never pointing at the renamed
 * one and is left alone.
 */
export function retargetInkLinks(document: InkDocument, oldPath: string, linktext: string, resolve?: (target: string) => string | null): InkDocument {
  let changed = false;
  const links = document.links.map((link) => {
    if (!linkTargetsPath(link.target, oldPath)) return link;
    if (resolve && resolve(link.target.split("#")[0]!.trim()) !== null) return link;
    changed = true;
    const heading = link.target.includes("#") ? link.target.slice(link.target.indexOf("#")) : "";
    return { ...link, target: `${linktext}${heading}` };
  });
  return changed ? { ...document, links } : document;
}
