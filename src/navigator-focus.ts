/**
 * Focus and selection model of the navigator. Which area has focus, which folder and file are
 * selected and which folders are open is state kept here, never read back from the DOM; the view
 * only renders it and forwards key presses. `handleKey` is a pure reducer: it returns the next
 * state and the side effects (open a file, show a map) for the view to carry out.
 */
import {
  canGoBack as historyCanGoBack,
  canGoForward as historyCanGoForward,
  currentContext,
  emptyHistory,
  pushContext,
  remapHistory,
  step,
  type NavContext,
  type NavHistory,
} from "./navigator-history";
import {
  ROOT_PATH,
  ancestorFolders,
  findFile,
  findFolder,
  parentFolderPath,
  parentPath,
  remapPath,
  visibleRows,
  type FolderNode,
} from "./navigator-model";

/** Areas that can hold focus. `map` is the BloomMD map view; `search` is reserved for the vault search. */
export type FocusArea = "tree" | "list" | "map" | "search";

export interface NavigatorState {
  focus: FocusArea;
  /** Where Escape (or the "Focus navigator" command) returns to when the map or search has focus. */
  returnFocus: FocusArea;
  /** Folder paths that are open; the root is always open. */
  expanded: ReadonlySet<string>;
  /** The selected folder: what the tree highlights and the list shows. */
  folder: string;
  /** The selected file in the list. */
  file: string | null;
  history: NavHistory;
}

export type NavEffect =
  | { type: "open-file"; path: string }
  | { type: "open-map"; kind: "file" | "folder"; path: string }
  | { type: "focus-map" }
  | { type: "focus-editor" };

export interface NavResult {
  state: NavigatorState;
  effects: NavEffect[];
}

export interface NavKey {
  key: string;
  shift?: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
}

/** Tab order of the areas. The map is only part of it while one is open; search is not available yet. */
const FOCUS_ORDER: readonly FocusArea[] = ["tree", "list", "map", "search"];

export interface FocusAvailability {
  map: boolean;
  search: boolean;
}

export function createState(root: FolderNode): NavigatorState {
  const state: NavigatorState = {
    focus: "tree",
    returnFocus: "tree",
    expanded: new Set(),
    folder: root.path,
    file: null,
    history: emptyHistory,
  };
  return { ...state, history: pushContext(state.history, { folder: state.folder, file: null }) };
}

const context = (state: NavigatorState): NavContext => ({ folder: state.folder, file: state.file });
const commit = (state: NavigatorState): NavigatorState => ({ ...state, history: pushContext(state.history, context(state)) });
const withFocus = (state: NavigatorState, focus: FocusArea): NavigatorState => ({
  ...state,
  focus,
  returnFocus: focus === "tree" || focus === "list" ? focus : state.returnFocus,
});

/** Moves focus to an area. Areas other than tree and list remember where Escape should return to. */
export function focusArea(state: NavigatorState, area: FocusArea): NavigatorState {
  return state.focus === area ? state : withFocus(state, area);
}

/** Opens the map from the focused area. The map has no keyboard focus of its own, so the area it was opened from is kept for Escape. */
export function enterMap(state: NavigatorState): NavigatorState {
  const origin = state.focus === "tree" || state.focus === "list" ? state.focus : state.returnFocus;
  return { ...state, focus: "map", returnFocus: origin };
}

/** Leaves the map when it is no longer the active view (the person went to a note, say): back to the area it was opened from, without moving focus. */
export function leaveMap(state: NavigatorState): NavigatorState {
  return state.focus === "map" ? { ...state, focus: state.returnFocus } : state;
}

export type HistoryButton = "back" | "forward";

/**
 * Where focus goes when the history button that had it is disabled by the step it just took (the
 * end of the history): the opposite button while that is usable, else the list or tree. Null when
 * focus is not on a history button or that button is still usable.
 */
export function focusAfterHistory(state: NavigatorState, focused: HistoryButton | null): HistoryButton | "tree" | "list" | null {
  if (focused === null) return null;
  const usable = { back: canGoBack(state), forward: canGoForward(state) };
  if (usable[focused]) return null;
  const other = focused === "back" ? "forward" : "back";
  if (usable[other]) return other;
  return state.focus === "list" || state.focus === "tree" ? state.focus : state.returnFocus === "list" ? "list" : "tree";
}

/** The next (or previous) available area in tab order. */
export function cycleFocus(focus: FocusArea, available: FocusAvailability, direction: 1 | -1 = 1): FocusArea {
  const order = FOCUS_ORDER.filter((area) => area === "tree" || area === "list" || available[area]);
  const index = order.indexOf(focus);
  const next = order[(Math.max(index, 0) + direction + order.length) % order.length];
  return next ?? "tree";
}

/** Where Escape sends focus from an area: the list goes back to the tree, map and search to where the user came from. */
export function escapeTarget(state: NavigatorState): FocusArea | "editor" {
  if (state.focus === "list") return "tree";
  if (state.focus === "tree") return "editor";
  return state.returnFocus;
}

/** Folders whose Markdown files the list shows; empty when the folder is gone. */
export function listFiles(root: FolderNode, state: NavigatorState) {
  return findFolder(root, state.folder)?.files ?? [];
}

/** Position of the selected folder among the visible tree rows, -1 when it is hidden. */
export function treeIndex(root: FolderNode, state: NavigatorState): number {
  return visibleRows(root, state.expanded).findIndex((row) => row.path === state.folder);
}

/** Position of the selected file in the list, -1 when none is selected. */
export function listIndex(root: FolderNode, state: NavigatorState): number {
  return state.file === null ? -1 : listFiles(root, state).findIndex((file) => file.path === state.file);
}

/** Selects a folder; it opens ancestors when they are closed, clears the file selection and (with `record`) enters the history. */
export function selectFolder(state: NavigatorState, root: FolderNode, path: string, record = false): NavigatorState {
  if (!findFolder(root, path)) return state;
  const expanded = new Set(state.expanded);
  for (const ancestor of ancestorFolders(path)) if (ancestor !== ROOT_PATH) expanded.add(ancestor);
  const next: NavigatorState = { ...state, expanded, folder: path, file: path === state.folder ? state.file : null };
  return record ? commit(next) : next;
}

export function selectFile(state: NavigatorState, root: FolderNode, path: string, record = false): NavigatorState {
  const file = findFile(root, path);
  if (!file) return state;
  const next: NavigatorState = { ...state, folder: parentPath(path), file: path };
  return record ? commit(next) : next;
}

export function toggleFolder(state: NavigatorState, path: string, open?: boolean): NavigatorState {
  if (path === ROOT_PATH) return state;
  const expanded = new Set(state.expanded);
  const shouldOpen = open ?? !expanded.has(path);
  if (shouldOpen) expanded.add(path);
  else expanded.delete(path);
  // A closed folder hides everything below it; the selection moves up to the folder that was closed.
  const hidden = !shouldOpen && state.folder.startsWith(`${path}/`);
  return { ...state, expanded, folder: hidden ? path : state.folder, file: hidden ? null : state.file };
}

export interface RevealOptions {
  /** Add the revealed context to the back/forward history. */
  record?: boolean;
  /** Area that gets focus; keeps the current one when omitted. */
  focus?: FocusArea;
}

/**
 * Shows a file in the navigator: opens every folder on the way, selects its folder and the file.
 * A file the snapshot does not know (not yet indexed, or not Markdown) leaves the state untouched.
 */
export function revealFile(state: NavigatorState, root: FolderNode, path: string, options: RevealOptions = {}): NavigatorState {
  if (!findFile(root, path)) return state;
  const expanded = new Set(state.expanded);
  for (const ancestor of ancestorFolders(path)) if (ancestor !== ROOT_PATH) expanded.add(ancestor);
  let next: NavigatorState = { ...state, expanded, folder: parentPath(path), file: path };
  if (options.focus) next = withFocus(next, options.focus);
  return options.record ? commit(next) : next;
}

/** Applies a context from the history (folder opened on the way, file selected when it still exists). */
function applyContext(state: NavigatorState, root: FolderNode, target: NavContext, history: NavHistory): NavigatorState {
  const expanded = new Set(state.expanded);
  for (const ancestor of ancestorFolders(target.folder)) if (ancestor !== ROOT_PATH) expanded.add(ancestor);
  const file = target.file !== null && findFile(root, target.file) ? target.file : null;
  return { ...state, expanded, folder: target.folder, file, history };
}

const stillExists = (root: FolderNode) => (target: NavContext) => findFolder(root, target.folder) !== null;

export function goBack(state: NavigatorState, root: FolderNode): NavigatorState {
  const history = step(state.history, -1, stillExists(root));
  const target = history && currentContext(history);
  return history && target ? applyContext(state, root, target, history) : state;
}

export function goForward(state: NavigatorState, root: FolderNode): NavigatorState {
  const history = step(state.history, 1, stillExists(root));
  const target = history && currentContext(history);
  return history && target ? applyContext(state, root, target, history) : state;
}

export const canGoBack = (state: NavigatorState) => historyCanGoBack(state.history);
export const canGoForward = (state: NavigatorState) => historyCanGoForward(state.history);

/** Applies a rename or move of a file or folder to the selection, the open folders and the history. */
export function remapState(state: NavigatorState, from: string, to: string): NavigatorState {
  return {
    ...state,
    expanded: new Set([...state.expanded].map((path) => remapPath(path, from, to))),
    folder: remapPath(state.folder, from, to),
    file: state.file === null ? null : remapPath(state.file, from, to),
    history: remapHistory(state.history, from, to),
  };
}

/**
 * Brings the state in line with a changed vault (files deleted, folders gone): open folders that no
 * longer exist are dropped, a vanished folder selection falls back to the nearest surviving
 * ancestor and a vanished file is deselected.
 */
export function normalizeState(state: NavigatorState, root: FolderNode): NavigatorState {
  const expanded = new Set([...state.expanded].filter((path) => findFolder(root, path)));
  let folder = state.folder;
  while (folder !== ROOT_PATH && !findFolder(root, folder)) folder = parentFolderPath(folder) ?? ROOT_PATH;
  const file = folder === state.folder && state.file !== null && findFile(root, state.file) ? state.file : null;
  if (folder === state.folder && file === state.file && expanded.size === state.expanded.size) return state;
  return { ...state, expanded, folder, file };
}

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));

function mapEffect(state: NavigatorState): NavEffect {
  return state.focus === "list" && state.file !== null
    ? { type: "open-map", kind: "file", path: state.file }
    : { type: "open-map", kind: "folder", path: state.folder };
}

function handleTreeKey(state: NavigatorState, root: FolderNode, input: NavKey): NavResult {
  const rows = visibleRows(root, state.expanded);
  const index = Math.max(0, rows.findIndex((row) => row.path === state.folder));
  const row = rows[index];
  switch (input.key) {
    case "ArrowUp":
    case "ArrowDown": {
      const target = rows[clamp(index + (input.key === "ArrowDown" ? 1 : -1), rows.length - 1)];
      return { state: target ? { ...state, folder: target.path, file: null } : state, effects: [] };
    }
    case "ArrowLeft": {
      if (row?.hasChildren && row.expanded && row.path !== ROOT_PATH) return { state: toggleFolder(state, row.path, false), effects: [] };
      const parent = parentFolderPath(state.folder);
      return { state: parent === null ? state : { ...state, folder: parent, file: null }, effects: [] };
    }
    case "ArrowRight": {
      if (row?.hasChildren && !row.expanded) return { state: toggleFolder(state, row.path, true), effects: [] };
      return { state: enterList(state, root), effects: [] };
    }
    case "Enter": {
      return { state: enterList(commit(state), root), effects: [] };
    }
    case "m":
      return { state, effects: [mapEffect(state)] };
    default:
      return { state, effects: [] };
  }
}

/** Focuses the list, on the selected file or the first one; stays in the tree when the folder holds no notes. */
function enterList(state: NavigatorState, root: FolderNode): NavigatorState {
  const files = listFiles(root, state);
  if (files.length === 0) return state;
  const file = state.file !== null && files.some((candidate) => candidate.path === state.file) ? state.file : (files[0]?.path ?? null);
  return withFocus({ ...state, file }, "list");
}

function handleListKey(state: NavigatorState, root: FolderNode, input: NavKey): NavResult {
  const files = listFiles(root, state);
  const index = listIndex(root, state);
  switch (input.key) {
    case "ArrowUp":
    case "ArrowDown": {
      const target = files[clamp((index < 0 ? 0 : index + (input.key === "ArrowDown" ? 1 : -1)), files.length - 1)];
      return { state: target ? { ...state, file: target.path } : state, effects: [] };
    }
    case "ArrowLeft":
      return { state: withFocus(state, "tree"), effects: [] };
    case "Enter": {
      const file = files[index];
      return file ? { state: commit(state), effects: [{ type: "open-file", path: file.path }] } : { state, effects: [] };
    }
    case "m":
      return { state, effects: [mapEffect(state)] };
    default:
      return { state, effects: [] };
  }
}

/** Handles one key press in the focused area. Keys it does not know return the state unchanged and no effects. */
export function handleKey(state: NavigatorState, root: FolderNode, input: NavKey, available: FocusAvailability): NavResult {
  if (input.mod && input.key === "[") return { state: goBack(state, root), effects: [] };
  if (input.mod && input.key === "]") return { state: goForward(state, root), effects: [] };
  if (input.mod) return { state, effects: [] };

  if (input.key === "Tab") {
    const direction = input.shift ? -1 : 1;
    let area = cycleFocus(state.focus, available, direction);
    // A folder without notes has nothing to focus in the list: skip it.
    if (area === "list" && listFiles(root, state).length === 0) area = cycleFocus("list", available, direction);
    const next = withFocus(area === "list" ? enterList(state, root) : state, area);
    return { state: next, effects: area === "map" ? [{ type: "focus-map" }] : [] };
  }
  if (input.key === "Escape") {
    const target = escapeTarget(state);
    if (target === "editor") return { state, effects: [{ type: "focus-editor" }] };
    return { state: withFocus(state, target), effects: [] };
  }
  if (state.focus === "tree") return handleTreeKey(state, root, input);
  if (state.focus === "list") return handleListKey(state, root, input);
  return { state, effects: [] };
}
