import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PALM_CLICK_ECHO_MS, PALM_ECHO_MS, capturePalmTouches } from "./map-touch-capture";
import { PEN_COOLDOWN_MS, PalmGuard } from "./pen-gestures";

type TouchInit = { id: number; x?: number; y?: number; stylus?: boolean };

let host: HTMLElement;
let target: HTMLElement;
let palm: PalmGuard;
let release: () => void;
let reached: string[];
let firstFingers: number;

function stamp<T extends Event>(event: T, at: number): T {
  Object.defineProperty(event, "timeStamp", { value: at });
  return event;
}

function touch(type: string, at: number, touches: TouchInit[]) {
  const changedTouches = touches.map(({ id, x = 100, y = 100, stylus }) => ({ identifier: id, clientX: x, clientY: y, ...(stylus ? { touchType: "stylus" } : {}) }));
  const event = new window.TouchEvent(type, { bubbles: true, cancelable: true, changedTouches } as unknown as TouchEventInit);
  target.dispatchEvent(stamp(event, at));
}

function pointer(type: string, at: number, pointerId: number, x = 100, y = 100, pointerType = "touch") {
  target.dispatchEvent(stamp(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType, clientX: x, clientY: y }), at));
}

function mouse(type: string, at: number, x = 100, y = 100) {
  target.dispatchEvent(stamp(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }), at));
}

beforeEach(() => {
  host = document.createElement("div");
  target = document.createElement("div");
  host.appendChild(target);
  document.body.appendChild(host);
  palm = new PalmGuard();
  reached = [];
  firstFingers = 0;
  // React Flow listens below the host; whatever arrives here would move or select on the map.
  for (const type of ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup", "mousedown", "mouseup", "click"]) {
    target.addEventListener(type, () => reached.push(type));
  }
  release = capturePalmTouches(host, palm, { exempt: "button", onFirstFinger: () => { firstFingers += 1; } });
});

afterEach(() => {
  release();
  host.remove();
});

describe("capturePalmTouches", () => {
  test("fingers reach the map while no pen is near", () => {
    pointer("pointerdown", 0, 1);
    touch("touchstart", 1, [{ id: 1 }]);
    touch("touchmove", 10, [{ id: 1, x: 140 }]);
    touch("touchend", 20, [{ id: 1, x: 140 }]);
    mouse("click", 25, 140);
    expect(reached).toEqual(["pointerdown", "touchstart", "touchmove", "touchend", "click"]);
    expect(firstFingers).toBe(1);
  });

  test("pen touches never reach the map", () => {
    touch("touchstart", 0, [{ id: 9, stylus: true }]);
    touch("touchmove", 5, [{ id: 9, stylus: true }]);
    touch("touchend", 10, [{ id: 9, stylus: true }]);
    expect(reached).toEqual([]);
  });

  test("a palm landing while the pen writes is swallowed with its pointer and click echoes", () => {
    palm.penDown(0, 5);
    pointer("pointerdown", 100, 21, 300, 200);
    touch("touchstart", 101, [{ id: 3, x: 300, y: 200 }]);
    pointer("pointermove", 120, 21, 310, 205);
    touch("touchmove", 121, [{ id: 3, x: 310, y: 205 }]);
    palm.penUp(150, 5);
    pointer("pointerup", 160, 21, 310, 205);
    touch("touchend", 161, [{ id: 3, x: 310, y: 205 }]);
    mouse("mousedown", 170, 310, 205);
    mouse("mouseup", 171, 310, 205);
    mouse("click", 172, 310, 205);
    // Ends always reach React Flow so it never keeps a stale finger.
    expect(reached).toEqual(["touchend"]);
  });

  test("a touch that arrives before its pointer event still blocks the pointer", () => {
    palm.penDown(0, 5);
    touch("touchstart", 100, [{ id: 3, x: 300, y: 200 }]);
    palm.penUp(105, 5);
    // Cooldown alone would block too; move past it to prove the echo match.
    pointer("pointerdown", 100 + PALM_ECHO_MS, 21, 302, 201);
    expect(reached).toEqual([]);
  });

  test("echo windows are short and local", () => {
    palm.penDown(0, 5);
    touch("touchstart", 10, [{ id: 3, x: 300, y: 200 }]);
    palm.penUp(20, 5);
    touch("touchend", 30, [{ id: 3, x: 300, y: 200 }]);
    // Somewhere else, or long after the cooldown and the click echo, events pass again.
    const later = 20 + PEN_COOLDOWN_MS + PALM_CLICK_ECHO_MS + 1;
    mouse("click", 35, 600, 600);
    pointer("pointerdown", later, 22, 300, 200);
    mouse("click", later + 1, 300, 200);
    expect(reached).toEqual(["touchend", "click", "pointerdown", "click"]);
  });

  test("a finger landing in the same touch event as the pen is tracked and blocked", () => {
    touch("touchstart", 0, [{ id: 9, stylus: true }, { id: 4, x: 400, y: 300 }]);
    expect(palm.touching).toBe(1);
    palm.penDown(1, 5);
    expect(palm.isBlocked(4)).toBe(true);
    touch("touchmove", 10, [{ id: 4, x: 420, y: 300 }]);
    touch("touchend", 20, [{ id: 4, x: 420, y: 300 }]);
    expect(palm.touching).toBe(0);
    expect(reached).toEqual(["touchend"]);
  });

  test("buttons keep working right after the pen lifts", () => {
    const button = document.createElement("button");
    host.appendChild(button);
    button.addEventListener("click", () => reached.push("button click"));
    palm.penDown(0, 5);
    palm.penUp(10, 5);
    const at = 20;
    button.dispatchEvent(stamp(new window.PointerEvent("pointerdown", { bubbles: true, pointerId: 30, pointerType: "touch", clientX: 100, clientY: 100 }), at));
    button.dispatchEvent(stamp(new window.MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 }), at + 5));
    expect(reached).toEqual(["button click"]);
  });

  test("released listeners leave the host alone", () => {
    release();
    palm.penDown(0, 5);
    touch("touchstart", 10, [{ id: 9, stylus: true }]);
    expect(reached).toEqual(["touchstart"]);
    release = () => undefined;
  });
});
