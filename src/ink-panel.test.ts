import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInkDocument, parseInkSvg, serializeInkSvg, type InkDocument } from "./ink-document";
import { useInkSession, type InkVaultActions } from "./ink-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Session = ReturnType<typeof useInkSession>;
type SaveCall = { path: string | null; svg: string; expected: string | null; conflictOf?: string };

const withStrokes = (...ids: string[]): InkDocument => ({
  ...createInkDocument(),
  strokes: ids.map((id, index) => ({ id, tool: "pen", color: "#000", size: 3, points: [[index * 10, 0, 0.5], [index * 10 + 5, 5, 0.5]] })),
});

const strokeIds = (svg: string) => parseInkSvg(svg)!.document.strokes.map((stroke) => stroke.id);

/** An in-memory vault whose files can be changed "elsewhere" to provoke conflicts. */
function fakeVault() {
  const files = new Map<string, string>();
  const calls: SaveCall[] = [];
  let created = 0;
  const saveInk: InkVaultActions["saveInk"] = async (path, svg, expected, conflictOf) => {
    calls.push({ path, svg, expected, conflictOf });
    if (path) {
      if (!files.has(path) || (expected !== null && files.get(path) !== expected)) return null;
      files.set(path, svg);
      return path;
    }
    created += 1;
    const name = conflictOf ? conflictOf.replace(/\.svg$/, ` (conflict ${created}).svg`) : `Drawing ${created}.svg`;
    files.set(name, svg);
    return name;
  };
  const actions = (save = saveInk): InkVaultActions => ({
    pickNote: async () => null,
    readInk: async (path) => files.get(path) ?? null,
    saveInk: save,
    resolveEmbed: () => null,
    resourceUrl: () => "",
    onHoverLink: () => undefined,
    onOpenLink: () => undefined,
  });
  return { files, calls, saveInk, actions };
}

let root: Root | null = null;

function mountSession(initial: InkVaultActions) {
  const ref: { current: Session | null } = { current: null };
  let actions = initial;
  function Harness() {
    ref.current = useInkSession(actions);
    return null;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(createElement(Harness)));
  return {
    get session() {
      return ref.current!;
    },
    /** Re-renders with new vault actions, as the canvas does whenever the view state changes. */
    rerender(next: InkVaultActions) {
      actions = next;
      act(() => root!.render(createElement(Harness)));
    },
  };
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
});

describe("useInkSession", () => {
  test("continues in a copy after the file changed elsewhere and never drops strokes", async () => {
    const vault = fakeVault();
    vault.files.set("Note ink.svg", serializeInkSvg(withStrokes("a")));
    const hook = mountSession(vault.actions());
    await act(() => hook.session.open("Note ink.svg"));

    vault.files.set("Note ink.svg", serializeInkSvg(withStrokes("other device")));
    act(() => hook.session.change(withStrokes("a", "b")));
    await act(() => hook.session.flush());

    expect(strokeIds(vault.files.get("Note ink.svg")!)).toEqual(["other device"]);
    const copy = hook.session.conflictCopy!;
    expect(copy).toBe("Note ink (conflict 1).svg");
    expect(vault.calls.at(-1)?.conflictOf).toBe("Note ink.svg");
    expect(strokeIds(vault.files.get(copy)!)).toEqual(["a", "b"]);
    expect(hook.session.session?.path).toBe(copy);
    expect(hook.session.saveState).toBe("saved");

    // Later strokes go to the copy with a fresh baseline instead of failing again.
    act(() => hook.session.change(withStrokes("a", "b", "c")));
    await act(() => hook.session.flush());
    expect(strokeIds(vault.files.get(copy)!)).toEqual(["a", "b", "c"]);
    expect(vault.calls.filter((call) => call.path === null)).toHaveLength(1);
  });

  test("pauses autosave when even the copy fails and keeps the drawing open on close", async () => {
    const vault = fakeVault();
    vault.files.set("Note ink.svg", serializeInkSvg(withStrokes("a")));
    let writable = false;
    const hook = mountSession(vault.actions(async (...args) => (writable ? vault.saveInk(...args) : (vault.calls.push({ path: args[0], svg: args[1], expected: args[2] }), null))));
    await act(() => hook.session.open("Note ink.svg"));

    act(() => hook.session.change(withStrokes("a", "b")));
    await act(() => hook.session.flush());
    expect(hook.session.saveState).toBe("conflict");
    const attempts = vault.calls.length;

    // No timer is armed while saving fails: no repeating save attempts or notices.
    act(() => hook.session.change(withStrokes("a", "b", "c")));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(vault.calls.length).toBe(attempts);

    let closed = true;
    await act(async () => { closed = await hook.session.close(); });
    expect(closed).toBe(false);
    expect(hook.session.session).not.toBeNull();

    writable = true;
    await act(async () => { closed = await hook.session.close(); });
    expect(closed).toBe(true);
    expect(strokeIds(vault.files.get("Note ink.svg")!)).toEqual(["a", "b", "c"]);
  });

  test("saves strokes drawn while the final save runs before closing", async () => {
    const vault = fakeVault();
    vault.files.set("Note ink.svg", serializeInkSvg(withStrokes("a")));
    let hook: ReturnType<typeof mountSession>;
    let late = true;
    hook = mountSession(vault.actions(async (...args) => {
      const result = await vault.saveInk(...args);
      if (late) {
        late = false;
        hook.session.change(withStrokes("a", "b", "late"));
      }
      return result;
    }));
    await act(() => hook.session.open("Note ink.svg"));
    act(() => hook.session.change(withStrokes("a", "b")));
    let closed = false;
    await act(async () => { closed = await hook.session.close(); });
    expect(closed).toBe(true);
    expect(strokeIds(vault.files.get("Note ink.svg")!)).toEqual(["a", "b", "late"]);
  });

  test("keeps saving through the vault actions of the moment the drawing opened", async () => {
    const vault = fakeVault();
    const opened: string[] = [];
    const hook = mountSession(vault.actions(async (...args) => { opened.push("first note"); return vault.saveInk(...args); }));
    await act(() => hook.session.create());
    // Switching notes re-renders the canvas with actions bound to the other note.
    hook.rerender(vault.actions(async (...args) => { opened.push("second note"); return vault.saveInk(...args); }));
    act(() => hook.session.change(withStrokes("a")));
    await act(() => hook.session.flush());
    expect(opened).toEqual(["first note"]);
  });

  test("does not create a file for a new drawing that was undone to empty", async () => {
    const vault = fakeVault();
    const hook = mountSession(vault.actions());
    await act(() => hook.session.create());
    act(() => hook.session.change(createInkDocument()));
    await act(() => hook.session.flush());
    expect(vault.calls).toHaveLength(0);
    expect(hook.session.saveState).toBe("saved");
  });
});

type MapSession = ReturnType<typeof useInkSession>;
type Actions = Pick<InkVaultActions, "readInk" | "saveInk">;

function mountMapSession(initial: Actions) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let latest: MapSession | null = null;
  function Harness({ actions }: { actions: Actions }) {
    latest = useInkSession(actions, "transparent");
    return null;
  }
  const render = (actions: Actions) => act(() => root.render(createElement(Harness, { actions })));
  return {
    render,
    get current(): MapSession {
      if (!latest) throw new Error("not rendered");
      return latest;
    },
    unmount: () => act(() => root.unmount()),
    ready: render(initial),
  };
}

const withStroke = (document: InkDocument): InkDocument => ({
  ...document,
  strokes: [{ id: "s1", tool: "pen", color: "#000000", size: 4, points: [[0, 0, 0.5], [4, 4, 0.5]] }],
});

describe("useInkSession with refresh (map drawing)", () => {
  test("pending edits are saved with the actions the drawing was created with", async () => {
    const saves: string[] = [];
    const actionsFor = (note: string): Actions => ({
      readInk: async () => null,
      saveInk: async () => {
        saves.push(note);
        return `${note} map ink.svg`;
      },
    });
    const harness = mountMapSession(actionsFor("A"));
    await harness.ready;
    await act(() => harness.current.create());
    await act(async () => harness.current.change(withStroke(harness.current.session!.document)));
    // The view moved on to note B before the autosave ran.
    await harness.render(actionsFor("B"));
    await act(() => harness.current.close());
    expect(saves).toEqual(["A"]);
    expect(harness.current.session).toBeNull();
    await harness.unmount();
  });

  test("reloads a drawing changed elsewhere and keeps unsaved strokes as a conflict", async () => {
    const files = new Map([["map.svg", serializeInkSvg(createInkDocument("transparent"))]]);
    const actions: Actions = {
      readInk: async (path) => files.get(path) ?? null,
      saveInk: async (path, svg, expected) => {
        if (!path || files.get(path) !== expected) return null;
        files.set(path, svg);
        return path;
      },
    };
    const harness = mountMapSession(actions);
    await harness.ready;
    await act(() => harness.current.open("map.svg"));
    const firstKey = harness.current.session!.key;

    // Unchanged on disk (e.g. our own write echoed back): nothing happens.
    await act(() => harness.current.refresh());
    expect(harness.current.session!.key).toBe(firstKey);

    // Synced from another device, no local edits: the new version is loaded.
    files.set("map.svg", serializeInkSvg(withStroke(createInkDocument("transparent"))));
    await act(() => harness.current.refresh());
    expect(harness.current.session!.key).not.toBe(firstKey);
    expect(harness.current.session!.document.strokes).toHaveLength(1);

    // Synced while strokes are pending: conflict instead of silently dropping them.
    await act(async () => harness.current.change(createInkDocument("transparent")));
    files.set("map.svg", serializeInkSvg(createInkDocument("transparent")));
    await act(() => harness.current.refresh());
    expect(harness.current.saveState).toBe("conflict");

    await act(() => harness.current.reload());
    expect(harness.current.saveState).toBe("saved");
    expect(harness.current.session!.document.strokes).toHaveLength(0);
    await harness.unmount();
  });

  test("reload leaves a paused autosave and loads the drawing on disk", async () => {
    const files = new Map([["map.svg", serializeInkSvg(withStroke(createInkDocument("transparent")))]]);
    let saves = 0;
    const actions: Actions = {
      readInk: async (path) => files.get(path) ?? null,
      // Neither the drawing nor a conflict copy can be written.
      saveInk: async () => {
        saves += 1;
        return null;
      },
    };
    const harness = mountMapSession(actions);
    await harness.ready;
    await act(() => harness.current.open("map.svg"));
    await act(async () => harness.current.change(createInkDocument("transparent")));
    await act(() => harness.current.flush());
    expect(harness.current.saveState).toBe("conflict");
    // The strokes are kept: switching away is refused while they are unsaved.
    let closed = true;
    await act(async () => { closed = await harness.current.close(); });
    expect(closed).toBe(false);

    await act(() => harness.current.reload());
    expect(harness.current.saveState).toBe("saved");
    expect(harness.current.session!.document.strokes).toHaveLength(1);
    const before = saves;
    await act(async () => harness.current.change(createInkDocument("transparent")));
    await act(() => harness.current.flush());
    expect(saves).toBeGreaterThan(before);
    await harness.unmount();
  });
});
