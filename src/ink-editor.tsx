/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ink/src/ink-editor.tsx by the BloomMD mirror sync.
 * Source SHA-256: aabf8f9bf781853d6a94da886f6027bb548bfaa8bd3113d6df64c1756a94d8f1
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Eraser, Hand, Highlighter, Link2, LassoSelect, LocateFixed, Moon, PenLine, Redo2, SquarePlus, SquareDashed, Sun, Trash2, Type, Undo2, X } from "lucide-react";
import { inkBackgroundFill, type InkBackground, type InkDocument } from "./ink-document";
import { InkLinkHotspots, InkTextElement, StrokePath, type InkLinkHandlers } from "./ink-preview";
import { PalmGuard } from "./pen-gestures";
import {
  HIGHLIGHTER_OPACITY,
  handleScale,
  pointInPolygon,
  screenToWorld,
  strokeInLasso,
  strokeOutlinePath,
  textInLasso,
  INK_TEXT_LINE_HEIGHT,
  strokesBounds,
  worldToScreen,
  zoomViewportAt,
  type InkBounds,
  type InkPoint,
  type InkStroke,
  type InkText,
  type InkTool,
  type InkTransform,
  type InkViewport,
} from "./ink-geometry";
import {
  activeColor,
  createInkEditorState,
  extractSelection,
  inkEditorReducer,
  inkPalette,
  itemsHitAt,
  linkBounds,
  newInkId,
  routePointer,
  selectionBounds,
  strokeSize,
  textAt,
  titleForExtract,
  type InkEditorTool,
  type InkSize,
} from "./ink-state";

export interface InkEditorProps extends InkLinkHandlers {
  document: InkDocument;
  readOnly: boolean;
  onChange: (document: InkDocument) => void;
  onDone: () => void;
  /** Lets the user pick an Obsidian note; resolves to link text or null when cancelled. */
  onPickNote: () => Promise<string | null>;
  /** Creates a child node holding the given drawing; resolves to whether it worked. */
  onCreateNode?: (document: InkDocument, title: string) => Promise<boolean>;
}

type Gesture =
  | { kind: "stroke"; pointerId: number; tool: InkTool; color: string; size: number; simulatePressure: boolean; points: InkPoint[] }
  | { kind: "erase"; pointerId: number; hits: Set<string> }
  | { kind: "lasso"; pointerId: number; points: Array<[number, number]> }
  | { kind: "move"; pointerId: number; start: [number, number] }
  | { kind: "scale"; pointerId: number; anchor: [number, number]; start: [number, number] };

const ERASER_TOLERANCE = 6;
/** Screen-space radius around a selection corner that grabs it: a 44 px target for pen and finger. */
const HANDLE_REACH = 22;
const FIT_MARGIN = 48;

const TOOL_BUTTONS: Array<{ tool: InkEditorTool; label: string; icon: typeof PenLine }> = [
  { tool: "pen", label: "Pen", icon: PenLine },
  { tool: "highlighter", label: "Highlighter", icon: Highlighter },
  { tool: "eraser", label: "Eraser", icon: Eraser },
  { tool: "lasso", label: "Lasso", icon: LassoSelect },
  { tool: "text", label: "Text", icon: Type },
];

/** Screen font sizes for fine / medium / bold text; stored in world units like stroke widths. */
const TEXT_SIZES: Record<InkSize, number> = { fine: 16, medium: 22, bold: 32 };

const BACKGROUND_BUTTONS: Array<{ background: InkBackground; label: string; icon: typeof Sun }> = [
  { background: "paper", label: "Paper", icon: Sun },
  { background: "dark", label: "Dark paper", icon: Moon },
  { background: "transparent", label: "Transparent", icon: SquareDashed },
];

const SIZE_BUTTONS: Array<{ size: InkSize; label: string }> = [
  { size: "fine", label: "Fine" },
  { size: "medium", label: "Medium" },
  { size: "bold", label: "Bold" },
];


function localPoint(element: HTMLElement, clientX: number, clientY: number): [number, number] {
  const rect = element.getBoundingClientRect();
  return [clientX - rect.left, clientY - rect.top];
}

function pointerPressure(event: PointerEvent): number {
  // Mouse and touch report 0.5 (or 0 on hover); only a stylus gives a meaningful pressure curve.
  return event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5;
}

function coalesced(event: PointerEvent): PointerEvent[] {
  const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  return events.length > 0 ? events : [event];
}

function corners(bounds: InkBounds): Array<[number, number]> {
  return [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]];
}

function applyTransform(bounds: InkBounds, transform: InkTransform | null): InkBounds {
  if (!transform) return bounds;
  const map = (x: number, y: number): [number, number] => [
    transform.originX + (x - transform.originX) * transform.scale + transform.dx,
    transform.originY + (y - transform.originY) * transform.scale + transform.dy,
  ];
  const [minX, minY] = map(bounds.minX, bounds.minY);
  const [maxX, maxY] = map(bounds.maxX, bounds.maxY);
  return { minX, minY, maxX, maxY };
}

function svgTransform(transform: InkTransform): string {
  const { dx, dy, scale, originX, originY } = transform;
  return `translate(${dx} ${dy}) translate(${originX} ${originY}) scale(${scale}) translate(${-originX} ${-originY})`;
}

export function fitViewport(strokes: InkStroke[], width: number, height: number): InkViewport {
  const bounds = strokesBounds(strokes);
  if (!bounds || width <= 0 || height <= 0) return { x: FIT_MARGIN / 2, y: FIT_MARGIN / 2, zoom: 1 };
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const zoom = Math.min(2, Math.max(0.2, Math.min(width / (contentWidth + FIT_MARGIN * 2), height / (contentHeight + FIT_MARGIN * 2))));
  return {
    zoom,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
  };
}

export function InkEditor({ document, readOnly, onChange, onDone, onPickNote, onHoverLink, onOpenLink, onCreateNode }: InkEditorProps) {
  const [state, dispatch] = useReducer(inkEditorReducer, undefined, () => createInkEditorState(document, readOnly));
  const surfaceRef = useRef<HTMLDivElement>(null);
  const livePathRef = useRef<SVGPathElement>(null);
  const lassoPathRef = useRef<SVGPathElement>(null);
  const [preview, setPreviewState] = useState<InkTransform | null>(null);
  const [editingText, setEditingText] = useState<InkText | null>(null);
  // A pen lifted right after its last move fires pointerup before React re-renders; the ref holds
  // the latest transform so the final movement is never lost.
  const previewRef = useRef<InkTransform | null>(null);
  const setPreview = useCallback((next: InkTransform | null) => {
    previewRef.current = next;
    setPreviewState(next);
  }, []);
  const [viewport, setViewport] = useState<InkViewport>({ x: 0, y: 0, zoom: 1 });
  const viewportRef = useRef(viewport);
  const [erasing, setErasing] = useState<ReadonlySet<string>>(() => new Set());
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, [number, number]>());
  const penDown = useRef(false);
  const palm = useRef(new PalmGuard());
  // Where the view was when the first finger landed, to undo a pan the writing hand started.
  const panStart = useRef<InkViewport | null>(null);
  const fitted = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The last document handed to onChange (initially the opened one). Comparing against it rather
  // than the opened document lets an undo back to the opened state be saved too.
  const reportedDocument = useRef(state.document);

  const applyViewport = useCallback((next: InkViewport) => {
    viewportRef.current = next;
    setViewport(next);
  }, []);

  useEffect(() => {
    // Only real edits are reported; opening a drawing must not rewrite its file.
    if (state.document === reportedDocument.current) return;
    reportedDocument.current = state.document;
    onChangeRef.current(state.document);
  }, [state.document]);

  const fit = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    applyViewport(fitViewport(state.document.strokes, surface.clientWidth, surface.clientHeight));
  }, [applyViewport, state.document.strokes]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (fitted.current || surface.clientWidth === 0) return;
      fitted.current = true;
      fit();
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    // React registers wheel listeners as passive, so preventing page zoom needs a native listener.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const [x, y] = localPoint(surface, event.clientX, event.clientY);
      const current = viewportRef.current;
      if (event.ctrlKey || event.metaKey) {
        applyViewport(zoomViewportAt(current, x, y, Math.exp(-event.deltaY * 0.01)));
      } else {
        applyViewport({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
      }
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, [applyViewport]);

  const renderLiveStroke = useCallback(() => {
    const path = livePathRef.current;
    const current = gesture.current;
    if (!path) return;
    if (!current || current.kind !== "stroke") {
      path.setAttribute("d", "");
      return;
    }
    path.setAttribute("d", strokeOutlinePath({ id: "live", tool: current.tool, color: current.color, size: current.size, points: current.points, simulatePressure: current.simulatePressure }));
    path.setAttribute("fill", current.color);
    path.setAttribute("fill-opacity", String(current.tool === "highlighter" ? HIGHLIGHTER_OPACITY : 1));
  }, []);

  const moveTouches = useCallback((pointerId: number, next: [number, number]) => {
    // A palm resting on the screen must not move the canvas under a pen stroke.
    if (penDown.current) return;
    const previous = new Map(touches.current);
    touches.current.set(pointerId, next);
    const current = viewportRef.current;
    if (touches.current.size === 1) {
      const before = previous.get(pointerId);
      if (!before) return;
      applyViewport({ ...current, x: current.x + next[0] - before[0], y: current.y + next[1] - before[1] });
      return;
    }
    const [firstId, secondId] = [...touches.current.keys()];
    const a0 = previous.get(firstId!);
    const b0 = previous.get(secondId!);
    const a1 = touches.current.get(firstId!);
    const b1 = touches.current.get(secondId!);
    if (!a0 || !b0 || !a1 || !b1) return;
    const distanceBefore = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]);
    const distanceAfter = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
    const centerBefore: [number, number] = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
    const centerAfter: [number, number] = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
    const zoomed = distanceBefore > 0 ? zoomViewportAt(current, centerBefore[0], centerBefore[1], distanceAfter / distanceBefore) : current;
    applyViewport({ ...zoomed, x: zoomed.x + centerAfter[0] - centerBefore[0], y: zoomed.y + centerAfter[1] - centerBefore[1] });
  }, [applyViewport]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const native = event.nativeEvent;
    if (event.pointerType === "touch") {
      if (touches.current.size === 0) panStart.current = viewportRef.current;
      if (palm.current.touchStart(event.pointerId, event.timeStamp)) {
        event.preventDefault();
        return;
      }
    }
    if (event.pointerType === "pen" && !state.penDetected) dispatch({ type: "penDetected" });
    const intent = routePointer(event.pointerType, {
      drawWithFinger: state.drawWithFinger,
      penDetected: state.penDetected || event.pointerType === "pen",
      penDown: penDown.current,
      readOnly: state.readOnly,
    });
    if (intent === "ignore") return;
    const middleMouse = event.pointerType === "mouse" && event.button === 1;
    if (event.pointerType === "mouse" && event.button !== 0 && !middleMouse) return;
    event.preventDefault();
    // Synthetic or already-released pointers cannot be captured; drawing still works without it.
    try { surface.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    surface.focus({ preventScroll: true });
    const screen = localPoint(surface, event.clientX, event.clientY);

    if (intent === "navigate" || middleMouse) {
      touches.current.set(event.pointerId, screen);
      return;
    }
    if (event.pointerType === "pen") {
      // The hand holding the pen often touches the glass a moment before the tip: it must not have
      // moved the page, and it must not keep moving it while the pen writes.
      if (palm.current.penDown(event.timeStamp, event.pointerId) && panStart.current) applyViewport(panStart.current);
      touches.current.clear();
    }
    if (gesture.current) return;
    const [x, y] = screenToWorld(viewportRef.current, screen[0], screen[1]);
    if (state.tool === "text") {
      // Tapping text edits it; tapping empty paper places a new text field. On iPad, writing into
      // that field with Apple Pencil is converted to typed text by Scribble.
      // A tap elsewhere first keeps what was written in the open field.
      if (editingText) dispatch({ type: "upsertText", text: editingText });
      const hit = textAt(state.document, x, y);
      setEditingText(hit && hit.id !== editingText?.id ? hit : hit ? null : {
        id: newInkId("t"),
        x,
        y,
        text: "",
        size: TEXT_SIZES[state.size] / viewportRef.current.zoom,
        color: activeColor(state),
      });
      return;
    }
    // Every branch below starts a gesture, whose pointerup clears this again; until then a resting
    // palm cannot pan the canvas.
    if (event.pointerType === "pen") penDown.current = true;
    if (state.tool === "lasso") {
      const bounds = selectionBounds(state);
      if (bounds) {
        const boxCorners = corners(bounds);
        const grabbed = boxCorners.findIndex(([cx, cy]) => {
          const [sx, sy] = worldToScreen(viewportRef.current, cx, cy);
          return Math.hypot(sx - screen[0], sy - screen[1]) <= HANDLE_REACH;
        });
        if (grabbed >= 0) {
          gesture.current = { kind: "scale", pointerId: event.pointerId, anchor: boxCorners[(grabbed + 2) % 4]!, start: boxCorners[grabbed]! };
          return;
        }
        if (pointInPolygon(x, y, boxCorners)) {
          gesture.current = { kind: "move", pointerId: event.pointerId, start: [x, y] };
          return;
        }
      }
      gesture.current = { kind: "lasso", pointerId: event.pointerId, points: [[x, y]] };
      return;
    }
    if (state.tool === "eraser") {
      const hits = new Set(itemsHitAt(state.document, x, y, ERASER_TOLERANCE / viewportRef.current.zoom));
      gesture.current = { kind: "erase", pointerId: event.pointerId, hits };
      setErasing(new Set(hits));
      return;
    }
    const tool: InkTool = state.tool === "highlighter" ? "highlighter" : "pen";
    gesture.current = {
      kind: "stroke",
      pointerId: event.pointerId,
      tool,
      color: activeColor(state),
      // Stroke width is constant on screen, so zooming in gives finer handwriting.
      size: strokeSize(tool, state.size) / viewportRef.current.zoom,
      simulatePressure: event.pointerType !== "pen",
      points: [[x, y, pointerPressure(native)]],
    };
    renderLiveStroke();
  }, [applyViewport, editingText, renderLiveStroke, state]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (touches.current.has(event.pointerId)) {
      moveTouches(event.pointerId, localPoint(surface, event.clientX, event.clientY));
      return;
    }
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const view = viewportRef.current;
    if (current.kind === "stroke") {
      for (const sample of coalesced(event.nativeEvent)) {
        const [sx, sy] = localPoint(surface, sample.clientX, sample.clientY);
        const [x, y] = screenToWorld(view, sx, sy);
        const last = current.points[current.points.length - 1];
        if (last && Math.hypot(last[0] - x, last[1] - y) < 0.5 / view.zoom) continue;
        current.points.push([x, y, pointerPressure(sample)]);
      }
      renderLiveStroke();
      return;
    }
    if (current.kind === "lasso") {
      for (const sample of coalesced(event.nativeEvent)) {
        const [sx, sy] = localPoint(surface, sample.clientX, sample.clientY);
        current.points.push(screenToWorld(view, sx, sy));
      }
      const [first, ...rest] = current.points;
      lassoPathRef.current?.setAttribute("d", first ? `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join("")}Z` : "");
      return;
    }
    if (current.kind === "move" || current.kind === "scale") {
      const [sx, sy] = localPoint(surface, event.clientX, event.clientY);
      const point = screenToWorld(view, sx, sy);
      setPreview(current.kind === "move"
        ? { dx: point[0] - current.start[0], dy: point[1] - current.start[1], scale: 1, originX: 0, originY: 0 }
        : { dx: 0, dy: 0, scale: handleScale(current.anchor, current.start, point), originX: current.anchor[0], originY: current.anchor[1] });
      return;
    }
    const before = current.hits.size;
    for (const sample of coalesced(event.nativeEvent)) {
      const [sx, sy] = localPoint(surface, sample.clientX, sample.clientY);
      const [x, y] = screenToWorld(view, sx, sy);
      for (const id of itemsHitAt(state.document, x, y, ERASER_TOLERANCE / view.zoom)) current.hits.add(id);
    }
    if (current.hits.size !== before) setErasing(new Set(current.hits));
  }, [moveTouches, renderLiveStroke, setPreview, state.document]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") palm.current.touchEnd(event.pointerId);
    // Only the pen that touched down lifts; hover events of a pen that never touched are ignored.
    if (event.pointerType === "pen") palm.current.penUp(event.timeStamp, event.pointerId);
    if (touches.current.delete(event.pointerId)) return;
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.pointerType === "pen") penDown.current = false;
    if (current.kind === "stroke") {
      renderLiveStroke();
      dispatch({
        type: "commitStroke",
        stroke: {
          id: newInkId("s"),
          tool: current.tool,
          color: current.color,
          size: current.size,
          points: current.points,
          ...(current.simulatePressure ? { simulatePressure: true } : {}),
        },
      });
      return;
    }
    if (current.kind === "lasso") {
      lassoPathRef.current?.setAttribute("d", "");
      const polygon = current.points;
      dispatch({
        type: "select",
        strokeIds: polygon.length < 3 ? [] : [
          ...state.document.strokes.filter((stroke) => strokeInLasso(stroke, polygon)).map((stroke) => stroke.id),
          ...(state.document.texts ?? []).filter((text) => textInLasso(text, polygon)).map((text) => text.id),
        ],
      });
      return;
    }
    if (current.kind === "move" || current.kind === "scale") {
      const transform = previewRef.current;
      if (transform) dispatch({ type: "transformSelection", transform });
      setPreview(null);
      return;
    }
    setErasing(new Set());
    if (current.hits.size > 0) dispatch({ type: "eraseStrokes", strokeIds: [...current.hits] });
  }, [renderLiveStroke, setPreview, state.document]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Backspace" || event.key === "Delete") && state.selection.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "deleteSelection" });
      return;
    }
    const primary = event.metaKey || event.ctrlKey;
    if (!primary || event.key.toLowerCase() !== "z" && event.key.toLowerCase() !== "y") return;
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo" });
  }, [state.selection.length]);

  const linkSelection = useCallback(async () => {
    const target = await onPickNote();
    if (target) dispatch({ type: "linkSelection", linkId: newInkId("l"), target });
  }, [onPickNote]);
  const linkHandlers = useMemo<InkLinkHandlers>(() => ({ onHoverLink, onOpenLink }), [onHoverLink, onOpenLink]);

  const createNodeFromSelection = useCallback(async () => {
    if (!onCreateNode) return;
    const extracted = extractSelection(state, state.document.background);
    if (!extracted) return;
    // Moving, not copying: the sketch leaves this drawing only once the new node exists. The
    // selection may have changed meanwhile, so exactly the extracted items are removed.
    const extractedIds = [...state.selection];
    if (await onCreateNode(extracted, titleForExtract(extracted))) dispatch({ type: "deleteSelection", ids: extractedIds });
  }, [onCreateNode, state]);

  const commitText = useCallback((text: InkText) => {
    dispatch({ type: "upsertText", text });
    setEditingText(null);
  }, []);

  const color = activeColor(state);
  const selected = useMemo(() => new Set(state.selection), [state.selection]);
  const worldBox = selectionBounds(state);
  const box = worldBox ? (() => {
    const moved = applyTransform(worldBox, preview);
    const [minX, minY] = worldToScreen(viewport, moved.minX, moved.minY);
    const [maxX, maxY] = worldToScreen(viewport, moved.maxX, moved.maxY);
    return { minX, minY, maxX, maxY };
  })() : null;
  const gridSize = 24 * viewport.zoom;

  return (
    <div className="bloommd-ink-editor" onKeyDown={onKeyDown}>
      <div className="bloommd-ink-toolbar" role="toolbar" aria-label="Handwriting tools">
        <div className="bloommd-ink-group">
          {TOOL_BUTTONS.map(({ tool, label, icon: Icon }) => (
            <button
              key={tool}
              type="button"
              className={`bloommd-ink-button${state.tool === tool ? " is-active" : ""}`}
              title={label}
              aria-label={label}
              aria-pressed={state.tool === tool}
              disabled={state.readOnly}
              onClick={() => dispatch({ type: "setTool", tool })}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
        {/* Colour and width stay in place for the eraser so the canvas never jumps under the pen. */}
        <div className="bloommd-ink-group" aria-label="Color">
          {inkPalette(state.document.background).map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`bloommd-ink-swatch${color === swatch ? " is-active" : ""}`}
              style={{ ["--bloommd-swatch" as string]: swatch }}
              title={`Color ${swatch}`}
              aria-label={`Color ${swatch}`}
              aria-pressed={color === swatch}
              disabled={state.readOnly || state.tool === "eraser"}
              onClick={() => dispatch({ type: "setColor", color: swatch })}
            />
          ))}
        </div>
        <div className="bloommd-ink-group" aria-label="Stroke width">
          {SIZE_BUTTONS.map(({ size, label }) => (
            <button
              key={size}
              type="button"
              className={`bloommd-ink-button bloommd-ink-size is-${size}${state.size === size ? " is-active" : ""}`}
              title={label}
              aria-label={`${label} stroke`}
              aria-pressed={state.size === size}
              disabled={state.readOnly || state.tool === "eraser" || state.tool === "lasso"}
              onClick={() => dispatch({ type: "setSize", size })}
            >
              <span />
            </button>
          ))}
        </div>
        <div className="bloommd-ink-group" aria-label="Background">
          {BACKGROUND_BUTTONS.map(({ background, label, icon: Icon }) => (
            <button
              key={background}
              type="button"
              className={`bloommd-ink-button${state.document.background === background ? " is-active" : ""}`}
              title={label}
              aria-label={label}
              aria-pressed={state.document.background === background}
              disabled={state.readOnly}
              onClick={() => dispatch({ type: "setBackground", background })}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
        <div className="bloommd-ink-group">
          <button type="button" className="bloommd-ink-button" title="Link selection to a note" aria-label="Link to note" disabled={state.selection.length === 0 || state.readOnly} onClick={() => void linkSelection()}><Link2 size={18} /></button>
          {onCreateNode && <button type="button" className="bloommd-ink-button" title="New node from selection" aria-label="New node from selection" disabled={state.selection.length === 0 || state.readOnly} onClick={() => void createNodeFromSelection()}><SquarePlus size={18} /></button>}
          <button type="button" className="bloommd-ink-button" title="Delete selection (Backspace)" aria-label="Delete selection" disabled={state.selection.length === 0 || state.readOnly} onClick={() => dispatch({ type: "deleteSelection" })}><Trash2 size={18} /></button>
          <button type="button" className="bloommd-ink-button" title="Undo (Cmd/Ctrl+Z)" aria-label="Undo" disabled={state.past.length === 0 || state.readOnly} onClick={() => dispatch({ type: "undo" })}><Undo2 size={18} /></button>
          <button type="button" className="bloommd-ink-button" title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo" disabled={state.future.length === 0 || state.readOnly} onClick={() => dispatch({ type: "redo" })}><Redo2 size={18} /></button>
          <button type="button" className="bloommd-ink-button" title="Fit drawing" aria-label="Fit drawing" onClick={fit}><LocateFixed size={18} /></button>
          <button
            type="button"
            className={`bloommd-ink-button${state.drawWithFinger && !state.penDetected ? " is-active" : ""}`}
            title={state.penDetected ? "A pen was detected: fingers move the canvas" : "Draw with finger"}
            aria-label="Draw with finger"
            aria-pressed={state.drawWithFinger && !state.penDetected}
            disabled={state.penDetected || state.readOnly}
            onClick={() => dispatch({ type: "setDrawWithFinger", enabled: !state.drawWithFinger })}
          >
            <Hand size={18} />
          </button>
        </div>
        <span className="bloommd-ink-spacer" />
        <button type="button" className="bloommd-ink-done" onClick={onDone}><Check size={16} /><span>Done</span></button>
      </div>
      {state.readOnly && <p className="bloommd-ink-notice" role="status">This drawing was created by a newer BloomMD version and opens read-only.</p>}
      <div
        ref={surfaceRef}
        className={`bloommd-ink-surface is-tool-${state.tool} is-${state.document.background}`}
        tabIndex={0}
        aria-label="Handwriting canvas"
        style={{
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          ...(inkBackgroundFill(state.document.background) ? { backgroundColor: inkBackgroundFill(state.document.background)! } : {}),
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onContextMenu={(event) => event.preventDefault()}
      >
        <svg className="bloommd-ink-svg" width="100%" height="100%">
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
            {state.document.strokes.filter((stroke) => !selected.has(stroke.id)).map((stroke) => <StrokePath key={stroke.id} stroke={stroke} dimmed={erasing.has(stroke.id)} />)}
            {(state.document.texts ?? []).filter((text) => !selected.has(text.id) && text.id !== editingText?.id).map((text) => <InkTextElement key={text.id} text={text} dimmed={erasing.has(text.id)} />)}
            <g className="bloommd-ink-selected" transform={preview ? svgTransform(preview) : undefined}>
              {state.document.strokes.filter((stroke) => selected.has(stroke.id)).map((stroke) => <StrokePath key={stroke.id} stroke={stroke} dimmed={false} />)}
              {(state.document.texts ?? []).filter((text) => selected.has(text.id)).map((text) => <InkTextElement key={text.id} text={text} dimmed={false} />)}
            </g>
            {state.tool !== "lasso" && <InkLinkHotspots document={state.document} handlers={linkHandlers} />}
            <path ref={livePathRef} className="bloommd-ink-live" d="" />
            <path ref={lassoPathRef} className="bloommd-ink-lasso" d="" strokeWidth={1.5 / viewport.zoom} strokeDasharray={`${6 / viewport.zoom} ${4 / viewport.zoom}`} />
          </g>
          {box && (
            <g className="bloommd-ink-selection">
              <rect x={box.minX} y={box.minY} width={box.maxX - box.minX} height={box.maxY - box.minY} />
              {corners(box).map(([x, y], index) => <rect key={index} className="bloommd-ink-handle" x={x - 6} y={y - 6} width={12} height={12} rx={3} />)}
            </g>
          )}
        </svg>
        {editingText && (() => {
          const [left, top] = worldToScreen(viewport, editingText.x, editingText.y);
          const fontSize = editingText.size * viewport.zoom;
          return (
            <textarea
              key={editingText.id}
              className="bloommd-ink-text-input"
              aria-label="Text on drawing"
              placeholder="Write or type…"
              autoFocus
              value={editingText.text}
              style={{ left, top, fontSize, lineHeight: INK_TEXT_LINE_HEIGHT, color: editingText.color }}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setEditingText({ ...editingText, text: event.target.value })}
              onBlur={() => commitText(editingText)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
                  event.preventDefault();
                  commitText(editingText);
                }
              }}
            />
          );
        })()}
        {state.document.links.map((link) => {
          const bounds = linkBounds(state.document, link);
          if (!bounds) return null;
          const [x, y] = worldToScreen(viewport, bounds.minX, bounds.maxY);
          return (
            <span key={link.id} className="bloommd-ink-link-chip" style={{ left: x, top: y + 8 }} onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" title={`Open ${link.target}`} onClick={() => onOpenLink(link.target)}><Link2 size={12} />{link.target}</button>
              {!state.readOnly && <button type="button" title={`Remove link to ${link.target}`} aria-label={`Remove link to ${link.target}`} onClick={() => dispatch({ type: "unlink", linkId: link.id })}><X size={12} /></button>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
