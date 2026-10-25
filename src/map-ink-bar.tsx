import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, GripVertical } from "lucide-react";

/**
 * Where the map drawing tools sit. Like the tool palette in Apple Notes, the bar floats where it was
 * dropped, or docks vertically at the left or right edge when dropped near it, and can be folded so
 * it covers almost nothing of the map.
 */
export type BarDock = "float" | "left" | "right";

export interface BarPlacement {
  dock: BarDock;
  /** Position of the bar's top-left corner as a share (0–1) of the free space, so it survives resizes. */
  x: number;
  y: number;
  collapsed: boolean;
}

export interface Size {
  width: number;
  height: number;
}

export const BAR_MARGIN = 12;
/** Letting go of the grip this close to the left or right edge docks the bar there. */
export const DOCK_DISTANCE = 72;
const STORAGE_KEY = "bloommd:map-ink-bar:v1";

export const DEFAULT_PLACEMENT: BarPlacement = { dock: "float", x: 0.5, y: 0, collapsed: false };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Pixel position of the bar inside the map for a placement. */
export function barPosition(placement: BarPlacement, bar: Size, container: Size): { left: number; top: number } {
  const freeX = container.width - bar.width - 2 * BAR_MARGIN;
  const freeY = container.height - bar.height - 2 * BAR_MARGIN;
  const top = BAR_MARGIN + clamp(placement.y, 0, 1) * Math.max(0, freeY);
  if (placement.dock === "left") return { left: BAR_MARGIN, top };
  if (placement.dock === "right") return { left: BAR_MARGIN + Math.max(0, freeX), top };
  return { left: BAR_MARGIN + clamp(placement.x, 0, 1) * Math.max(0, freeX), top };
}

/**
 * Where a bar dropped at `left`/`top` settles. `pointerX` is where the finger let go inside the map:
 * near the left or right edge the bar docks there (a wide bar cannot get close to an edge itself).
 */
export function settleBar(drop: { left: number; top: number }, pointerX: number, bar: Size, container: Size, collapsed: boolean): BarPlacement {
  const freeX = Math.max(0, container.width - bar.width - 2 * BAR_MARGIN);
  const freeY = Math.max(0, container.height - bar.height - 2 * BAR_MARGIN);
  const dock: BarDock = pointerX < DOCK_DISTANCE ? "left" : pointerX > container.width - DOCK_DISTANCE ? "right" : "float";
  return {
    dock,
    x: freeX > 0 ? clamp((drop.left - BAR_MARGIN) / freeX, 0, 1) : 0,
    y: freeY > 0 ? clamp((drop.top - BAR_MARGIN) / freeY, 0, 1) : 0,
    collapsed,
  };
}

export function readPlacement(storage: Pick<Storage, "getItem"> | undefined): BarPlacement {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as Partial<BarPlacement> | null;
    if (!value || typeof value !== "object") return DEFAULT_PLACEMENT;
    return {
      dock: value.dock === "left" || value.dock === "right" ? value.dock : "float",
      x: typeof value.x === "number" && Number.isFinite(value.x) ? clamp(value.x, 0, 1) : DEFAULT_PLACEMENT.x,
      y: typeof value.y === "number" && Number.isFinite(value.y) ? clamp(value.y, 0, 1) : DEFAULT_PLACEMENT.y,
      collapsed: value.collapsed === true,
    };
  } catch {
    return DEFAULT_PLACEMENT;
  }
}

function writePlacement(placement: BarPlacement) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(placement));
  } catch {
    // Private mode or blocked storage: the bar simply starts at its default place next time.
  }
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Drag slop in pixels before the grip counts as dragged instead of tapped. */
const DRAG_SLOP = 4;

/**
 * The floating, draggable frame of the map drawing tools. `children` are the full tools, `compact`
 * what stays visible while folded (current tool, colour, undo). The grip, the fold button and `done`
 * always stay in view; only the tools between them scroll when the map is too narrow.
 */
export function MapInkBar({ children, compact, done }: { children: ReactNode; compact: ReactNode; done: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<BarPlacement>(() => readPlacement(browserStorage()));
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [settling, setSettling] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number; to: { left: number; top: number }; pointerX: number; moved: boolean; frame: number } | null>(null);

  const measure = useCallback((): { bar: Size; container: Size } | null => {
    const bar = barRef.current;
    const container = bar?.offsetParent as HTMLElement | null;
    if (!bar || !container) return null;
    return { bar: { width: bar.offsetWidth, height: bar.offsetHeight }, container: { width: container.clientWidth, height: container.clientHeight } };
  }, []);

  // Place the bar for its placement, and again whenever the map or the bar changes size.
  useLayoutEffect(() => {
    const place = () => {
      if (drag.current) return;
      const sizes = measure();
      if (sizes) setPosition(barPosition(placement, sizes.bar, sizes.container));
    };
    place();
    const bar = barRef.current;
    const container = bar?.offsetParent as HTMLElement | null;
    if (!bar || !container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, placement]);

  useEffect(() => () => {
    if (drag.current) window.cancelAnimationFrame(drag.current.frame);
  }, []);

  // Obsidian mobile reads raw touches too: pulling down opens the command palette, sideways swipes
  // open the sidebars. Touches on the tools belong to the tools.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const keep = (event: TouchEvent) => {
      event.stopPropagation();
      if (event.type === "touchmove" && drag.current && event.cancelable) event.preventDefault();
    };
    bar.addEventListener("touchstart", keep, { passive: true });
    bar.addEventListener("touchmove", keep, { passive: false });
    bar.addEventListener("touchend", keep, { passive: true });
    return () => {
      bar.removeEventListener("touchstart", keep);
      bar.removeEventListener("touchmove", keep);
      bar.removeEventListener("touchend", keep);
    };
  }, []);

  const update = (next: BarPlacement) => {
    setPlacement(next);
    writePlacement(next);
  };

  const onGripDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const bar = barRef.current;
    if (!bar) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; dragging still follows the events.
    }
    setSettling(false);
    // The finger may leave the grip (the bar stops at the map's edge), so follow it on the window.
    const move = (next: PointerEvent) => onGripMove(next);
    const up = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      onGripUp(next);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: bar.offsetLeft, top: bar.offsetTop, to: { left: bar.offsetLeft, top: bar.offsetTop }, pointerX: event.clientX, moved: false, frame: 0 };
  };

  const onGripMove = (event: PointerEvent) => {
    const current = drag.current;
    const bar = barRef.current;
    if (!current || !bar || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    current.pointerX = event.clientX;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!current.moved) {
      current.moved = true;
      bar.classList.add("is-dragging");
    }
    const sizes = measure();
    if (!sizes) return;
    current.to = {
      left: clamp(current.left + dx, BAR_MARGIN, sizes.container.width - sizes.bar.width - BAR_MARGIN),
      top: clamp(current.top + dy, BAR_MARGIN, sizes.container.height - sizes.bar.height - BAR_MARGIN),
    };
    // Follow the finger on the compositor: one transform per frame, no React render while dragging.
    window.cancelAnimationFrame(current.frame);
    current.frame = window.requestAnimationFrame(() => {
      bar.style.transform = `translate3d(${current.to.left - current.left}px, ${current.to.top - current.top}px, 0)`;
    });
  };

  const onGripUp = (event: PointerEvent) => {
    const current = drag.current;
    const bar = barRef.current;
    if (!current || !bar || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    window.cancelAnimationFrame(current.frame);
    drag.current = null;
    bar.classList.remove("is-dragging");
    if (!current.moved) return;
    // Lifting the finger after a drag must not click whatever ended up under it.
    const swallow = (click: MouseEvent) => {
      click.preventDefault();
      click.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
    const sizes = measure();
    const drop = current.to;
    // Swap the drag transform for the dropped position in the same frame, so nothing jumps.
    bar.setCssStyles({ transform: "", left: `${drop.left}px`, top: `${drop.top}px` });
    if (!sizes) return;
    const containerLeft = (bar.offsetParent as HTMLElement).getBoundingClientRect().left;
    // The last move is where the finger let go; a touch's pointerup does not always carry that point.
    const next = settleBar(drop, current.pointerX - containerLeft, sizes.bar, sizes.container, placement.collapsed);
    // Start the glide from where the bar was dropped, then let it slide into its settled place.
    setPosition(drop);
    setSettling(true);
    window.requestAnimationFrame(() => update(next));
  };

  const toggleCollapsed = () => update({ ...placement, collapsed: !placement.collapsed });
  const vertical = placement.dock !== "float";

  return (
    <div
      ref={barRef}
      className={`bloommd-ink-editor bloommd-map-ink-bar nopan nodrag nowheel${vertical ? " is-vertical" : ""}${placement.collapsed ? " is-collapsed" : ""}${settling ? " is-settling" : ""}`}
      role="toolbar"
      aria-label="Map drawing tools"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      data-dock={placement.dock}
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
      onTransitionEnd={() => setSettling(false)}
    >
      <button
        type="button"
        className="bloommd-ink-button bloommd-map-ink-grip"
        title="Move the tools (drop at the left or right edge to dock them)"
        aria-label="Move drawing tools"
        onPointerDown={onGripDown}
      >
        <GripVertical size={18} />
      </button>
      <div className="bloommd-map-ink-tools">{placement.collapsed ? compact : children}</div>
      <button
        type="button"
        className="bloommd-ink-button bloommd-map-ink-fold"
        title={placement.collapsed ? "Show all tools" : "Fold the tools"}
        aria-label={placement.collapsed ? "Show all drawing tools" : "Fold drawing tools"}
        aria-expanded={!placement.collapsed}
        onClick={toggleCollapsed}
      >
        {placement.collapsed ? <ChevronsUpDown size={18} /> : <ChevronsDownUp size={18} />}
      </button>
      {done}
    </div>
  );
}
