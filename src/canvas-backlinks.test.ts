import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act } from "preact/test-utils";
import { createCanvasMount, type CanvasHeading, type CanvasMount, type CanvasProps, type PersistedCanvasLayout } from "./canvas";
import type { BacklinkResolver } from "./concept-map";
import { installCanvasDom, resetPane } from "./canvas-test-env";

/**
 * Backlink edges are a display mode: switching it on and off draws and removes edges and
 * warnings, remembers the choice in the layout, and never writes to the note.
 */

const heading = (id: string, parentId: string | null, title: string, content = ""): CanvasHeading => ({
  id,
  parentId,
  level: parentId ? 2 : 1,
  title,
  content,
  children: [],
  kind: "heading",
});

const headings = () => {
  const list = [
    heading("r", null, "Map"),
    heading("a", "r", "Alpha", "Needs [[#Beta]] and [[#Nowhere]] and [[#Echo]]"),
    heading("b", "r", "Beta"),
    heading("e1", "r", "Echo"),
    heading("e2", "r", "Echo"),
  ];
  list[0]!.children = ["a", "b", "e1", "e2"];
  return list;
};

const resolver: BacklinkResolver = { notePath: "Note.md", resolve: (link) => (link === "Note" ? "Note.md" : null) };

const calls: string[] = [];
const layouts: PersistedCanvasLayout[] = [];
const actions = new Proxy({}, {
  get: (_target, name) => (name === "persistLayout"
    ? (layout: PersistedCanvasLayout) => layouts.push(layout)
    : name === "reloadNote" ? undefined : (..._args: unknown[]) => {
      calls.push(String(name));
      return Promise.resolve(null);
    }),
}) as unknown as CanvasProps["actions"];

function props(overrides: Partial<CanvasProps> = {}): CanvasProps {
  return {
    filePath: "Note.md",
    headings: headings(),
    rootId: "r",
    files: [{ path: "Note.md", title: "Note" }],
    resources: [],
    backlinks: [],
    linkResolver: resolver,
    layout: { positions: {}, collapsed: [] },
    canUndo: false,
    canRedo: false,
    showNodeContent: true,
    actions,
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
  layouts.length = 0;
  resetPane();
});

async function show(next: CanvasProps) {
  container ??= document.createElement("div");
  if (!container.isConnected) document.body.appendChild(container);
  mount ??= createCanvasMount(container);
  act(() => mount!.render(next));
  await act(() => wait(80));
}

const toggle = () => container.querySelector<HTMLButtonElement>('button[title="Backlink edges"]');
const backlinkEdges = () => container.querySelectorAll('.react-flow__edge[data-id^="backlink:"]');
const warnings = () => [...container.querySelectorAll(".bloommd-backlink-warning")];
const click = async (element: HTMLElement) => {
  act(() => element.click());
  await act(() => wait(80));
};

describe("canvas backlink edges", () => {
  test("are off by default: no edges, no warnings, the button is not pressed", async () => {
    await show(props());
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
    expect(backlinkEdges()).toHaveLength(0);
    expect(warnings()).toHaveLength(0);
  });

  test("the button is not offered without link resolution", async () => {
    await show(props({ linkResolver: undefined }));
    expect(toggle()).toBeNull();
  });

  test("switching on draws the edge and warns about broken and ambiguous links; switching off removes both", async () => {
    await show(props());
    await click(toggle()!);
    expect(toggle()?.getAttribute("aria-pressed")).toBe("true");
    const edges = [...backlinkEdges()];
    expect(edges.map((edge) => edge.getAttribute("data-id"))).toEqual(["backlink:a:b"]);
    expect(edges[0]!.querySelector(".bloommd-backlink-edge")).not.toBeNull();
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]!.getAttribute("title")).toBe("#Nowhere (broken)\n#Echo (ambiguous)");

    await click(toggle()!);
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
    expect(backlinkEdges()).toHaveLength(0);
    expect(warnings()).toHaveLength(0);
  });

  test("backlink edges cannot be selected or deleted", async () => {
    await show(props({ layout: { positions: {}, collapsed: [], backlinks: true } }));
    const edge = backlinkEdges()[0] as HTMLElement;
    expect(edge).toBeDefined();
    act(() => edge.dispatchEvent(new (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent("click", { bubbles: true })));
    await act(() => wait(40));
    expect(edge.classList.contains("selected")).toBe(false);
    expect(edge.getAttribute("tabindex")).toBeNull();
    act(() => container.dispatchEvent(new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    expect(calls.filter((name) => name === "deleteBranch" || name === "updateMetadata")).toEqual([]);
  });

  test("the choice is stored in the layout, and a stored choice is restored", async () => {
    await show(props());
    await click(toggle()!);
    expect(layouts.at(-1)?.backlinks).toBe(true);
    await click(toggle()!);
    expect(layouts.at(-1)?.backlinks).toBe(false);
    act(() => mount?.unmount());
    mount = null;
    container.remove();
    container = undefined as unknown as HTMLElement;
    await show(props({ layout: { positions: {}, collapsed: [], backlinks: true } }));
    expect(toggle()?.getAttribute("aria-pressed")).toBe("true");
    expect(backlinkEdges()).toHaveLength(1);
  });

  test("toggling never writes to the note", async () => {
    await show(props());
    await click(toggle()!);
    await click(toggle()!);
    await click(toggle()!);
    const writes = ["renameNode", "updateContent", "updateMetadata", "addChild", "addSibling", "deleteBranch", "reparentBranch", "copyBranches", "linkNote", "saveInk", "saveMapInk", "createNodeFromInk", "undo", "redo", "saveExport"];
    expect(calls.filter((name) => writes.includes(name))).toEqual([]);
    // Only the layout (plugin data, not Markdown) is saved.
    expect(layouts[0]?.backlinks).toBe(true);
    expect(layouts.some((layout) => layout.backlinks === false)).toBe(true);
  });
});
