import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LearningEntry } from "./learning";
import { LearningStatus, RatingButtons, branchProgress } from "./learning-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(element: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const mastered: LearningEntry = { level: 2, of: 3, due: "2026-10-14", lastReviewed: "2026-10-10T08:00:00Z", streak: 1 };

describe("branch progress", () => {
  test("counts mastered cards in each node's branch", () => {
    const headings = [
      { id: "root", parentId: null },
      { id: "a", parentId: "root" },
      { id: "a1", parentId: "a" },
      { id: "b", parentId: "root" },
    ];
    const progress = branchProgress(headings, ["a", "a1", "b"], { a1: mastered, b: { ...mastered, level: 1 } }, 3);
    expect(progress.get("root")).toEqual({ mastered: 1, total: 3 });
    expect(progress.get("a")).toEqual({ mastered: 1, total: 2 });
    expect(progress.get("b")).toEqual({ mastered: 0, total: 1 });
  });
});

describe("rating buttons", () => {
  test("one button per level, the current level pressed, a tap rates without selecting the node", () => {
    const rated: number[] = [];
    let nodeClicks = 0;
    const element = mount(createElement("div", { onClick: () => { nodeClicks += 1; } },
      createElement(RatingButtons, { title: "Zelle", names: ["New", "Unsure", "Got it"], colors: ["#e5484d", "#f5a524", "#30a46c"], level: 1, onRate: (level: number) => rated.push(level) })));
    const buttons = [...element.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["New", "Unsure", "Got it"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(buttons[2]!.getAttribute("style")).toContain("--bloommd-learn: #30a46c");
    act(() => buttons[2]!.click());
    expect(rated).toEqual([2]);
    expect(nodeClicks).toBe(0);
  });
});

describe("study bar progress", () => {
  const status = (overrides: Partial<Parameters<typeof LearningStatus>[0]> = {}) => createElement(LearningStatus, {
    summary: { total: 30, rated: 20, mastered: 12, due: 5, unsure: 8 },
    spaced: true,
    order: "due",
    onOrder: () => undefined,
    onNext: () => undefined,
    examDate: "2026-10-15",
    today: "2026-10-10",
    onExamDate: () => undefined,
    ...overrides,
  });

  test("shows mastered and due counts, the exam countdown and a daily plan", () => {
    const text = mount(status()).textContent ?? "";
    expect(text).toContain("12/30 mastered · 5 due");
    // 18 nodes not mastered over 6 days (exam day included).
    expect(text).toContain("5 d left · 3/day");
  });

  test("without spaced repetition there is no due count and no due-based order", () => {
    const element = mount(status({ spaced: false, order: "map" }));
    expect(element.textContent).toContain("12/30 mastered");
    expect(element.textContent).not.toContain("due");
    const options = [...element.querySelectorAll("option")].map((option) => option.value);
    expect(options).toEqual(["map", "onlyUnsure"]);
  });
});
