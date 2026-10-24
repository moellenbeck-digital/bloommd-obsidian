import type { PalmGuard } from "./pen-gestures";

/** A pointer or mouse event this close in time to a blocked touch is that touch's echo. */
export const PALM_ECHO_MS = 50;
/** The click a browser synthesizes after a touch ends may trail it a little longer. */
export const PALM_CLICK_ECHO_MS = 350;
/** Screen distance within which an echo event belongs to a blocked touch. */
const ECHO_DISTANCE = 24;

interface BlockedSpot {
  x: number;
  y: number;
  at: number;
}

export interface PalmCaptureOptions {
  /** Called before the first finger of a new gesture is tracked, to remember where the view was. */
  onFirstFinger?: () => void;
  /** Elements whose pointer and click events always pass, such as toolbar buttons. */
  exempt?: string;
}

const isStylus = (touch: Touch) => (touch as Touch & { touchType?: string }).touchType === "stylus";

/**
 * Keeps the writing hand away from React Flow while drawing on the map. iPadOS reports Apple Pencil
 * as touches too (touchType "stylus"), and React Flow pans, drags and selects on touch, pointer and
 * click events. Pen touches, touches of the hand resting while the pen writes, and the pointer and
 * click events the browser derives from those touches are stopped in the capture phase.
 *
 * Returns a function that removes the listeners.
 */
export function capturePalmTouches(host: HTMLElement, palm: PalmGuard, options: PalmCaptureOptions = {}): () => void {
  const blockedPointers = new Set<number>();
  let spots: BlockedSpot[] = [];
  const remember = (x: number, y: number, at: number) => {
    spots = spots.filter((spot) => at - spot.at < 1_000);
    spots.push({ x, y, at });
  };
  const echoOfBlocked = (x: number, y: number, at: number, window: number) =>
    spots.some((spot) => Math.abs(at - spot.at) <= window && Math.hypot(spot.x - x, spot.y - y) <= ECHO_DISTANCE);
  const exempt = (event: Event) => {
    const target = event.target as Partial<Element> | null;
    return Boolean(options.exempt && typeof target?.closest === "function" && target.closest(options.exempt));
  };
  const swallow = (event: Event) => {
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
  };

  const onTouchStart = (event: TouchEvent) => {
    const changed = [...event.changedTouches];
    const stylus = changed.some(isStylus);
    let blocked = false;
    // A finger landing in the same event as the pen is tracked too, so it is blocked like any palm.
    for (const touch of changed) {
      if (isStylus(touch)) continue;
      if (palm.touching === 0) options.onFirstFinger?.();
      if (palm.touchStart(touch.identifier, event.timeStamp)) {
        blocked = true;
        remember(touch.clientX, touch.clientY, event.timeStamp);
      }
    }
    if (stylus || blocked) event.stopPropagation();
  };
  const onTouchMove = (event: TouchEvent) => {
    const changed = [...event.changedTouches];
    if (changed.some(isStylus) || palm.touchMove(changed.filter((touch) => !isStylus(touch)).map((touch) => touch.identifier))) event.stopPropagation();
  };
  const onTouchEnd = (event: TouchEvent) => {
    // Ends always reach React Flow so it never keeps a stale finger in a pinch.
    const changed = [...event.changedTouches];
    if (changed.some(isStylus)) event.stopPropagation();
    for (const touch of changed) {
      if (isStylus(touch)) continue;
      if (palm.isBlocked(touch.identifier)) remember(touch.clientX, touch.clientY, event.timeStamp);
      palm.touchEnd(touch.identifier);
    }
  };

  // Pointer ids are not touch identifiers, so a touch pointer is matched to the palm decision by
  // time: the same rule PalmGuard applies, or a blocked touch at the same spot a moment ago.
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || exempt(event)) return;
    if (palm.blocksNewTouch(event.timeStamp) || echoOfBlocked(event.clientX, event.clientY, event.timeStamp, PALM_ECHO_MS)) {
      blockedPointers.add(event.pointerId);
      remember(event.clientX, event.clientY, event.timeStamp);
      swallow(event);
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (blockedPointers.has(event.pointerId)) event.stopPropagation();
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (!blockedPointers.delete(event.pointerId)) return;
    remember(event.clientX, event.clientY, event.timeStamp);
    event.stopPropagation();
  };
  const onMouseEcho = (event: MouseEvent) => {
    if (exempt(event)) return;
    if (echoOfBlocked(event.clientX, event.clientY, event.timeStamp, event.type === "mousedown" ? PALM_ECHO_MS : PALM_CLICK_ECHO_MS)) swallow(event);
  };

  const listeners: Array<[string, EventListener]> = [
    ["touchstart", onTouchStart as EventListener],
    ["touchmove", onTouchMove as EventListener],
    ["touchend", onTouchEnd as EventListener],
    ["touchcancel", onTouchEnd as EventListener],
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerEnd as EventListener],
    ["pointercancel", onPointerEnd as EventListener],
    ["mousedown", onMouseEcho as EventListener],
    ["mouseup", onMouseEcho as EventListener],
    ["click", onMouseEcho as EventListener],
  ];
  for (const [type, listener] of listeners) host.addEventListener(type, listener, true);
  return () => {
    for (const [type, listener] of listeners) host.removeEventListener(type, listener, true);
  };
}
