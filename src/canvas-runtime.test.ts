import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "preact/test-utils";
import { createCanvasMount, renderMountFailure, type CanvasHeading, type CanvasMount, type CanvasProps } from "./canvas";
import { ensureHeadingIds, parseHeadingTree, type MarkdownHeadingNode } from "./markdown-document";
import { installCanvasDom, resizePane, resetPane, setPane } from "./canvas-test-env";

/**
 * Renders the real canvas (React Flow, error boundary) the way the Obsidian view mounts it, in
 * the same DOM and renderer the release bundle uses. Covers what the parser-level tests cannot:
 * what a person sees after `Visualize current note`, and that every failure leaves a way back.
 */

const demoPath = new URL("./fixtures/Obsidian Demo.md", import.meta.url);

function toHeadings(nodes: MarkdownHeadingNode[]): CanvasHeading[] {
  const result: CanvasHeading[] = [];
  const walk = (node: MarkdownHeadingNode, parentId: string | null) => {
    result.push({ id: node.id, parentId, level: node.level, title: node.title, content: node.content, children: node.children.map((child) => child.id), kind: "heading" });
    node.children.forEach((child) => walk(child, node.id));
  };
  nodes.forEach((node) => walk(node, null));
  return result;
}

function demoHeadings() {
  const tree = parseHeadingTree(ensureHeadingIds(readFileSync(demoPath, "utf8")).markdown);
  return { headings: toHeadings(tree), rootId: tree[0]!.id };
}

const calls: string[] = [];
const noop = new Proxy({}, {
  get: (_target, name) => (name === "openMarkdown" ? () => calls.push("back") : name === "reloadNote" ? undefined : () => Promise.resolve(null)),
});

/** Headings that throw when the canvas reads them, i.e. inside React's render, not while props are built. */
const throwingHeadings = () => new Proxy([], { get: () => { throw new Error("boom in render"); } }) as unknown as CanvasHeading[];

function props(overrides: Partial<CanvasProps> = {}): CanvasProps {
  const { headings, rootId } = demoHeadings();
  return {
    filePath: "Aufnahmen/Obsidian Demo.md",
    headings,
    rootId,
    files: [{ path: "Aufnahmen/Obsidian Demo.md", title: "Obsidian Demo" }],
    resources: [],
    backlinks: [],
    layout: { positions: {}, collapsed: [] },
    canUndo: false,
    canRedo: false,
    showNodeContent: true,
    actions: noop as unknown as CanvasProps["actions"],
    ...overrides,
  };
}

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
let container: HTMLElement;
let mount: CanvasMount | null = null;

beforeAll(installCanvasDom);

afterEach(() => {
  act(() => mount?.unmount());
  mount = null;
  container?.remove();
  calls.length = 0;
  resetPane();
});

async function show(next: CanvasProps) {
  container ??= document.createElement("div");
  if (!container.isConnected) document.body.appendChild(container);
  mount ??= createCanvasMount(container);
  act(() => mount!.render(next));
  await act(() => wait(60));
  return container;
}

const nodeTitles = () => [...container.querySelectorAll(".react-flow__node")].map((node) => node.textContent ?? "");
const button = (label: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label) as HTMLButtonElement | undefined;
const alert = () => container.querySelector('[role="alert"]');

describe("canvas runtime: shared workspace cards", () => {
  test("folder and file cards use the shared presentation and open the real source once", async () => {
    const opened: string[] = [];
    const actions = new Proxy(props().actions, { get: (target, key) => key === "openFile" ? (path: string) => opened.push(path) : Reflect.get(target, key) });
    const headings: CanvasHeading[] = [
      { id: "folder:Team", parentId: null, level: 1, title: "Team", content: "Team", children: ["file:Team/Plan.md"], kind: "folder", filePath: "Team" },
      { id: "file:Team/Plan.md", parentId: "folder:Team", level: 2, title: "Plan", content: "Team/Plan.md", children: [], kind: "file", filePath: "Team/Plan.md" },
    ];
    const next = props({ locale: "de", headings, rootId: "folder:Team", actions });
    await show(next);
    expect(alert()).toBeNull();
    expect(container.querySelectorAll(".bloommd-workspace-node")).toHaveLength(2);
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(1);
    expect(container.querySelector('[data-workspace-kind="folder"]')?.textContent).toContain("Ordner");
    const file = container.querySelector('[data-workspace-kind="file"]')!;
    expect(file.textContent).toContain("Markdown-Datei");
    expect(file.querySelector(".bloommd-workspace-path")?.textContent).toBe("Team/Plan.md");
    expect(file.querySelector(".bloommd-node-preview")).toBeNull();
    const open = file.querySelector<HTMLButtonElement>('[aria-label="Datei öffnen: Team/Plan.md"]')!;
    act(() => open.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })));
    await act(() => wait(650));
    expect(file.classList.contains("is-press-armed")).toBe(false);
    act(() => open.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, pointerType: "touch" })));
    act(() => open.click());
    // The button must not trigger the node's double-click navigation as well.
    act(() => open.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true })));
    expect(opened).toEqual(["Team/Plan.md"]);
    act(() => mount!.render({ ...next, locale: "en" }));
    await act(() => wait(30));
    expect(container.querySelector('[aria-label="Open file: Team/Plan.md"]')).not.toBeNull();
  });
});

describe("canvas runtime: the demo note", () => {
  test("renders as a mind map with the root and every heading branch", async () => {
    await show(props());
    expect(alert()).toBeNull();
    const titles = nodeTitles();
    expect(titles).toHaveLength(8);
    expect(titles[0]).toContain("Obsidian Demo");
    for (const branch of ["Projekt", "Quellen", "Struktur", "Recording Check"]) expect(titles.some((title) => title.includes(branch))).toBe(true);
    for (const leaf of ["Zielgruppe", "Map", "Markdown"]) expect(titles.some((title) => title.includes(leaf))).toBe(true);
  });

  test("shows the toolbar with Back to Markdown next to the map", async () => {
    await show(props());
    expect(container.querySelector('[aria-label="Back to Markdown"]')).not.toBeNull();
  });
});

describe("canvas runtime: failures always leave a way back", () => {
  test("a render error inside the canvas shows the error state with Back to Markdown", async () => {
    const broken = props({ headings: throwingHeadings() });
    const consoleError = console.error;
    console.error = () => {};
    try {
      await show(broken);
    } finally {
      console.error = consoleError;
    }
    expect(alert()?.textContent).toContain("boom in render");
    act(() => button("Back to Markdown")!.click());
    expect(calls).toEqual(["back"]);
    expect(nodeTitles()).toEqual([]);
  });

  test("the error state clears when another note is shown", async () => {
    const broken = props({ headings: throwingHeadings() });
    const consoleError = console.error;
    console.error = () => {};
    try {
      await show(broken);
    } finally {
      console.error = consoleError;
    }
    expect(alert()).not.toBeNull();
    await show(props({ filePath: "Other.md" }));
    expect(alert()).toBeNull();
    expect(nodeTitles()).toHaveLength(8);
  });

  test("a load error from the view is shown instead of the map, with Back to Markdown and Try again", async () => {
    let reloaded = 0;
    const actions = new Proxy(noop, { get: (target, name) => (name === "reloadNote" ? () => { reloaded += 1; } : (target as Record<string | symbol, unknown>)[name]) }) as unknown as CanvasProps["actions"];
    await show(props({ loadError: "Vault is locked", actions }));
    expect(alert()?.textContent).toContain("Vault is locked");
    expect(nodeTitles()).toEqual([]);
    act(() => button("Try again")!.click());
    expect(reloaded).toBe(1);
    act(() => button("Back to Markdown")!.click());
    expect(calls).toEqual(["back"]);
  });

  test("without a retry action the load error offers only the way back", async () => {
    await show(props({ loadError: "Vault is locked" }));
    expect(button("Try again")).toBeUndefined();
    expect(button("Back to Markdown")).toBeDefined();
  });

  test("a map without headings offers Back to Markdown", async () => {
    await show(props({ headings: [], rootId: "" }));
    expect(container.textContent).toContain("No Markdown headings found");
    act(() => button("Back to Markdown")!.click());
    expect(calls).toEqual(["back"]);
  });

  test("a view without a note says so and offers Back to Markdown", async () => {
    await show(props({ filePath: "", headings: [], rootId: "" }));
    expect(container.textContent).toContain("No note is open in this map");
    act(() => button("Back to Markdown")!.click());
    expect(calls).toEqual(["back"]);
  });

  test("the plain-DOM fallback for a failed mount carries the message and Back to Markdown", () => {
    const host = document.createElement("div");
    host.appendChild(document.createElement("span"));
    renderMountFailure(host, "createRoot failed", () => calls.push("back"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("createRoot failed");
    expect(host.querySelector("span")).toBeNull();
    (host.querySelector("button") as HTMLButtonElement).click();
    expect(calls).toEqual(["back"]);
  });
});

describe("canvas runtime: first fit waits for a measured pane", () => {
  const viewportTransform = () => (container.querySelector(".react-flow__viewport") as HTMLElement | null)?.style.transform ?? "";

  test("a pane that is still 0×0 is not fitted; the map fits once it has a size", async () => {
    setPane({ width: 0, height: 0 });
    await show(props());
    await act(() => wait(300));
    const before = viewportTransform();
    // Still React Flow's default viewport: nothing was fitted into the unmeasured pane.
    expect(before).toBe("translate(30px,30px) scale(0.9)");
    resizePane({ width: 800, height: 600 });
    // The fit animates; wait until it has settled on a real viewport.
    for (let waited = 0; waited < 2000 && (viewportTransform() === before || viewportTransform().includes("NaN")); waited += 50) await act(() => wait(50));
    expect(viewportTransform()).not.toBe(before);
    expect(viewportTransform()).not.toContain("NaN");
  });
});

describe("folder previews stay read-only in the canvas", () => {
  test("offers source navigation and lazy loading, with no inline editor or mutation shortcuts", async () => {
    const observed: unknown[][] = [];
    const actions = new Proxy(props().actions, { get: (_target, key) => (...args: unknown[]) => { observed.push([key, ...args]); return Promise.resolve(null); } });
    const headings: CanvasHeading[] = [
      { id: "folder:Team", parentId: null, level: 1, title: "Team", content: "", children: ["file:Team/Plan.md"], kind: "folder", filePath: "Team" },
      { id: "file:Team/Plan.md", parentId: "folder:Team", level: 2, title: "Plan", content: "", children: ["preview"], kind: "file", filePath: "Team/Plan.md", previewState: "unloaded" },
      { id: "preview", parentId: "file:Team/Plan.md", level: 3, title: "Section", content: "Preview content", children: [], kind: "heading", filePath: "Team/Plan.md", sourceHeadingId: "source-section" },
    ];
    await show(props({ headings, rootId: "folder:Team", filePath: "folder:Team", overview: true, actions }));
    expect(container.querySelector('[aria-label="Editing tools"]')).toBeNull();
    const load = container.querySelector<HTMLButtonElement>('[aria-label="Show contents"]')!;
    act(() => load.click());
    await act(() => wait(30));
    expect(observed.some(([action, path]) => action === "loadFolderPreview" && path === "Team/Plan.md")).toBe(true);
    const preview = container.querySelector<HTMLElement>('[data-id="preview"] .bloommd-workspace-node')!;
    act(() => preview.click());
    await act(() => wait(30));
    for (const key of ["F2", "Delete", "Tab"]) act(() => preview.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
    act(() => preview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true })));
    expect(preview.querySelector("input")).toBeNull();
    expect(container.querySelector(".bloommd-inspector")).toBeNull();
    expect(observed.some(([action]) => ["renameNode", "deleteNode", "addChild", "copyBranches"].includes(String(action)))).toBe(false);
    act(() => button("Edit section")!.click());
    expect(observed).toContainEqual(["openOverviewSource", "Team/Plan.md", "source-section"]);
  });
});


test("node search reveals a folded heading by file path without opening the inspector", async () => {
  const headings: CanvasHeading[] = [
    { id: "root", parentId: null, level: 1, title: "Root", content: "", children: ["branch"], kind: "heading" },
    { id: "branch", parentId: "root", level: 2, title: "Branch", content: "", children: ["target"], kind: "heading" },
    { id: "target", parentId: "branch", level: 3, title: "Target", content: "", children: [], kind: "heading", filePath: "Team/Plan.md" },
  ];
  await show(props({ headings, rootId: "root", layout: { positions: {}, collapsed: ["branch"] } }));
  expect(container.querySelector('[data-id="target"]')).toBeNull();
  const input = container.querySelector('input[aria-label="Find node"]') as HTMLInputElement;
  await act(async () => {
    input.value = "Team/Plan.md";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await wait();
  });
  const match = container.querySelector(".bloommd-search-results button") as HTMLButtonElement;
  expect(match.textContent).toContain("Target");
  await act(async () => { match.click(); await wait(100); });
  await act(() => wait(100));
  await act(() => wait(100));
  expect(container.querySelector('[data-id="target"]')).not.toBeNull();
  expect(container.querySelector('[data-id="target"]')?.classList.contains("selected")).toBe(true);
  expect(container.querySelector(".bloommd-inspector")).toBeNull();
});
