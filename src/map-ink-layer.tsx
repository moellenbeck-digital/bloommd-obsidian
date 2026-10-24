import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ViewportPortal, useReactFlow, useViewport } from "@xyflow/react";
import { Check, Eraser, Highlighter, LassoSelect, PenLine, Redo2, SquarePlus, Trash2, Undo2 } from "lucide-react";
import type { InkDocument } from "./ink-document";
import {
  HIGHLIGHTER_OPACITY,
  handleScale,
  pointInPolygon,
  strokeInLasso,
  strokeOutlinePath,
  type InkBounds,
  type InkPoint,
  type InkTool,
  type InkTransform,
} from "./ink-geometry";
import { InkTextElement, StrokePath } from "./ink-preview";
import { MapInkBar } from "./map-ink-bar";
import { capturePalmTouches } from "./map-touch-capture";
import { DOUBLE_TAP_MS, PEN_HOLD_MS, PEN_HOLD_SLOP, PalmGuard, classifyPenStroke, nodeAt, strokesUnderScratch } from "./pen-gestures";
import {
  createInkEditorState,
  extractSelection,
  inkEditorReducer,
  inkPalette,
  itemsHitAt,
  newInkId,
  routePointer,
  selectionBounds,
  strokeSize,
  titleForExtract,
  type InkEditorTool,
} from "./ink-state";

export interface MapInkLayerProps {
  document: InkDocument;
  readOnly: boolean;
  /** Draw mode: pen and mouse draw on the map, fingers keep panning and zooming. */
  active: boolean;
  /** Element whose pointer events the layer intercepts while drawing (the map pane). */
  host: HTMLElement | null;
  onChange: (document: InkDocument) => void;
  /** A stroke from one node to another becomes a concept-map connection instead of ink. */
  onConnect: (source: string, target: string) => void;
  onDone: () => void;
  /** Pen tap on a node. */
  onSelectNode?: (id: string) => void;
  /** Pen double tap on a node. */
  onOpenNode?: (id: string) => void;
  /** Pen held on a node and lifted without moving. */
  onNodeMenu?: (id: string, point: { x: number; y: number }) => void;
  /** Pen held on a node, then dragged; `final` on release. */
  onMoveNode?: (id: string, position: { x: number; y: number }, final: boolean) => void;
  /** A straight stroke from a node's edge into free space: a new child ending there. */
  onBranch?: (source: string, position: { x: number; y: number }) => void;
  /** A pen gesture changed something the writer may not have meant to; `undo` reverts it. */
  onNotice?: (message: string, undo?: () => void) => void;
  /** Lassoed map ink becomes a node of its own. */
  onCreateNode?: (document: InkDocument, title: string, position: { x: number; y: number }) => Promise<boolean>;
}

type Viewport = { x: number; y: number; zoom: number };

type Gesture =
  | {
    kind: "stroke";
    pointerId: number;
    tool: InkTool;
    color: string;
    size: number;
    simulatePressure: boolean;
    points: InkPoint[];
    startedAt: number;
    startClient: [number, number];
    /** Largest screen distance from the start so far; a held pen must stay within the slop. */
    wander: number;
    node: string | null;
  }
  | { kind: "held"; pointerId: number; node: string; startClient: [number, number]; grab: [number, number] }
  | { kind: "nodeDrag"; pointerId: number; node: string; grab: [number, number]; last: { x: number; y: number } }
  | { kind: "erase"; pointerId: number; hits: Set<string> }
  | { kind: "lasso"; pointerId: number; points: Array<[number, number]> }
  | { kind: "move"; pointerId: number; start: [number, number] }
  | { kind: "scale"; pointerId: number; anchor: [number, number]; start: [number, number] };

const TOOLS: Array<{ tool: InkEditorTool; label: string; icon: typeof PenLine }> = [
  { tool: "pen", label: "Pen", icon: PenLine },
  { tool: "highlighter", label: "Highlighter", icon: Highlighter },
  { tool: "eraser", label: "Eraser", icon: Eraser },
  { tool: "lasso", label: "Lasso", icon: LassoSelect },
];

/** Interactive UI inside the map pane that must never be drawn on. */
const CONTROLS = "button, input, select, textarea, a, .react-flow__controls, .react-flow__minimap, .bloommd-map-ink-bar, .bloommd-study-bar, .bloommd-map-ink-status";

/** Screen-space grab radius of a selection corner (44 px target). */
const HANDLE_REACH = 22;

function corners(bounds: InkBounds): Array<[number, number]> {
  return [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]];
}

function themePalette(): readonly string[] {
  return inkPalette(typeof document !== "undefined" && document.body.classList.contains("theme-dark") ? "dark" : "paper");
}

/** Handwriting drawn directly on the map, in map coordinates, above the nodes. */
export function MapInkLayer(props: MapInkLayerProps) {
  const { document: initial, readOnly, active, host, onChange, onDone, onCreateNode } = props;
  const [state, dispatch] = useReducer(inkEditorReducer, undefined, () => {
    const base = createInkEditorState(initial, readOnly);
    // The map has no paper of its own: ink follows the Obsidian theme so it stays readable.
    const palette = themePalette();
    return { ...base, colors: { pen: palette[0]!, highlighter: palette[4]! } };
  });
  const reactFlow = useReactFlow();
  const { zoom } = useViewport();
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const livePathRef = useRef<SVGPathElement>(null);
  const lassoPathRef = useRef<SVGPathElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const penDown = useRef(false);
  const [erasing, setErasing] = useState<ReadonlySet<string>>(() => new Set());
  const [preview, setPreviewState] = useState<InkTransform | null>(null);
  const previewRef = useRef<InkTransform | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const initialDocument = useRef(state.document);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Callbacks change every render; the pointer listeners read the latest ones.
  const callbacks = useRef(props);
  callbacks.current = props;

  const setPreview = useCallback((next: InkTransform | null) => {
    previewRef.current = next;
    setPreviewState(next);
  }, []);

  useEffect(() => {
    if (state.document === initialDocument.current) return;
    onChangeRef.current(state.document);
  }, [state.document]);

  const renderLive = useCallback(() => {
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

  const nodeBoxes = useCallback(() => reactFlow.getNodes().flatMap((node) => {
    const internal = reactFlow.getInternalNode(node.id);
    if (!internal) return [];
    return [{
      id: node.id,
      x: internal.internals.positionAbsolute.x,
      y: internal.internals.positionAbsolute.y,
      width: internal.measured.width ?? 0,
      height: internal.measured.height ?? 0,
    }];
  }), [reactFlow]);

  useEffect(() => {
    if (!active || !host) return;
    const toFlow = (event: PointerEvent): [number, number] => {
      const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      return [point.x, point.y];
    };
    const pressure = (event: PointerEvent) => (event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5);
    const palm = new PalmGuard();
    // Where the view was when the first finger landed, to undo a pan the writing hand started.
    let panStart: Viewport | null = null;
    let holdTimer: number | undefined;
    let lastTap: { node: string; at: number } | null = null;
    const markHeld = (id: string, held: boolean) => {
      const element = host.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      element?.classList.toggle("is-pen-held", held);
    };
    const nodePosition = (id: string) => reactFlow.getInternalNode(id)?.internals.positionAbsolute ?? { x: 0, y: 0 };

    const onDown = (event: PointerEvent) => {
      // Tools, zoom controls, minimap and other buttons on top of the map keep working as buttons
      // instead of leaving a dot of ink under every click.
      if (event.target instanceof Element && event.target.closest(CONTROLS)) return;
      const current = stateRef.current;
      if (event.pointerType === "pen" && !current.penDetected) dispatch({ type: "penDetected" });
      const intent = routePointer(event.pointerType, {
        drawWithFinger: false,
        penDetected: current.penDetected || event.pointerType === "pen",
        penDown: penDown.current,
        readOnly: current.readOnly,
      });
      // Fingers stay with React Flow for panning and pinching; the pen and mouse draw.
      if (intent === "navigate") return;
      event.stopPropagation();
      event.preventDefault();
      if (intent === "ignore" || gesture.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.pointerType === "pen") {
        penDown.current = true;
        host.classList.add("is-pen-writing");
        if (palm.penDown(event.timeStamp, event.pointerId) && panStart) void reactFlow.setViewport(panStart);
      }
      const [x, y] = toFlow(event);
      const z = zoomRef.current;
      if (current.tool === "lasso") {
        const bounds = selectionBounds(current);
        if (bounds) {
          const boxCorners = corners(bounds);
          const grabbed = boxCorners.findIndex(([cx, cy]) => Math.hypot(cx - x, cy - y) * z <= HANDLE_REACH);
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
      if (current.tool === "eraser") {
        const hits = new Set(itemsHitAt(current.document, x, y, 6 / z));
        gesture.current = { kind: "erase", pointerId: event.pointerId, hits };
        setErasing(new Set(hits));
        return;
      }
      const tool: InkTool = current.tool === "highlighter" ? "highlighter" : "pen";
      const node = current.readOnly ? null : nodeAt(nodeBoxes(), x, y)?.id ?? null;
      gesture.current = {
        kind: "stroke",
        pointerId: event.pointerId,
        tool,
        color: current.colors[tool],
        size: strokeSize(tool, current.size) / z,
        simulatePressure: event.pointerType !== "pen",
        points: [[x, y, pressure(event)]],
        startedAt: event.timeStamp,
        startClient: [event.clientX, event.clientY],
        wander: 0,
        node,
      };
      renderLive();
      if (node && tool === "pen") {
        // Holding the pen still on a node picks it up: drag to move it, lift for its menu.
        window.clearTimeout(holdTimer);
        const pointerId = event.pointerId;
        holdTimer = window.setTimeout(() => {
          const stroke = gesture.current;
          if (stroke?.kind !== "stroke" || stroke.pointerId !== pointerId || stroke.wander > PEN_HOLD_SLOP) return;
          const origin = nodePosition(node);
          gesture.current = { kind: "held", pointerId, node, startClient: stroke.startClient, grab: [stroke.points[0]![0] - origin.x, stroke.points[0]![1] - origin.y] };
          renderLive();
          markHeld(node, true);
        }, PEN_HOLD_MS);
      }
    };

    const onMove = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const samples = typeof event.getCoalescedEvents === "function" && event.getCoalescedEvents().length > 0 ? event.getCoalescedEvents() : [event];
      const z = zoomRef.current;
      if (current.kind === "stroke") {
        current.wander = Math.max(current.wander, Math.hypot(event.clientX - current.startClient[0], event.clientY - current.startClient[1]));
        for (const sample of samples) {
          const [x, y] = toFlow(sample);
          const last = current.points[current.points.length - 1];
          if (last && Math.hypot(last[0] - x, last[1] - y) < 0.5 / z) continue;
          current.points.push([x, y, pressure(sample)]);
        }
        renderLive();
      } else if (current.kind === "held" || current.kind === "nodeDrag") {
        if (current.kind === "held" && Math.hypot(event.clientX - current.startClient[0], event.clientY - current.startClient[1]) <= PEN_HOLD_SLOP) return;
        const [x, y] = toFlow(event);
        const position = { x: x - current.grab[0], y: y - current.grab[1] };
        gesture.current = { kind: "nodeDrag", pointerId: current.pointerId, node: current.node, grab: current.grab, last: position };
        callbacks.current.onMoveNode?.(current.node, position, false);
      } else if (current.kind === "erase") {
        const before = current.hits.size;
        for (const sample of samples) {
          const [x, y] = toFlow(sample);
          for (const id of itemsHitAt(stateRef.current.document, x, y, 6 / z)) current.hits.add(id);
        }
        if (current.hits.size !== before) setErasing(new Set(current.hits));
      } else if (current.kind === "lasso") {
        for (const sample of samples) current.points.push(toFlow(sample));
        const [first, ...rest] = current.points;
        lassoPathRef.current?.setAttribute("d", first ? `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join("")}Z` : "");
      } else {
        const point = toFlow(event);
        setPreview(current.kind === "move"
          ? { dx: point[0] - current.start[0], dy: point[1] - current.start[1], scale: 1, originX: 0, originY: 0 }
          : { dx: 0, dy: 0, scale: handleScale(current.anchor, current.start, point), originX: current.anchor[0], originY: current.anchor[1] });
      }
    };

    const finishStroke = (current: Extract<Gesture, { kind: "stroke" }>, event: PointerEvent) => {
      const commit = () => dispatch({
        type: "commitStroke",
        stroke: { id: newInkId("m"), tool: current.tool, color: current.color, size: current.size, points: current.points, ...(current.simulatePressure ? { simulatePressure: true } : {}) },
      });
      const z = zoomRef.current;
      const gestureOf = classifyPenStroke(current.points, nodeBoxes(), z, event.timeStamp - current.startedAt);
      const handlers = callbacks.current;
      if (gestureOf.kind === "tap") {
        // A tap on empty map is ink (the dot on an i); on a node it selects, twice opens it.
        if (!gestureOf.node) return commit();
        const now = event.timeStamp;
        if (lastTap && lastTap.node === gestureOf.node && now - lastTap.at < DOUBLE_TAP_MS) {
          lastTap = null;
          handlers.onOpenNode?.(gestureOf.node);
        } else {
          lastTap = { node: gestureOf.node, at: now };
          handlers.onSelectNode?.(gestureOf.node);
        }
        return;
      }
      if (current.tool !== "pen") return commit();
      if (gestureOf.kind === "connect") return handlers.onConnect(gestureOf.source, gestureOf.target);
      if (gestureOf.kind === "branch" && handlers.onBranch) return handlers.onBranch(gestureOf.source, { x: gestureOf.end[0], y: gestureOf.end[1] });
      if (gestureOf.kind === "scratch") {
        // Only what lies mostly under the zigzag goes; highlighter marks and typed text stay.
        const hits = strokesUnderScratch(current.points, stateRef.current.document.strokes, 4 / z);
        if (hits.length > 0) {
          dispatch({ type: "eraseStrokes", strokeIds: hits });
          handlers.onNotice?.(hits.length === 1 ? "Scratched out 1 stroke" : `Scratched out ${hits.length} strokes`, () => {
            // Undo only while the scratch-out is still the last drawing change.
            const latest = stateRef.current;
            const before = latest.past[latest.past.length - 1];
            const holds = (document: InkDocument, id: string) => document.strokes.some((stroke) => stroke.id === id);
            if (before && hits.every((id) => holds(before, id) && !holds(latest.document, id))) dispatch({ type: "undo" });
          });
          return;
        }
      }
      commit();
    };

    const onUp = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      gesture.current = null;
      window.clearTimeout(holdTimer);
      if (event.pointerType === "pen") {
        penDown.current = false;
        host.classList.remove("is-pen-writing");
        palm.penUp(event.timeStamp, event.pointerId);
      }
      if (current.kind === "stroke") {
        renderLive();
        if (event.type === "pointercancel") return;
        finishStroke(current, event);
      } else if (current.kind === "held") {
        markHeld(current.node, false);
        if (event.type !== "pointercancel") {
          const at = { x: event.clientX, y: event.clientY };
          // Opened right away, Obsidian closes the menu again on the touchend that follows the lift.
          window.setTimeout(() => callbacks.current.onNodeMenu?.(current.node, at), 80);
        }
      } else if (current.kind === "nodeDrag") {
        markHeld(current.node, false);
        callbacks.current.onMoveNode?.(current.node, current.last, true);
      } else if (current.kind === "erase") {
        setErasing(new Set());
        if (current.hits.size > 0) dispatch({ type: "eraseStrokes", strokeIds: [...current.hits] });
      } else if (current.kind === "lasso") {
        lassoPathRef.current?.setAttribute("d", "");
        const polygon = current.points;
        dispatch({ type: "select", strokeIds: polygon.length < 3 ? [] : stateRef.current.document.strokes.filter((stroke) => strokeInLasso(stroke, polygon)).map((stroke) => stroke.id) });
      } else {
        const transform = previewRef.current;
        if (transform) dispatch({ type: "transformSelection", transform });
        setPreview(null);
      }
    };

    // Pen touches and the resting hand (touches and the pointer and click events derived from them)
    // must not reach React Flow, or the map moves and selections change under the pen.
    const releasePalm = capturePalmTouches(host, palm, { exempt: CONTROLS, onFirstFinger: () => { panStart = reactFlow.getViewport(); } });
    host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.clearTimeout(holdTimer);
      releasePalm();
      host.classList.remove("is-pen-writing");
      host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [active, host, nodeBoxes, reactFlow, renderLive, setPreview]);

  const createNodeFromSelection = useCallback(async () => {
    const current = stateRef.current;
    const bounds = selectionBounds(current);
    const extracted = extractSelection(current, current.document.background);
    if (!onCreateNode || !bounds || !extracted) return;
    if (await onCreateNode(extracted, titleForExtract(extracted), { x: bounds.minX, y: bounds.minY })) dispatch({ type: "deleteSelection" });
  }, [onCreateNode]);

  const selected = useMemo(() => new Set(state.selection), [state.selection]);
  const box = selectionBounds(state);
  const palette = themePalette();
  const color = state.colors[state.tool === "highlighter" ? "highlighter" : "pen"];
  const transform = preview
    ? `translate(${preview.dx} ${preview.dy}) translate(${preview.originX} ${preview.originY}) scale(${preview.scale}) translate(${-preview.originX} ${-preview.originY})`
    : undefined;

  return (
    <>
      <ViewportPortal>
        <svg className={`bloommd-map-ink${active ? " is-active" : ""}`} width={1} height={1} aria-label="Handwriting on the map">
          {state.document.strokes.filter((stroke) => !selected.has(stroke.id)).map((stroke) => <StrokePath key={stroke.id} stroke={stroke} dimmed={erasing.has(stroke.id)} />)}
          {(state.document.texts ?? []).map((text) => <InkTextElement key={text.id} text={text} dimmed={erasing.has(text.id)} />)}
          <g transform={transform}>
            {state.document.strokes.filter((stroke) => selected.has(stroke.id)).map((stroke) => <StrokePath key={stroke.id} stroke={stroke} dimmed={false} />)}
          </g>
          <path ref={livePathRef} d="" />
          <path ref={lassoPathRef} className="bloommd-ink-lasso" d="" strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
          {active && box && (
            <g className="bloommd-ink-selection" transform={transform}>
              <rect x={box.minX} y={box.minY} width={box.maxX - box.minX} height={box.maxY - box.minY} strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
              {corners(box).map(([x, y], index) => <rect key={index} className="bloommd-ink-handle" x={x - 6 / zoom} y={y - 6 / zoom} width={12 / zoom} height={12 / zoom} rx={3 / zoom} strokeWidth={2 / zoom} />)}
            </g>
          )}
        </svg>
      </ViewportPortal>
      {active && (
        <MapInkBar
          done={<button type="button" className="bloommd-ink-done" onClick={onDone}><Check size={16} /><span>Done</span></button>}
          compact={(
            <>
              {TOOLS.filter(({ tool }) => tool === state.tool).map(({ tool, label, icon: Icon }) => (
                <span key={tool} className="bloommd-ink-button is-active bloommd-map-ink-current" title={label} aria-label={`Current tool: ${label}`}><Icon size={18} /></span>
              ))}
              {state.tool !== "eraser" && state.tool !== "lasso" && <span className="bloommd-ink-swatch is-active" style={{ ["--bloommd-swatch" as string]: color }} aria-label={`Current color ${color}`} />}
              <button type="button" className="bloommd-ink-button" title="Undo" aria-label="Undo drawing" disabled={state.past.length === 0} onClick={() => dispatch({ type: "undo" })}><Undo2 size={18} /></button>
            </>
          )}
        >
          {TOOLS.map(({ tool, label, icon: Icon }) => (
            <button key={tool} type="button" className={`bloommd-ink-button${state.tool === tool ? " is-active" : ""}`} title={label} aria-label={label} aria-pressed={state.tool === tool} onClick={() => dispatch({ type: "setTool", tool })}>
              <Icon size={18} />
            </button>
          ))}
          {palette.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`bloommd-ink-swatch${color === swatch ? " is-active" : ""}`}
              style={{ ["--bloommd-swatch" as string]: swatch }}
              title={`Color ${swatch}`}
              aria-label={`Color ${swatch}`}
              aria-pressed={color === swatch}
              disabled={state.tool === "eraser"}
              onClick={() => dispatch({ type: "setColor", color: swatch })}
            />
          ))}
          {onCreateNode && <button type="button" className="bloommd-ink-button" title="New node from selection" aria-label="New node from selection" disabled={state.selection.length === 0 || state.readOnly} onClick={() => void createNodeFromSelection()}><SquarePlus size={18} /></button>}
          <button type="button" className="bloommd-ink-button" title="Delete selection" aria-label="Delete selection" disabled={state.selection.length === 0} onClick={() => dispatch({ type: "deleteSelection" })}><Trash2 size={18} /></button>
          <button type="button" className="bloommd-ink-button" title="Undo" aria-label="Undo drawing" disabled={state.past.length === 0} onClick={() => dispatch({ type: "undo" })}><Undo2 size={18} /></button>
          <button type="button" className="bloommd-ink-button" title="Redo" aria-label="Redo drawing" disabled={state.future.length === 0} onClick={() => dispatch({ type: "redo" })}><Redo2 size={18} /></button>
        </MapInkBar>
      )}
    </>
  );
}
