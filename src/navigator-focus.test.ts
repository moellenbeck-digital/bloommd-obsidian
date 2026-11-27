import { describe, expect, test } from "bun:test";
import { LONG_NAME, root } from "./navigator-fixture";
import {
  canGoBack,
  canGoForward,
  createState,
  cycleFocus,
  enterMap,
  escapeTarget,
  focusAfterHistory,
  focusArea,
  goBack,
  goForward,
  handleKey,
  leaveMap,
  listIndex,
  normalizeState,
  remapState,
  revealFile,
  selectFile,
  selectFolder,
  toggleFolder,
  treeIndex,
  type FocusAvailability,
  type NavEffect,
  type NavKey,
  type NavigatorState,
} from "./navigator-focus";
import { buildFolderNode } from "./navigator-model";

const noMap: FocusAvailability = { map: false, search: false };
const withMap: FocusAvailability = { map: true, search: false };

/** Presses keys one after another and collects every effect. */
function press(start: NavigatorState, keys: Array<string | NavKey>, available = noMap, tree = root) {
  let state = start;
  const effects: NavEffect[] = [];
  for (const key of keys) {
    const result = handleKey(state, tree, typeof key === "string" ? { key } : key, available);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const start = () => createState(root);

describe("tree keys", () => {
  test("starts in the tree on the vault root with one history entry", () => {
    const state = start();
    expect(state).toMatchObject({ focus: "tree", folder: "/", file: null });
    expect(state.history.entries).toHaveLength(1);
  });

  test("ArrowDown and ArrowUp move through the visible folders and stop at the ends", () => {
    expect(press(start(), ["ArrowDown"]).state.folder).toBe("Archive");
    expect(press(start(), ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"]).state.folder).toBe("Projects");
    expect(press(start(), ["ArrowUp"]).state.folder).toBe("/");
  });

  test("ArrowRight opens a closed folder, ArrowLeft closes it again", () => {
    const onProjects = press(start(), ["ArrowDown", "ArrowDown"]).state;
    const opened = press(onProjects, ["ArrowRight"]).state;
    expect(opened.expanded.has("Projects")).toBe(true);
    expect(opened.focus).toBe("tree");
    const closed = press(opened, ["ArrowLeft"]).state;
    expect(closed.expanded.has("Projects")).toBe(false);
    expect(closed.folder).toBe("Projects");
  });

  test("ArrowLeft on a closed or empty folder goes to the parent folder", () => {
    const state = press(start(), ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowDown"]).state;
    expect(state.folder).toBe("Projects/Beta");
    expect(press(state, ["ArrowLeft"]).state.folder).toBe("Projects");
    expect(press(start(), ["ArrowLeft"]).state.folder).toBe("/");
  });

  test("ArrowRight on an open folder (or one without sub-folders) focuses the list on its first note", () => {
    const result = press(start(), ["ArrowRight"]).state;
    expect(result).toMatchObject({ focus: "list", file: "Home.md", folder: "/" });
  });

  test("a folder without notes keeps the focus in the tree", () => {
    const state = press(start(), ["ArrowDown", "Enter"]).state;
    expect(state.folder).toBe("Archive");
    expect(state.focus).toBe("tree");
  });

  test("Enter selects the folder, records it and focuses its notes", () => {
    const state = press(start(), ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "Enter"]).state;
    expect(state.folder).toBe("Projects/Alpha");
    expect(state.focus).toBe("list");
    expect(state.file).toBe("Projects/Alpha/Notes.md");
    expect(state.history.entries.at(-1)).toEqual({ folder: "Projects/Alpha", file: null });
  });

  test("closing a folder that holds the selection moves the selection to that folder", () => {
    const state = selectFolder(toggleFolder(start(), "Projects", true), root, "Projects/Alpha/Deep");
    const closed = toggleFolder(state, "Projects", false);
    expect(closed.folder).toBe("Projects");
    expect(closed.file).toBeNull();
    expect(treeIndex(root, closed)).toBeGreaterThanOrEqual(0);
  });

  test("the root cannot be closed", () => {
    expect(toggleFolder(start(), "/", false)).toEqual(start());
  });
});

describe("list keys", () => {
  const inAlpha = () => press(start(), ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "Enter"]).state;

  test("ArrowDown and ArrowUp move through the notes and stop at the ends", () => {
    expect(press(inAlpha(), ["ArrowDown"]).state.file).toBe("Projects/Alpha/Plan 2.md");
    expect(press(inAlpha(), ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"]).state.file).toBe("Projects/Alpha/Plan 10.md");
    expect(press(inAlpha(), ["ArrowUp"]).state.file).toBe("Projects/Alpha/Notes.md");
  });

  test("Enter opens the selected note and keeps the focus in the list", () => {
    const { state, effects } = press(inAlpha(), ["ArrowDown", "Enter"]);
    expect(effects).toEqual([{ type: "open-file", path: "Projects/Alpha/Plan 2.md" }]);
    expect(state.focus).toBe("list");
    expect(state.history.entries.at(-1)?.file).toBe("Projects/Alpha/Plan 2.md");
  });

  test("ArrowLeft returns to the tree", () => {
    expect(press(inAlpha(), ["ArrowLeft"]).state.focus).toBe("tree");
  });

  test("notes with the same name in different folders open the one that is selected", () => {
    const alpha = press(inAlpha(), ["Enter"]).effects;
    const beta = press(start(), ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowDown", "Enter", "Enter"]);
    expect(alpha).toEqual([{ type: "open-file", path: "Projects/Alpha/Notes.md" }]);
    expect(beta.effects).toEqual([{ type: "open-file", path: "Projects/Beta/Notes.md" }]);
  });

  test("a note with a very long name is reachable and opened by its full path", () => {
    const state = selectFolder(start(), root, "Projects/Alpha/Deep");
    const { effects } = press(state, ["Enter", "Enter"]);
    expect(effects).toEqual([{ type: "open-file", path: `Projects/Alpha/Deep/${LONG_NAME}` }]);
  });
});

describe("map shortcut", () => {
  test("M in the tree opens the map of the folder, in the list that of the note", () => {
    expect(press(start(), ["m"]).effects).toEqual([{ type: "open-map", kind: "folder", path: "/" }]);
    expect(press(start(), ["ArrowRight", "m"]).effects).toEqual([{ type: "open-map", kind: "file", path: "Home.md" }]);
  });
});

describe("focus areas", () => {
  test("Tab cycles tree → list → tree while no map is open", () => {
    const afterTab = press(start(), ["Tab"]).state;
    expect(afterTab.focus).toBe("list");
    expect(afterTab.file).toBe("Home.md");
    expect(press(afterTab, ["Tab"]).state.focus).toBe("tree");
  });

  test("Tab includes the map while one is open and asks the view to focus it", () => {
    const result = press(start(), ["Tab", "Tab"], withMap);
    expect(result.state.focus).toBe("map");
    expect(result.effects).toEqual([{ type: "focus-map" }]);
    expect(press(result.state, ["Tab"], withMap).state.focus).toBe("tree");
  });

  test("Shift+Tab goes the other way round", () => {
    expect(press(start(), [{ key: "Tab", shift: true }], withMap).state.focus).toBe("map");
    expect(cycleFocus("tree", { map: true, search: true }, -1)).toBe("search");
    expect(cycleFocus("tree", { map: true, search: true })).toBe("list");
  });

  test("Tab skips the list for a folder without notes", () => {
    const inArchive = press(start(), ["ArrowDown"]).state;
    expect(press(inArchive, ["Tab"]).state.focus).toBe("tree");
    expect(press(inArchive, ["Tab"], withMap).state.focus).toBe("map");
  });

  test("Escape goes list → tree → editor", () => {
    const inList = press(start(), ["ArrowRight"]).state;
    expect(escapeTarget(inList)).toBe("tree");
    const inTree = press(inList, ["Escape"]).state;
    expect(inTree.focus).toBe("tree");
    expect(press(inTree, ["Escape"]).effects).toEqual([{ type: "focus-editor" }]);
  });

  test("Escape from the map or from search returns to the area the user came from", () => {
    const fromList = focusArea(press(start(), ["ArrowRight"]).state, "map");
    expect(fromList.returnFocus).toBe("list");
    expect(press(fromList, ["Escape"]).state.focus).toBe("list");
    const fromTree = focusArea(start(), "search");
    expect(press(fromTree, ["Escape"]).state.focus).toBe("tree");
  });

  test("opening the map remembers the area it was opened from, and Escape in the map goes back there", () => {
    const inList = press(start(), ["ArrowRight"]).state;
    const mapFromList = enterMap(inList);
    expect(mapFromList).toMatchObject({ focus: "map", returnFocus: "list" });
    const back = press(mapFromList, ["Escape"], withMap);
    expect(back.state.focus).toBe("list");
    expect(back.effects).toEqual([]);

    const mapFromTree = enterMap(start());
    expect(mapFromTree).toMatchObject({ focus: "map", returnFocus: "tree" });
    expect(press(mapFromTree, ["Escape"], withMap).state.focus).toBe("tree");
  });

  test("opening a map again while the map has focus keeps the original area", () => {
    const again = enterMap(enterMap(press(start(), ["ArrowRight"]).state));
    expect(again).toMatchObject({ focus: "map", returnFocus: "list" });
  });

  test("Escape from the map does not reach the editor; the existing list → tree → editor chain is unchanged after it", () => {
    const fromList = press(enterMap(press(start(), ["ArrowRight"]).state), ["Escape"], withMap);
    expect(fromList.effects).toEqual([]);
    const second = press(fromList.state, ["Escape"], withMap);
    expect(second.state.focus).toBe("tree");
    expect(press(second.state, ["Escape"], withMap).effects).toEqual([{ type: "focus-editor" }]);
  });

  test("leaving the map for another view returns the model to the area it came from", () => {
    const inMap = enterMap(press(start(), ["ArrowRight"]).state);
    expect(leaveMap(inMap).focus).toBe("list");
    const tree = start();
    expect(leaveMap(tree)).toBe(tree);
  });

  test("the map and search have no navigator keys of their own", () => {
    const inMap = focusArea(start(), "map");
    expect(press(inMap, ["ArrowDown", "Enter", "m"], withMap).state).toBe(inMap);
  });
});

describe("reveal active file", () => {
  test("opens every folder on the way, selects the folder and the file", () => {
    const state = revealFile(start(), root, `Projects/Alpha/Deep/${LONG_NAME}`);
    expect([...state.expanded].sort()).toEqual(["Projects", "Projects/Alpha", "Projects/Alpha/Deep"]);
    expect(state).toMatchObject({ folder: "Projects/Alpha/Deep", file: `Projects/Alpha/Deep/${LONG_NAME}` });
    expect(treeIndex(root, state)).toBe(4);
    expect(listIndex(root, state)).toBe(0);
  });

  test("selects the right note when the name exists in several folders", () => {
    const beta = revealFile(start(), root, "Projects/Beta/Notes.md");
    expect(beta).toMatchObject({ folder: "Projects/Beta", file: "Projects/Beta/Notes.md" });
    expect(beta.expanded.has("Projects/Alpha")).toBe(false);
    const alpha = revealFile(beta, root, "Projects/Alpha/Notes.md");
    expect(alpha).toMatchObject({ folder: "Projects/Alpha", file: "Projects/Alpha/Notes.md" });
  });

  test("a note in the vault root needs no folders opened", () => {
    expect(revealFile(start(), root, "Home.md")).toMatchObject({ folder: "/", file: "Home.md" });
  });

  test("can move focus to the list and record the context in the history", () => {
    const state = revealFile(start(), root, "Projects/Alpha/Notes.md", { focus: "list", record: true });
    expect(state.focus).toBe("list");
    expect(state.history.entries.at(-1)).toEqual({ folder: "Projects/Alpha", file: "Projects/Alpha/Notes.md" });
    expect(canGoBack(state)).toBe(true);
  });

  test("without record the history stays as it was, and focus stays where it was", () => {
    const state = revealFile(start(), root, "Projects/Alpha/Notes.md");
    expect(state.history).toEqual(start().history);
    expect(state.focus).toBe("tree");
  });

  test("a note the snapshot does not know leaves the state untouched", () => {
    const state = start();
    expect(revealFile(state, root, "Projects/Missing.md")).toBe(state);
    expect(revealFile(state, root, "image.png")).toBe(state);
  });
});

describe("history", () => {
  test("back and forward restore folder and file and open the folders on the way", () => {
    let state = selectFolder(start(), root, "Projects", true);
    state = selectFile(state, root, "Projects/Alpha/Notes.md", true);
    state = selectFile(state, root, "Projects/Beta/Notes.md", true);
    const back = goBack(state, root);
    expect(back).toMatchObject({ folder: "Projects/Alpha", file: "Projects/Alpha/Notes.md" });
    expect(back.expanded.has("Projects")).toBe(true);
    expect(canGoForward(back)).toBe(true);
    expect(goForward(back, root)).toMatchObject({ folder: "Projects/Beta", file: "Projects/Beta/Notes.md" });
  });

  test("Mod+[ and Mod+] work from every area", () => {
    const visited = selectFile(selectFolder(start(), root, "Projects", true), root, "Projects/Alpha/Notes.md", true);
    for (const area of ["tree", "list", "map"] as const) {
      const state = focusArea(visited, area);
      const back = press(state, [{ key: "[", mod: true }], withMap).state;
      expect(back.folder).toBe("Projects");
      expect(press(back, [{ key: "]", mod: true }], withMap).state.file).toBe("Projects/Alpha/Notes.md");
    }
  });

  test("at the end of the history focus moves off the button that was just disabled", () => {
    // Three folders after the start: three steps back reach the start (Back disabled), three forward the end (Forward disabled).
    let state = selectFolder(selectFolder(selectFolder(start(), root, "Projects", true), root, "Projects/Alpha", true), root, "Projects/Beta", true);
    state = goBack(goBack(state, root), root);
    expect(canGoBack(state)).toBe(true);
    expect(focusAfterHistory(state, "back")).toBeNull();
    state = goBack(state, root);
    expect(canGoBack(state)).toBe(false);
    expect(focusAfterHistory(state, "back")).toBe("forward");
    state = goForward(goForward(goForward(state, root), root), root);
    expect(canGoForward(state)).toBe(false);
    expect(focusAfterHistory(state, "forward")).toBe("back");
  });

  test("with neither button usable focus returns to the list or the tree", () => {
    const only = start();
    expect(focusAfterHistory(only, "back")).toBe("tree");
    expect(focusAfterHistory(focusArea({ ...only, file: null }, "list"), "forward")).toBe("list");
    expect(focusAfterHistory(enterMap(focusArea(only, "list")), "back")).toBe("list");
  });

  test("focus that is not on a history button is left alone", () => {
    expect(focusAfterHistory(start(), null)).toBeNull();
  });

  test("going back at the start does nothing", () => {
    const state = start();
    expect(goBack(state, root)).toBe(state);
    expect(canGoBack(state)).toBe(false);
  });

  test("skips contexts whose folder no longer exists", () => {
    const state = selectFolder(selectFolder(start(), root, "Projects/Beta", true), root, "Archive", true);
    const reduced = buildFolderNode({ path: "/", name: "Vault", children: [{ path: "Archive", name: "Archive", children: [] }] }, "Vault");
    expect(goBack(state, reduced).folder).toBe("/");
  });
});

describe("vault changes", () => {
  test("a renamed folder carries selection, open folders and history", () => {
    let state = revealFile(start(), root, "Projects/Alpha/Notes.md", { record: true });
    state = remapState(state, "Projects", "Work");
    expect(state).toMatchObject({ folder: "Work/Alpha", file: "Work/Alpha/Notes.md" });
    expect(state.expanded.has("Work")).toBe(true);
    expect(state.expanded.has("Projects")).toBe(false);
    expect(state.history.entries.at(-1)?.folder).toBe("Work/Alpha");
  });

  test("a deleted folder falls back to the nearest surviving ancestor", () => {
    const state = revealFile(start(), root, `Projects/Alpha/Deep/${LONG_NAME}`);
    const reduced = buildFolderNode(
      { path: "/", name: "Vault", children: [{ path: "Projects", name: "Projects", children: [{ path: "Projects/Alpha", name: "Alpha", children: [] }] }] },
      "Vault",
    );
    const normalized = normalizeState(state, reduced);
    expect(normalized.folder).toBe("Projects/Alpha");
    expect(normalized.file).toBeNull();
    expect([...normalized.expanded].sort()).toEqual(["Projects", "Projects/Alpha"]);
  });

  test("a deleted file is deselected and an unchanged vault keeps the state object", () => {
    const state = revealFile(start(), root, "Projects/Alpha/Notes.md");
    expect(normalizeState(state, root)).toBe(state);
    const withoutNotes = buildFolderNode({
      path: "/", name: "Vault", children: [{ path: "Projects", name: "Projects", children: [{ path: "Projects/Alpha", name: "Alpha", children: [] }] }],
    }, "Vault");
    expect(normalizeState(state, withoutNotes)).toMatchObject({ folder: "Projects/Alpha", file: null });
  });
});
