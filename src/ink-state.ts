/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ink/src/ink-state.ts by the BloomMD mirror sync.
 * Source SHA-256: cb8b23b970bc13bf95696c519e66bd0591e99fac807d3f49b5201534facc4719
 */
import type { InkBackground, InkDocument, InkLink } from "./ink-document";
import {
  strokeHitsPoint,
  strokesBounds,
  textBounds,
  textHitsPoint,
  transformStroke,
  transformText,
  unionBounds,
  type InkBounds,
  type InkStroke,
  type InkText,
  type InkTool,
  type InkTransform,
} from "./ink-geometry";

export type InkEditorTool = InkTool | "eraser" | "lasso" | "text";
export type InkSize = "fine" | "medium" | "bold";

export const INK_COLORS = ["#1f2937", "#2563eb", "#dc2626", "#16a34a", "#facc15"] as const;
/** The same five colors tuned for dark paper; index i corresponds to INK_COLORS[i]. */
export const INK_DARK_COLORS = ["#f3f4f6", "#60a5fa", "#f87171", "#4ade80", "#facc15"] as const;

export function inkPalette(background: InkBackground): readonly string[] {
  return background === "dark" ? INK_DARK_COLORS : INK_COLORS;
}

/** Maps a palette color to its counterpart on the other paper so black ink stays readable. */
export function adaptColor(color: string, from: InkBackground, to: InkBackground): string {
  const index = inkPalette(from).indexOf(color);
  return index >= 0 ? inkPalette(to)[index]! : color;
}

const STROKE_SIZES: Record<InkTool, Record<InkSize, number>> = {
  pen: { fine: 2, medium: 3.5, bold: 6 },
  highlighter: { fine: 12, medium: 18, bold: 26 },
};

const HISTORY_LIMIT = 100;

export interface InkEditorState {
  document: InkDocument;
  past: InkDocument[];
  future: InkDocument[];
  tool: InkEditorTool;
  colors: Record<InkTool, string>;
  size: InkSize;
  /** Lets devices without a stylus draw with a finger. Ignored once a pen was used (palm rejection). */
  drawWithFinger: boolean;
  penDetected: boolean;
  readOnly: boolean;
  /** Stroke ids picked with the lasso; only meaningful while the lasso tool is active. */
  selection: string[];
}

export type InkEditorAction =
  | { type: "load"; document: InkDocument; readOnly: boolean }
  | { type: "setTool"; tool: InkEditorTool }
  | { type: "setColor"; color: string }
  | { type: "setSize"; size: InkSize }
  | { type: "setDrawWithFinger"; enabled: boolean }
  | { type: "setBackground"; background: InkBackground }
  | { type: "penDetected" }
  | { type: "commitStroke"; stroke: InkStroke }
  | { type: "eraseStrokes"; strokeIds: string[] }
  | { type: "upsertText"; text: InkText }
  | { type: "select"; strokeIds: string[] }
  | { type: "transformSelection"; transform: InkTransform }
  /** `ids` deletes those items (captured earlier) instead of whatever is selected now. */
  | { type: "deleteSelection"; ids?: string[] }
  | { type: "linkSelection"; linkId: string; target: string }
  | { type: "unlink"; linkId: string }
  | { type: "undo" }
  | { type: "redo" };

export function createInkEditorState(document: InkDocument, readOnly = false): InkEditorState {
  const palette = inkPalette(document.background);
  return {
    document,
    past: [],
    future: [],
    tool: "pen",
    colors: { pen: palette[0]!, highlighter: palette[4]! },
    size: "medium",
    drawWithFinger: false,
    penDetected: false,
    readOnly,
    selection: [],
  };
}

export function strokeSize(tool: InkTool, size: InkSize): number {
  return STROKE_SIZES[tool][size];
}

export function activeColor(state: InkEditorState): string {
  return state.colors[state.tool === "highlighter" ? "highlighter" : "pen"];
}

/** Every document change goes through here so it becomes exactly one undo step. */
function commit(state: InkEditorState, document: InkDocument): InkEditorState {
  if (state.readOnly || document === state.document) return state;
  return {
    ...state,
    document,
    past: [...state.past, state.document].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** Bounds of the given strokes and text boxes (ids may refer to either). */
export function itemsBounds(document: InkDocument, ids: Iterable<string>): InkBounds | null {
  const selected = new Set(ids);
  return unionBounds([
    strokesBounds(document.strokes.filter((stroke) => selected.has(stroke.id))),
    ...(document.texts ?? []).filter((text) => selected.has(text.id)).map(textBounds),
  ]);
}

export function selectionBounds(state: InkEditorState): InkBounds | null {
  return state.selection.length === 0 ? null : itemsBounds(state.document, state.selection);
}

function itemIds(document: InkDocument): Set<string> {
  return new Set([...document.strokes.map((stroke) => stroke.id), ...(document.texts ?? []).map((text) => text.id)]);
}

/** Undo/redo may remove selected strokes; the selection keeps only strokes that still exist. */
function keepExistingSelection(state: InkEditorState): InkEditorState {
  if (state.selection.length === 0) return state;
  const ids = itemIds(state.document);
  const selection = state.selection.filter((id) => ids.has(id));
  return selection.length === state.selection.length ? state : { ...state, selection };
}

function mapSelected(state: InkEditorState, update: (stroke: InkStroke) => InkStroke, updateText: (text: InkText) => InkText): InkDocument {
  const selected = new Set(state.selection);
  return {
    ...state.document,
    strokes: state.document.strokes.map((stroke) => (selected.has(stroke.id) ? update(stroke) : stroke)),
    ...(state.document.texts ? { texts: state.document.texts.map((text) => (selected.has(text.id) ? updateText(text) : text)) } : {}),
  };
}

export function linkBounds(document: InkDocument, link: InkLink): InkBounds | null {
  return itemsBounds(document, link.strokeIds);
}

/** Links that point at removed strokes lose them; links without strokes disappear. */
export function pruneLinks(document: InkDocument): InkDocument {
  const ids = itemIds(document);
  const links = document.links
    .map((link) => ({ ...link, strokeIds: link.strokeIds.filter((id) => ids.has(id)) }))
    .filter((link) => link.strokeIds.length > 0);
  const unchanged = links.length === document.links.length
    && links.every((link, index) => link.strokeIds.length === document.links[index]!.strokeIds.length);
  return unchanged ? document : { ...document, links };
}

export function inkEditorReducer(state: InkEditorState, action: InkEditorAction): InkEditorState {
  switch (action.type) {
    case "load":
      return { ...createInkEditorState(action.document, action.readOnly), tool: state.tool, colors: state.colors, size: state.size, drawWithFinger: state.drawWithFinger, penDetected: state.penDetected };
    case "setTool":
      return { ...state, tool: action.tool, selection: action.tool === "lasso" ? state.selection : [] };
    case "setColor": {
      if (state.tool === "lasso" && state.selection.length > 0) {
        return commit(state, mapSelected(state, (stroke) => ({ ...stroke, color: action.color }), (text) => ({ ...text, color: action.color })));
      }
      const tool: InkTool = state.tool === "highlighter" ? "highlighter" : "pen";
      return { ...state, colors: { ...state.colors, [tool]: action.color } };
    }
    case "setSize":
      return { ...state, size: action.size };
    case "setDrawWithFinger":
      return { ...state, drawWithFinger: action.enabled };
    case "setBackground": {
      const from = state.document.background;
      const to = action.background;
      if (from === to) return state;
      // Switching between light and dark paper swaps palette colors so ink keeps its contrast.
      const strokes = state.document.strokes.map((stroke) => {
        const color = adaptColor(stroke.color, from, to);
        return color === stroke.color ? stroke : { ...stroke, color };
      });
      const next = commit(state, { ...state.document, background: to, strokes });
      return {
        ...next,
        colors: { pen: adaptColor(state.colors.pen, from, to), highlighter: adaptColor(state.colors.highlighter, from, to) },
      };
    }
    case "penDetected":
      return state.penDetected ? state : { ...state, penDetected: true };
    case "commitStroke":
      if (action.stroke.points.length === 0) return state;
      return commit(state, { ...state.document, strokes: [...state.document.strokes, action.stroke] });
    case "eraseStrokes": {
      const erase = new Set(action.strokeIds);
      const strokes = state.document.strokes.filter((stroke) => !erase.has(stroke.id));
      const texts = state.document.texts?.filter((text) => !erase.has(text.id));
      if (strokes.length === state.document.strokes.length && (texts?.length ?? 0) === (state.document.texts?.length ?? 0)) return state;
      return commit(state, pruneLinks({ ...state.document, strokes, ...(texts ? { texts } : {}) }));
    }
    case "upsertText": {
      const existing = state.document.texts ?? [];
      const index = existing.findIndex((text) => text.id === action.text.id);
      // An emptied text box disappears, like a blank Freeform text field.
      if (!action.text.text.trim()) {
        return index < 0 ? state : commit(state, pruneLinks({ ...state.document, texts: existing.filter((text) => text.id !== action.text.id) }));
      }
      if (index >= 0 && JSON.stringify(existing[index]) === JSON.stringify(action.text)) return state;
      const texts = index >= 0 ? existing.map((text) => (text.id === action.text.id ? action.text : text)) : [...existing, action.text];
      return commit(state, { ...state.document, texts });
    }
    case "select": {
      const ids = itemIds(state.document);
      return { ...state, selection: action.strokeIds.filter((id) => ids.has(id)) };
    }
    case "transformSelection": {
      const { dx, dy, scale } = action.transform;
      if (state.selection.length === 0 || (dx === 0 && dy === 0 && scale === 1)) return state;
      return commit(state, mapSelected(state, (stroke) => transformStroke(stroke, action.transform), (text) => transformText(text, action.transform)));
    }
    case "deleteSelection": {
      const ids = action.ids ?? state.selection;
      if (ids.length === 0) return state;
      const erased = inkEditorReducer(state, { type: "eraseStrokes", strokeIds: ids });
      const removed = new Set(ids);
      return { ...erased, selection: state.selection.filter((id) => !removed.has(id)) };
    }
    case "linkSelection": {
      const target = action.target.trim();
      if (state.selection.length === 0 || !target) return state;
      // A stroke belongs to at most one link: relinking a word replaces its previous target.
      const selected = new Set(state.selection);
      const others = state.document.links
        .map((link) => ({ ...link, strokeIds: link.strokeIds.filter((id) => !selected.has(id)) }))
        .filter((link) => link.strokeIds.length > 0);
      return commit(state, { ...state.document, links: [...others, { id: action.linkId, target, strokeIds: [...state.selection] }] });
    }
    case "unlink": {
      const links = state.document.links.filter((link) => link.id !== action.linkId);
      return links.length === state.document.links.length ? state : commit(state, { ...state.document, links });
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous || state.readOnly) return state;
      return keepExistingSelection({ ...state, document: previous, past: state.past.slice(0, -1), future: [state.document, ...state.future] });
    }
    case "redo": {
      const next = state.future[0];
      if (!next || state.readOnly) return state;
      return keepExistingSelection({ ...state, document: next, past: [...state.past, state.document], future: state.future.slice(1) });
    }
  }
}

/** Strokes touched by the eraser at a world position; used live while the eraser is dragged. */
export function strokesHitAt(strokes: InkStroke[], x: number, y: number, tolerance: number): string[] {
  return strokes.filter((stroke) => strokeHitsPoint(stroke, x, y, tolerance)).map((stroke) => stroke.id);
}

/** Strokes and text boxes under the eraser. */
export function itemsHitAt(document: InkDocument, x: number, y: number, tolerance: number): string[] {
  return [
    ...strokesHitAt(document.strokes, x, y, tolerance),
    ...(document.texts ?? []).filter((text) => textHitsPoint(text, x, y, tolerance)).map((text) => text.id),
  ];
}

/** The topmost text box at a world position, for tapping into existing text. */
export function textAt(document: InkDocument, x: number, y: number): InkText | null {
  const texts = document.texts ?? [];
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    if (textHitsPoint(texts[index]!, x, y, 4)) return texts[index]!;
  }
  return null;
}

export type PointerIntent = "draw" | "navigate" | "ignore";

/**
 * Decides what a new pointer does, like Apple Freeform: the pen always draws, fingers move the
 * canvas. Fingers only draw on devices that never reported a pen, and are ignored while a pen is
 * down so a resting palm cannot pan the page mid-stroke.
 */
export function routePointer(
  pointerType: string,
  context: { drawWithFinger: boolean; penDetected: boolean; penDown: boolean; readOnly: boolean },
): PointerIntent {
  if (pointerType === "pen") return context.readOnly ? "navigate" : "draw";
  if (pointerType === "touch") {
    if (context.penDown) return "ignore";
    if (context.drawWithFinger && !context.penDetected && !context.readOnly) return "draw";
    return "navigate";
  }
  return context.readOnly ? "navigate" : "draw";
}

let strokeCounter = 0;

export function newInkId(prefix: string): string {
  strokeCounter = (strokeCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${strokeCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The selected strokes and text boxes as a drawing of their own, moved to the origin and keeping
 * links that point only at them. Used to turn part of a sketch into a new node.
 */
export function extractSelection(state: InkEditorState, background: InkDocument["background"]): InkDocument | null {
  const selected = new Set(state.selection);
  const bounds = selectionBounds(state);
  if (!bounds) return null;
  const shift: InkTransform = { dx: -bounds.minX, dy: -bounds.minY, scale: 1, originX: 0, originY: 0 };
  const texts = (state.document.texts ?? []).filter((text) => selected.has(text.id)).map((text) => transformText(text, shift));
  return {
    format: state.document.format,
    version: state.document.version,
    background,
    strokes: state.document.strokes.filter((stroke) => selected.has(stroke.id)).map((stroke) => transformStroke(stroke, shift)),
    links: state.document.links.filter((link) => link.strokeIds.every((id) => selected.has(id))),
    ...(texts.length > 0 ? { texts } : {}),
  };
}

/** A node title for extracted handwriting: its typed text if there is any. */
export function titleForExtract(document: InkDocument): string {
  const typed = (document.texts ?? []).map((text) => text.text.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
  return typed ? typed.slice(0, 80) : "Sketch";
}
