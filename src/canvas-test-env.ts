/**
 * Test-only stand-in for the browser layout the canvas depends on. happy-dom has no layout, so the
 * map pane gets the size a test sets (like a leaf Obsidian has laid out) and every other element,
 * the nodes, measures as a small box. ResizeObserver reports elements once after `observe`, and
 * `resizePane` stands in for the browser reporting a resized pane.
 */
import { act } from "preact/test-utils";

let paneSize = { width: 800, height: 600 };
const observers = new Set<{ notify(): void }>();

export const setPane = (size: { width: number; height: number }) => {
  paneSize = size;
};
export const resetPane = () => setPane({ width: 800, height: 600 });
export const resizePane = (size: { width: number; height: number }) => {
  setPane(size);
  act(() => observers.forEach((observer) => observer.notify()));
};

export function installCanvasDom() {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const create = () => document.createElement("div");
  // The helpers Obsidian adds to elements and the global the canvas mount uses.
  proto.createDiv = create;
  proto.empty = function (this: HTMLElement) {
    this.replaceChildren();
  };
  proto.addClass = function (this: HTMLElement, name: string) {
    this.classList.add(name);
  };
  Object.assign(globalThis, {
    createDiv: create,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(private readonly callback: (entries: Array<{ target: Element }>) => void) {
      observers.add(this);
    }
    notify() {
      this.deliver([]);
    }
    observe(target: Element) {
      // Like a browser, report the element once right after it is observed.
      queueMicrotask(() => this.deliver([{ target }]));
    }
    unobserve() {}
    disconnect() {
      observers.delete(this);
    }
    private deliver(entries: Array<{ target: Element }>) {
      try {
        this.callback(entries);
      } catch {
        // Observers of single nodes expect entries; only the pane and node observers matter here.
      }
    }
  };
  for (const [property, key, small] of [["offsetWidth", "width", 150], ["offsetHeight", "height", 40], ["clientWidth", "width", 150], ["clientHeight", "height", 40]] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("bloommd-flow-wrap") || this.classList.contains("react-flow") ? paneSize[key] : small;
      },
    });
  }
}
