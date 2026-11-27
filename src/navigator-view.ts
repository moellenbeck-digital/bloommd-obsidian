/**
 * The BloomMD navigator side view: the vault as a folder tree, the notes of the selected folder as
 * a list, and a way from there into the map. Plain Obsidian DOM (no React tree) keeps it small for
 * main.js. All behaviour (focus, selection, history, reveal) lives in `navigator-focus.ts`; this
 * file renders that state, forwards key presses and carries out the effects.
 *
 * The vault is only read. Both lists render just the rows in view, so a large vault costs a screenful
 * of DOM, and no map is loaded until the person asks for one.
 */
import { ItemView, Keymap, Notice, Platform, TFile, TFolder, setIcon, type EventRef, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import {
  canGoBack,
  canGoForward,
  createState,
  enterMap,
  focusAfterHistory,
  focusArea,
  goBack,
  goForward,
  handleKey,
  leaveMap,
  listFiles,
  listIndex,
  normalizeState,
  remapState,
  revealFile,
  selectFile,
  selectFolder,
  toggleFolder,
  treeIndex,
  type FocusArea,
  type HistoryButton,
  type NavEffect,
  type NavKey,
  type NavResult,
  type NavigatorState,
} from "./navigator-focus";
import { NAVIGATOR_FOCUS_AREAS, NAVIGATOR_SHORTCUTS } from "./navigator-help";
import { ROOT_PATH, buildFolderNode, scrollToReveal, shortenMiddle, visibleRows, visibleWindow, type FileNode, type FolderNode, type TreeRow } from "./navigator-model";

export const VIEW_TYPE_NAVIGATOR = "bloommd-navigator-view";

/** What the navigator needs from the plugin: opening notes and maps, and knowing which map is open. */
export interface NavigatorHost {
  openNote(file: TFile): Promise<void>;
  openMapFor(target: TFile | TFolder): Promise<void>;
  /** The note or folder the BloomMD map shows right now, or null while no map is open. */
  mapTarget(): { kind: "file" | "folder"; path: string } | null;
  /** Moves keyboard focus into the map; false when there is none. */
  focusMapView(): boolean;
  /** Whether the map is the active view, i.e. where key presses go. */
  mapViewActive(): boolean;
}

const ROW_HEIGHT = 28;
const MOBILE_ROW_HEIGHT = 40;
const FALLBACK_VIEWPORT = 400;
const REFRESH_DELAY_MS = 120;
const PATH_LABEL_MAX = 56;
/** Keys the navigator handles; everything else (typing, Obsidian hotkeys) passes through. */
const HANDLED_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab", "Escape", "m", "[", "]"]);

const isTreeRow = (row: TreeRow | FileNode): row is TreeRow => "hasChildren" in row;
const baseName = (name: string) => name.replace(/\.md$/i, "");

/** A pane that shows one virtualised list. */
interface Pane {
  area: "tree" | "list";
  scroll: HTMLElement;
  sizer: HTMLElement;
  title: HTMLElement;
}

export class NavigatorView extends ItemView {
  private root: FolderNode = { path: ROOT_PATH, name: ROOT_PATH, folders: [], files: [] };
  private state: NavigatorState = createState(this.root);
  /** Folder and open folders from the saved workspace layout, applied once the vault is read. */
  private saved: { folder: string; expanded: Set<string> } | null = null;
  private tree!: Pane;
  private list!: Pane;
  private backButton!: HTMLButtonElement;
  private forwardButton!: HTMLButtonElement;
  private noteMapButton!: HTMLButtonElement;
  private folderMapButton!: HTMLButtonElement;
  private browseContext!: HTMLElement;
  private mapContext!: HTMLElement;
  private help!: HTMLElement;
  private refreshTimer = 0;

  constructor(leaf: WorkspaceLeaf, private readonly host: NavigatorHost) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_NAVIGATOR;
  }

  getDisplayText(): string {
    return "BloomMD navigator";
  }

  getIcon(): string {
    return "folder-tree";
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), folder: this.state.folder, expanded: [...this.state.expanded] };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const saved = state as { folder?: unknown; expanded?: unknown } | null;
    if (typeof saved?.folder !== "string" || !Array.isArray(saved.expanded)) return;
    this.saved = { folder: saved.folder, expanded: new Set(saved.expanded.filter((path): path is string => typeof path === "string")) };
    if (this.tree) {
      this.applySaved();
      this.render();
    }
  }

  private applySaved() {
    if (!this.saved) return;
    this.state = normalizeState({ ...createState(this.root), ...this.saved }, this.root);
    this.saved = null;
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("bloommd-nav");
    this.buildChrome();
    this.root = this.snapshot();
    this.state = createState(this.root);
    this.applySaved();

    const queueRefresh = () => {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.refreshVault(), REFRESH_DELAY_MS);
    };
    const events: EventRef[] = [
      this.app.vault.on("create", queueRefresh),
      this.app.vault.on("delete", queueRefresh),
      this.app.vault.on("rename", (file, oldPath) => {
        this.state = remapState(this.state, oldPath, file.path);
        queueRefresh();
      }),
      this.app.workspace.on("file-open", (file) => {
        if (file?.extension === "md") this.revealActive(file, false);
      }),
      this.app.workspace.on("active-leaf-change", () => {
        // The map is left when another view becomes active; the focus model must not stay on "map".
        if (this.state.focus === "map" && !this.host.mapViewActive()) {
          this.state = leaveMap(this.state);
          this.render();
        } else this.renderContext();
      }),
    ];
    events.forEach((ref) => this.registerEvent(ref));
    this.register(() => window.clearTimeout(this.refreshTimer));
    // The map takes no DOM focus (key presses land on <body>), so Escape out of it is heard on the document.
    const onMapKey = (event: KeyboardEvent) => this.onMapKeyDown(event);
    document.addEventListener("keydown", onMapKey);
    this.register(() => document.removeEventListener("keydown", onMapKey));

    const active = this.app.workspace.getActiveFile();
    if (active?.extension === "md") this.state = revealFile(this.state, this.root, active.path);
    this.render();
  }

  async onClose() {
    window.clearTimeout(this.refreshTimer);
  }

  /** Shows a note in the tree and the list: opens its folders, selects it and scrolls to it. */
  revealActive(file: TFile, focus: boolean) {
    const next = revealFile(this.state, this.root, file.path, focus ? { focus: "list", record: true } : {});
    if (next === this.state) return;
    this.state = next;
    this.render();
    if (focus) this.focusPane(this.state.focus);
  }

  /** Gives focus back to the area the person was in before they went to the map or the editor. */
  focusNavigator() {
    this.state = focusArea(this.state, this.state.returnFocus);
    this.render();
    this.focusPane(this.state.focus);
  }

  /** Back or forward in the navigation history. */
  navigate(direction: -1 | 1) {
    this.state = direction < 0 ? goBack(this.state, this.root) : goForward(this.state, this.root);
    this.render();
  }

  private snapshot(): FolderNode {
    return buildFolderNode(this.app.vault.getRoot(), this.app.vault.getName());
  }

  private refreshVault() {
    this.root = this.snapshot();
    this.state = normalizeState(this.state, this.root);
    this.render();
  }

  private get rowHeight() {
    return Platform.isMobile ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;
  }

  private shortcutKeys(keys: string) {
    return keys.replace(/Mod/g, Platform.isMacOS ? "Cmd" : "Ctrl");
  }

  // ── Layout ──────────────────────────────────────────────────────────────────────────────────

  private buildChrome() {
    const header = this.contentEl.createDiv({ cls: "bloommd-nav-header" });
    const toolbar = header.createDiv({ cls: "bloommd-nav-toolbar" });
    this.backButton = this.toolbarButton(toolbar, "arrow-left", "Back", () => this.navigate(-1));
    this.forwardButton = this.toolbarButton(toolbar, "arrow-right", "Forward", () => this.navigate(1));
    toolbar.createDiv({ cls: "bloommd-nav-spacer" });
    this.noteMapButton = this.toolbarButton(toolbar, "git-branch", "Open map of the selected note", () => this.run({ type: "open-map", kind: "file", path: this.state.file ?? "" }));
    this.folderMapButton = this.toolbarButton(toolbar, "folder-tree", "Open map of the selected folder", () => this.run({ type: "open-map", kind: "folder", path: this.state.folder }));
    const helpButton = this.toolbarButton(toolbar, "help-circle", "Keyboard help", () => {
      const open = this.help.hasClass("is-hidden");
      this.help.toggleClass("is-hidden", !open);
      helpButton.setAttribute("aria-expanded", String(open));
    });
    helpButton.setAttribute("aria-expanded", "false");

    // Reserved for the vault-wide search; it takes no focus until that exists.
    header.createEl("input", { cls: "bloommd-nav-search", attr: { type: "search", placeholder: "Search (not available yet)", "aria-label": "Search, not available yet", disabled: "" } });

    const context = header.createDiv({ cls: "bloommd-nav-context", attr: { "aria-live": "polite" } });
    this.browseContext = context.createDiv({ cls: "bloommd-nav-context-browse" });
    this.mapContext = context.createDiv({ cls: "bloommd-nav-context-map" });

    this.help = this.contentEl.createDiv({ cls: ["bloommd-nav-help", "is-hidden"], attr: { role: "region", "aria-label": "Navigator keyboard help" } });
    this.renderHelp();

    const body = this.contentEl.createDiv({ cls: "bloommd-nav-body" });
    this.tree = this.createPane(body, "tree", "Folders", "tree");
    this.list = this.createPane(body, "list", "Notes", "listbox");
  }

  private toolbarButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: ["bloommd-nav-button", "clickable-icon"], attr: { type: "button", "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private createPane(parent: HTMLElement, area: "tree" | "list", title: string, role: string): Pane {
    const section = parent.createDiv({ cls: ["bloommd-nav-pane", `bloommd-nav-pane-${area}`] });
    const titleEl = section.createDiv({ cls: "bloommd-nav-pane-title", text: title });
    const scroll = section.createDiv({ cls: "bloommd-nav-scroll", attr: { role, tabindex: "0", "aria-label": title, "data-area": area } });
    const sizer = scroll.createDiv({ cls: "bloommd-nav-sizer" });
    scroll.addEventListener("keydown", (event) => this.onKeyDown(event));
    scroll.addEventListener("focusin", () => {
      this.state = focusArea(this.state, area);
      this.contentEl.dataset.focus = this.state.focus;
    });
    scroll.addEventListener("scroll", () => this.renderRows(area === "tree" ? this.tree : this.list, false));
    const observer = new ResizeObserver(() => this.renderRows(area === "tree" ? this.tree : this.list, false));
    observer.observe(scroll);
    this.register(() => observer.disconnect());
    return { area, scroll, sizer, title: titleEl };
  }

  private renderHelp() {
    this.help.empty();
    this.help.createEl("strong", { text: "Keyboard" });
    const table = this.help.createEl("table");
    for (const shortcut of NAVIGATOR_SHORTCUTS) {
      const row = table.createEl("tr");
      row.createEl("td").createEl("kbd", { text: this.shortcutKeys(shortcut.keys) });
      row.createEl("td", { text: shortcut.area });
      row.createEl("td", { text: shortcut.action });
    }
    this.help.createEl("strong", { text: "Focus areas" });
    const areas = this.help.createEl("ul");
    for (const text of NAVIGATOR_FOCUS_AREAS) areas.createEl("li", { text });
  }

  // ── Rendering ───────────────────────────────────────────────────────────────────────────────

  private render() {
    this.contentEl.dataset.focus = this.state.focus;
    this.renderContext();
    this.renderRows(this.tree, true);
    this.renderRows(this.list, true);
    this.list.title.setText(`Notes in ${this.folderLabel(this.state.folder)} (${listFiles(this.root, this.state).length})`);
  }

  private folderLabel(path: string) {
    return path === ROOT_PATH ? this.root.name : shortenMiddle(path, PATH_LABEL_MAX);
  }

  /** The two contexts, kept visibly apart: where you are browsing, and what the map shows. */
  private renderContext() {
    if (!this.browseContext) return;
    this.browseContext.empty();
    setIcon(this.browseContext.createSpan({ cls: "bloommd-nav-context-icon" }), "folder");
    const file = this.state.file === null ? "" : ` › ${shortenMiddle(baseName(this.state.file.split("/").pop() ?? ""), PATH_LABEL_MAX)}`;
    this.browseContext.createSpan({ text: `Browsing: ${this.folderLabel(this.state.folder)}${file}` });
    this.browseContext.setAttribute("title", this.state.file ?? this.state.folder);

    const map = this.host.mapTarget();
    this.mapContext.empty();
    this.mapContext.dataset.kind = map?.kind ?? "none";
    setIcon(this.mapContext.createSpan({ cls: "bloommd-nav-context-icon" }), "git-branch");
    const mapLabel = map ? (map.kind === "file" ? `note ${shortenMiddle(baseName(map.path.split("/").pop() ?? ""), PATH_LABEL_MAX)}` : `folder ${map.path === ROOT_PATH ? this.root.name : shortenMiddle(map.path, PATH_LABEL_MAX)}`) : "no map open";
    this.mapContext.createSpan({ text: `Map: ${mapLabel}` });
    this.mapContext.setAttribute("title", map?.path ?? "");

    const focused: HistoryButton | null = document.activeElement === this.backButton ? "back" : document.activeElement === this.forwardButton ? "forward" : null;
    this.backButton.disabled = !canGoBack(this.state);
    this.forwardButton.disabled = !canGoForward(this.state);
    // A button that has just been disabled drops focus onto <body>: hand it to something usable.
    const next = focusAfterHistory(this.state, focused);
    if (next === "back") this.backButton.focus();
    else if (next === "forward") this.forwardButton.focus();
    else if (next) this.focusPane(next);
    this.noteMapButton.disabled = this.state.file === null;
    this.folderMapButton.disabled = this.state.folder === ROOT_PATH;
  }

  /** Renders the rows in view of one pane; with `reveal` the selected row is scrolled into view first. */
  private renderRows(pane: Pane, reveal: boolean) {
    if (!pane?.scroll) return;
    const tree = pane.area === "tree";
    const rows = tree ? visibleRows(this.root, this.state.expanded) : listFiles(this.root, this.state);
    const selected = tree ? treeIndex(this.root, this.state) : listIndex(this.root, this.state);
    const viewport = pane.scroll.clientHeight || FALLBACK_VIEWPORT;
    pane.sizer.setCssProps({ "--bloommd-nav-height": `${rows.length * this.rowHeight}px` });
    if (reveal && selected >= 0) pane.scroll.scrollTop = scrollToReveal(selected, pane.scroll.scrollTop, viewport, this.rowHeight);

    const range = visibleWindow(rows.length, pane.scroll.scrollTop, viewport, this.rowHeight);
    pane.sizer.empty();
    pane.scroll.removeAttribute("aria-activedescendant");
    for (let index = range.start; index < range.end; index += 1) {
      const row = rows[index];
      if (!row) continue;
      const id = `bloommd-nav-${pane.area}-${index}`;
      const isSelected = index === selected;
      const el = pane.sizer.createDiv({
        cls: ["bloommd-nav-row", isSelected ? "is-selected" : ""].filter(Boolean),
        attr: { id, role: tree ? "treeitem" : "option", "aria-selected": String(isSelected) },
      });
      el.setCssProps({ "--bloommd-nav-top": `${index * this.rowHeight}px` });
      if (isSelected) pane.scroll.setAttribute("aria-activedescendant", id);
      if (isTreeRow(row)) this.renderFolderRow(el, row);
      else this.renderFileRow(el, row.path, row.name);
    }
  }

  private renderFolderRow(el: HTMLElement, row: TreeRow) {
    el.setAttribute("aria-level", String(row.depth + 1));
    if (row.hasChildren) el.setAttribute("aria-expanded", String(row.expanded));
    el.setCssProps({ "--bloommd-nav-depth": String(row.depth) });
    const chevron = el.createSpan({ cls: "bloommd-nav-chevron" });
    if (row.hasChildren) {
      setIcon(chevron, row.expanded ? "chevron-down" : "chevron-right");
      if (row.path !== ROOT_PATH) {
        chevron.addEventListener("click", (event) => {
          event.stopPropagation();
          this.state = toggleFolder(this.state, row.path);
          this.render();
        });
      }
    }
    el.createSpan({ cls: "bloommd-nav-label", text: row.name });
    el.setAttribute("title", row.path === ROOT_PATH ? this.root.name : row.path);
    el.addEventListener("click", () => {
      this.state = focusArea(selectFolder(this.state, this.root, row.path, true), "tree");
      this.render();
      this.focusPane("tree");
    });
    el.addEventListener("dblclick", () => {
      this.state = toggleFolder(this.state, row.path);
      this.render();
    });
  }

  private renderFileRow(el: HTMLElement, path: string, name: string) {
    el.createSpan({ cls: "bloommd-nav-label", text: baseName(name) });
    el.setAttribute("title", path);
    el.addEventListener("click", () => {
      // A click opens the note and hands focus to the editor, as in Obsidian's own file explorer.
      this.state = focusArea(selectFile(this.state, this.root, path, true), "list");
      this.render();
      void this.openFile(path, false);
    });
  }

  // ── Keyboard, focus and effects ─────────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.altKey) return;
    const mod = Keymap.isModifier(event, "Mod");
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (!HANDLED_KEYS.has(key)) return;
    if (mod ? key !== "[" && key !== "]" : event.ctrlKey || event.metaKey) return;
    if (key === "m" && event.shiftKey) return;
    const input: NavKey = { key, shift: event.shiftKey, mod };
    event.preventDefault();
    this.apply(handleKey(this.state, this.root, input, { map: this.host.mapTarget() !== null, search: false }));
  }

  /** Escape while the map is the active view: back to the list or tree the map was opened from. */
  private onMapKeyDown(event: KeyboardEvent) {
    if (this.state.focus !== "map" || event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // Text fields, menus and dialogs own their Escape.
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true'], .menu, .modal-container")) return;
    if (!this.host.mapViewActive()) return;
    event.preventDefault();
    this.apply(handleKey(this.state, this.root, { key: "Escape" }, { map: this.host.mapTarget() !== null, search: false }));
  }

  private apply(result: NavResult) {
    this.state = result.state;
    this.render();
    if (this.state.focus === "tree" || this.state.focus === "list") this.focusPane(this.state.focus);
    for (const effect of result.effects) this.run(effect);
  }

  private focusPane(area: FocusArea) {
    if (area === "tree" || area === "list") (area === "tree" ? this.tree : this.list).scroll.focus();
  }

  private run(effect: NavEffect) {
    switch (effect.type) {
      case "open-file":
        void this.openFile(effect.path, true);
        break;
      case "open-map":
        void this.openMap(effect.kind, effect.path);
        break;
      case "focus-map":
        this.host.focusMapView();
        break;
      case "focus-editor": {
        const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
        if (leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
        break;
      }
    }
  }

  /** Opens a note. From the keyboard the navigator keeps focus, so the next arrow key still browses. */
  private async openFile(path: string, keepFocus: boolean) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("BloomMD: This note no longer exists.");
      return;
    }
    await this.host.openNote(file);
    if (!keepFocus) return;
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    this.focusPane(this.state.focus);
  }

  private async openMap(kind: "file" | "folder", path: string) {
    if (kind === "folder" && path === ROOT_PATH) {
      new Notice("BloomMD: Select a folder to map. The whole vault is not mapped at once.");
      return;
    }
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile) && !(target instanceof TFolder)) {
      new Notice("BloomMD: Select a note or folder first.");
      return;
    }
    await this.host.openMapFor(target);
    this.state = enterMap(this.state);
    this.render();
    this.host.focusMapView();
  }
}
