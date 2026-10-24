import "./structured-clone-fallback";
import "./preact-scheduling";
import {
  App,
  Component,
  FileSystemAdapter,
  FuzzySuggestModal,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  SuggestModal,
  TFile,
  TFolder,
  Setting,
  WorkspaceLeaf,
  type EventRef,
  type SettingDefinitionItem,
  type SettingDefinitionRender,
} from "obsidian";
import {
  addChildHeading,
  addSiblingHeading,
  copyHeadingBranch,
  deleteHeadingBranch,
  ensureHeadingIds,
  findHeading,
  findHeadingParent,
  metadataEquals,
  moveHeadingBranch,
  parseHeadingTree,
  renameHeading,
  updateHeadingMetadata,
  updateHeadingContent,
  type MarkdownHeadingNode,
} from "./markdown-document";
import {
  FOCUS_MODE_EVENT,
  createCanvasMount,
  type BacklinkEntry,
  type CanvasHeading,
  type CanvasMount,
  type PersistedCanvasLayout,
  type ResourceEntry,
} from "./canvas";
import { historyFocusId } from "./history-focus";
import { conflictFileName, linkDrawingIntoNode, saveDrawing } from "./drawing-save";
import { linkTargetsPath, parseInkSvg, retargetInkLinks, serializeInkSvg } from "./ink-document";
import { appendSvgEmbed, ensureWikiLink, inkFileName } from "./ink-embeds";
import { BLOOMMD_DOWNLOAD_URL, desktopNodeId, desktopOpenUrl, mobileOpenUrl } from "./open-app";
import { desktopDeps, openNoteInDesktop } from "./desktop-handoff";
import { MAP_INK_PROPERTY, createLinkedMapInk, mapInkLink, retargetLinkedNotes, withLinkedNote } from "./concept-map";
import { migratePersistedPathState } from "./path-migration";
import { LEARNING_FOLDER, emptyLearningFile, learningFilePath, learningKey, normalizeLearningSettings, rateEntry, type LearningFile, type LearningSettings, type StudyOrder } from "./learning";
import { LearningStore } from "./learning-store";
import { STUDY_ORDERS } from "./learning-panel";
import { AgentHub, confirmAction } from "./agent-view";
import type { ObsidianSharedDocumentEntry, ObsidianSharedDocumentSession } from "./shared-document";

const VIEW_TYPE_BLOOMMD = "bloommd-mindmap-view";
const BLOOMMD_WEB_DEMO = "https://bloommd.io/demo";
const COLLABORATION_TOKEN_SECRET_ID = "bloommd-collaboration-token";
/** Folder renames arrive as one event per note; wait for the burst before scanning the vault. */
const NOTE_RETARGET_DELAY_MS = 300;

type SharedDocumentRuntime = typeof import("./shared-runtime");

/**
 * Collaboration is an opt-in feature. The runtime is a second CommonJS artifact so opening a
 * purely local vault note never has to parse Yjs and the sync protocol.
 */
/**
 * Obsidian mobile cannot load a second plugin script, so shared mode is desktop-only for now; local
 * editing, handwriting and maps work everywhere.
 */
const SHARED_MODE_UNAVAILABLE = "BloomMD: Shared mode is not available in Obsidian mobile yet. Your note stays fully editable on this device.";

function loadSharedDocumentRuntime(): Promise<SharedDocumentRuntime> {
  return import("./shared-runtime");
}

interface BloomMDSettings {
  openTarget: "desktop" | "web";
  /** The BloomMD app is installed on this iPad/iPhone with this vault opened as its folder. */
  mobileAppInstalled: boolean;
  showNodeContent: boolean;
  collaborationServerUrl: string;
  collaborationWorkspaceId: string;
  learning: LearningSettings;
  /** Recorded as reviewer when this person approves or rejects agent proposals. */
  agentReviewer: string;
}

interface BloomMDData {
  settings: BloomMDSettings;
  layouts: Record<string, PersistedCanvasLayout>;
  sharedDocumentBindings: ObsidianSharedDocumentEntry[];
}

interface HistoryEntry {
  before: string;
  after: string;
}

type SharedDocumentChoice =
  | { kind: "new"; filename: string }
  | { kind: "existing"; filename: string };

class SharedDocumentChoiceModal extends SuggestModal<SharedDocumentChoice> {
  private settled = false;

  constructor(
    app: App,
    private readonly choices: SharedDocumentChoice[],
    private readonly resolveChoice: (choice: SharedDocumentChoice | null) => void,
  ) {
    super(app);
    this.setPlaceholder("Create a new cloud document or bind an existing one…");
  }

  getSuggestions(query: string): SharedDocumentChoice[] {
    const normalized = query.trim().toLocaleLowerCase();
    return this.choices.filter((choice) => !normalized || choice.filename.toLocaleLowerCase().includes(normalized));
  }

  renderSuggestion(choice: SharedDocumentChoice, element: HTMLElement): void {
    element.createEl("div", { text: choice.kind === "new" ? `Create new: ${choice.filename}` : `Bind existing: ${choice.filename}` });
    element.createEl("small", { text: choice.kind === "new" ? "Only this note will be uploaded." : "No new cloud document will be created." });
  }

  onChooseSuggestion(choice: SharedDocumentChoice): void {
    this.finish(choice);
  }

  onClose(): void {
    super.onClose();
    this.finish(null);
  }

  private finish(choice: SharedDocumentChoice | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveChoice(choice);
  }
}

class NotePickerModal extends FuzzySuggestModal<TFile> {
  private settled = false;

  constructor(app: App, private readonly sourcePath: string, private readonly resolveNote: (linktext: string | null) => void) {
    super(app);
    this.setPlaceholder("Link handwriting to a note…");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path.replace(/\.md$/, "");
  }

  onChooseItem(file: TFile): void {
    this.finish(this.app.metadataCache.fileToLinktext(file, this.sourcePath, true));
  }

  onClose(): void {
    super.onClose();
    // Obsidian closes a suggest modal before it reports the chosen item, so a cancel is only
    // certain once the current task has finished.
    window.setTimeout(() => this.finish(null), 0);
  }

  private finish(linktext: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveNote(linktext);
  }
}

function pickNote(app: App, sourcePath: string): Promise<string | null> {
  return new Promise((resolveNote) => new NotePickerModal(app, sourcePath, resolveNote).open());
}

function chooseSharedDocument(app: App, choices: SharedDocumentChoice[]): Promise<SharedDocumentChoice | null> {
  return new Promise((resolveChoice) => new SharedDocumentChoiceModal(app, choices, resolveChoice).open());
}

const DEFAULT_SETTINGS: BloomMDSettings = {
  openTarget: "desktop",
  mobileAppInstalled: false,
  showNodeContent: true,
  collaborationServerUrl: "https://bloommd.app",
  collaborationWorkspaceId: "",
  learning: normalizeLearningSettings(undefined),
  agentReviewer: "",
};

const EMPTY_LAYOUT: PersistedCanvasLayout = { positions: {}, collapsed: [] };

function confirmDelete(app: App, title: string): Promise<boolean> {
  return confirmAction(app, "Delete branch?", `Delete "${title}" and its complete branch?`, "Delete branch");
}

function canvasHeadings(nodes: MarkdownHeadingNode[]): CanvasHeading[] {
  const result: CanvasHeading[] = [];
  const walk = (node: MarkdownHeadingNode, parentId: string | null) => {
    result.push({
      id: node.id,
      parentId,
      level: node.level,
      title: node.title,
      content: node.content,
      children: node.children.map((child) => child.id),
      kind: "heading",
      ...(node.metadata ? { metadata: node.metadata } : {}),
    });
    node.children.forEach((child) => walk(child, node.id));
  };
  nodes.forEach((node) => walk(node, null));
  return result;
}

function folderHeadings(folder: TFolder): CanvasHeading[] {
  const result: CanvasHeading[] = [];
  const walk = (current: TFolder, parentId: string | null, level: number) => {
    const id = `folder:${current.path || "/"}`;
    const children = current.children
      .filter((child) => child instanceof TFolder || (child instanceof TFile && child.extension === "md"))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    result.push({
      id,
      parentId,
      level,
      title: current.isRoot() ? "Vault" : current.name,
      content: current.path || "Vault root",
      children: children.map((child) => child instanceof TFolder ? `folder:${child.path}` : `file:${child.path}`),
      kind: "folder",
      filePath: current.path,
    });
    children.forEach((child) => {
      if (child instanceof TFolder) {
        walk(child, id, Math.min(level + 1, 6));
      } else {
        result.push({
          id: `file:${child.path}`,
          parentId: id,
          level: Math.min(level + 1, 6),
          title: child instanceof TFile ? child.basename : child.name,
          content: child.path,
          children: [],
          kind: "file",
          filePath: child.path,
        });
      }
    });
  };
  walk(folder, null, 1);
  return result;
}

function filesInFolder(folder: TFolder | null): TFile[] {
  if (!folder) return [];
  const result: TFile[] = [];
  const walk = (current: TFolder) => {
    for (const child of current.children) {
      if (child instanceof TFile) result.push(child);
      else if (child instanceof TFolder) walk(child);
    }
  };
  walk(folder);
  return result;
}

class BloomMDView extends ItemView {
  private sourceFile: TFile | null = null;
  private scopeFolder: TFolder | null = null;
  private layoutKey = "";
  private headings: CanvasHeading[] = [];
  private rootId = "";
  private mount: CanvasMount | null = null;
  private writing = false;
  private lastKnownMarkdown = "";
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private mutationQueue: Promise<unknown> = Promise.resolve();
  /** Bumped when the map drawing changes on disk, so the canvas can pick up synced versions. */
  private mapInkRevision = 0;
  /** Personal learning progress of the open note (never part of its Markdown). */
  private learning: LearningFile | null = null;
  /** Nodes the agent changed since this map was last opened; marked on the map. */
  private agentChanged = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: BloomMDPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_BLOOMMD;
  }

  getDisplayText(): string {
    return this.sourceFile?.basename ?? "BloomMD";
  }

  getIcon(): string {
    return "git-branch";
  }

  async onOpen() {
    // The map drawing is linked from the frontmatter; re-render once Obsidian has indexed a new link.
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file.path === this.sourceFile?.path) this.renderCanvas();
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "svg" || file.path !== this.mapInkPath(this.sourceFile)) return;
      this.mapInkRevision += 1;
      this.renderCanvas();
    }));
    this.contentEl.empty();
    this.contentEl.addClass("bloommd-view-host");
    this.mount = createCanvasMount(this.contentEl);
    this.renderCanvas();
  }

  async onClose() {
    this.mount?.unmount();
    this.mount = null;
  }

  setNote(file: TFile, markdown: string) {
    if (this.sourceFile?.path !== file.path) {
      this.undoStack = [];
      this.redoStack = [];
      this.learning = null;
    }
    // Opening a map shows what the agent changed since it was last opened here, then counts as seen.
    this.agentChanged = new Set();
    void this.plugin.agent.changedNodes(file.path, markdown).then((ids) => {
      if (!ids.size || this.sourceFile !== file) return;
      this.agentChanged = ids;
      this.renderCanvas();
    }, (error: unknown) => console.error("BloomMD: agent changes could not be read", error));
    this.sourceFile = file;
    this.scopeFolder = file.parent;
    this.layoutKey = `file:${file.path}`;
    this.lastKnownMarkdown = markdown;
    const tree = parseHeadingTree(markdown);
    this.headings = canvasHeadings(tree);
    this.rootId = tree[0]?.id ?? "";
    this.renderCanvas();
    void this.reloadLearning();
  }

  /** The open note, when the view shows one (folders have no learning progress). */
  mapFile(): TFile | null {
    return this.sourceFile;
  }

  /** Re-reads the progress file, e.g. after it changed on disk or arrived from another device. */
  async reloadLearning(): Promise<void> {
    const file = this.sourceFile;
    if (!file || !this.plugin.settings.learning.enabled) {
      if (this.learning) {
        this.learning = null;
        this.renderCanvas();
      }
      return;
    }
    try {
      const loaded = await this.plugin.loadLearning(file);
      if (this.sourceFile !== file) return;
      this.learning = loaded;
      this.renderCanvas();
    } catch (error) {
      console.error("BloomMD could not read learning progress", error);
    }
  }

  usesLearningFile(path: string): boolean {
    return Boolean(this.sourceFile) && learningFilePath(this.plugin.learningKey(this.sourceFile!)) === path;
  }

  /** Changes the progress at once on screen, then merges it into the file on disk. */
  updateLearning(change: (file: LearningFile) => LearningFile) {
    const file = this.sourceFile;
    if (!file) return Promise.resolve();
    const withPath = (current: LearningFile) => ({ ...change(current), path: file.path });
    this.learning = withPath(this.learning ?? emptyLearningFile());
    this.renderCanvas();
    return this.plugin.learningStore.update(this.plugin.learningKey(file), withPath).then((saved) => {
      if (this.sourceFile !== file) return;
      this.learning = saved;
      this.renderCanvas();
    }).catch((error: unknown) => {
      console.error("BloomMD could not save learning progress", error);
      new Notice("BloomMD: Your learning progress could not be saved. It is kept until the next rating.");
    });
  }

  private readonly rateNode = (id: string, level: number) => {
    const settings = this.plugin.settings.learning;
    const now = new Date();
    void this.updateLearning((current) => ({ ...current, entries: { ...current.entries, [id]: rateEntry(current.entries[id], level, settings, now) } }));
  };

  private readonly setExamDate = (date: string | null) => {
    const examUpdated = new Date().toISOString();
    void this.updateLearning(({ examDate: _previous, ...current }) => (date ? { ...current, examDate: date, examUpdated } : { ...current, examUpdated }));
  };

  setFolder(folder: TFolder) {
    this.learning = null;
    this.sourceFile = null;
    this.scopeFolder = folder;
    this.layoutKey = `folder:${folder.path || "/"}`;
    this.headings = folderHeadings(folder);
    this.rootId = this.headings[0]?.id ?? "";
    this.undoStack = [];
    this.redoStack = [];
    this.renderCanvas();
  }

  async handleFileChange(file: TFile) {
    if (this.writing || this.sourceFile?.path !== file.path) return;
    const current = await this.app.vault.read(file);
    const withIds = ensureHeadingIds(current);
    let markdown = current;
    if (withIds.changed) {
      this.writing = true;
      try {
        markdown = await this.app.vault.process(file, (latest) => ensureHeadingIds(latest).markdown);
      } finally {
        this.writing = false;
      }
    }
    if (markdown === this.lastKnownMarkdown) return;
    this.lastKnownMarkdown = markdown;
    this.undoStack = [];
    this.redoStack = [];
    const tree = parseHeadingTree(markdown);
    this.headings = canvasHeadings(tree);
    this.rootId = tree[0]?.id ?? "";
    this.renderCanvas();
  }

  private queueMutation<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.then(task, task);
    this.mutationQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private applyMutation(transform: (markdown: string) => string): Promise<boolean> {
    return this.queueMutation(async () => {
      if (!this.sourceFile) return false;
      this.writing = true;
      try {
        let before = "";
        const after = await this.app.vault.process(this.sourceFile, (current) => {
          before = current;
          return ensureHeadingIds(transform(current)).markdown;
        });
        if (before !== after) {
          this.undoStack.push({ before, after });
          if (this.undoStack.length > 30) this.undoStack.shift();
          this.redoStack = [];
        }
        this.updateFromMarkdown(after);
        return true;
      } catch (error) {
        this.showError(error);
        return false;
      } finally {
        this.writing = false;
      }
    });
  }

  private restoreHistory(direction: "undo" | "redo", selectedId: string | null): Promise<string | null> {
    return this.queueMutation(async () => {
      if (!this.sourceFile) return null;
      const source = direction === "undo" ? this.undoStack : this.redoStack;
      const target = direction === "undo" ? this.redoStack : this.undoStack;
      const entry = source[source.length - 1];
      if (!entry) return null;
      this.writing = true;
      try {
        const expected = direction === "undo" ? entry.after : entry.before;
        const replacement = direction === "undo" ? entry.before : entry.after;
        const focusId = historyFocusId(expected, replacement, selectedId);
        const markdown = await this.app.vault.process(this.sourceFile, (current) => {
          if (current !== expected) throw new Error("The note changed outside BloomMD. History restore was cancelled.");
          return replacement;
        });
        source.pop();
        target.push(entry);
        this.updateFromMarkdown(markdown);
        return focusId;
      } catch (error) {
        this.showError(error);
        return null;
      } finally {
        this.writing = false;
      }
    });
  }

  private updateFromMarkdown(markdown: string) {
    this.lastKnownMarkdown = markdown;
    const tree = parseHeadingTree(markdown);
    this.headings = canvasHeadings(tree);
    this.rootId = tree[0]?.id ?? "";
    this.renderCanvas();
  }

  private showError(error: unknown) {
    new Notice(`BloomMD: ${error instanceof Error ? error.message : "The Markdown file could not be updated."}`);
  }

  private currentNode(markdown: string, id: string): MarkdownHeadingNode {
    const node = findHeading(parseHeadingTree(markdown), id);
    if (!node) throw new Error("The node no longer exists. The mind map was refreshed.");
    return node;
  }

  private async addChildNode(id: string): Promise<string | null> {
    let createdId: string | null = null;
    const saved = await this.applyMutation((markdown) => {
      const updated = addChildHeading(markdown, id);
      const parent = findHeading(parseHeadingTree(updated), id);
      createdId = parent?.children[parent.children.length - 1]?.id ?? null;
      return updated;
    });
    return saved ? createdId : null;
  }

  private async addSiblingNode(id: string): Promise<string | null> {
    let createdId: string | null = null;
    const saved = await this.applyMutation((markdown) => {
      const updated = addSiblingHeading(markdown, id);
      const tree = parseHeadingTree(updated);
      const source = findHeading(tree, id);
      const siblings = source ? findHeadingParent(tree, id)?.children : null;
      const index = siblings?.findIndex((node) => node.id === id) ?? -1;
      createdId = index >= 0 ? siblings?.[index + 1]?.id ?? null : null;
      return updated;
    });
    return saved ? createdId : null;
  }

  /**
   * Writes a drawing. Existing files are only replaced when they still match what the editor loaded
   * (another device may have synced a newer version); new files go to the vault's attachment folder
   * and are embedded into the node through the same conflict-checked mutation as text edits.
   * `sourceFile` is the note the drawing was opened from, which may no longer be the one shown.
   */
  private async saveInk(sourceFile: TFile, nodeId: string, path: string | null, svg: string, expectedSvg: string | null, conflictOf?: string): Promise<string | null> {
    const saved = await saveDrawing({
      replace: async (target, content, expected) => {
        const file = this.app.vault.getAbstractFileByPath(target);
        if (!(file instanceof TFile)) throw new Error("The drawing file was moved or deleted.");
        await this.app.vault.process(file, (current) => {
          if (expected !== null && current !== expected) throw new Error("This drawing changed outside BloomMD.");
          return content;
        });
      },
      create: async (fileName, content) => {
        const target = await this.app.fileManager.getAvailablePathForAttachment(fileName, sourceFile.path);
        const folder = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        return (await this.app.vault.create(target, content)).path;
      },
      link: (content, createdPath) => {
        const created = createdPath ? this.app.vault.getAbstractFileByPath(createdPath) : null;
        const link = created instanceof TFile ? this.app.metadataCache.fileToLinktext(created, sourceFile.path, false) : createdPath;
        return this.linkInkTargets(sourceFile, nodeId, content, (markdown) => (link ? appendSvgEmbed(markdown, link) : markdown));
      },
      notify: (message) => new Notice(`BloomMD: ${message}`),
    }, { path, svg, expectedSvg, conflictOf, noteBasename: sourceFile.basename });
    if (saved) this.renderCanvas();
    return saved;
  }

  /**
   * Applies `prepare` to the node content and adds `[[target]]` for every note the drawing links to,
   * so Obsidian's graph, backlinks and rename handling know about handwriting links. Unchanged
   * content is not rewritten and leaves the undo history alone. Resolves to false when the node is
   * gone; a note that is no longer shown is updated directly, outside this view's history.
   */
  private async linkInkTargets(sourceFile: TFile, nodeId: string, svg: string, prepare: (content: string) => string): Promise<boolean> {
    const targets = [...new Set(parseInkSvg(svg)?.document.links.map((link) => link.target) ?? [])];
    let found = false;
    const transform = (markdown: string) => {
      const linked = linkDrawingIntoNode(markdown, nodeId, targets, prepare);
      found = linked.found;
      return linked.markdown;
    };
    if (this.sourceFile?.path !== sourceFile.path) {
      await this.app.vault.process(sourceFile, transform);
      return found;
    }
    if (transform(this.lastKnownMarkdown) === this.lastKnownMarkdown) return found;
    const saved = await this.applyMutation(transform);
    return saved && found;
  }

  /**
   * Saves the handwriting drawn on the map. A new drawing becomes `<note> map ink.svg` in the
   * attachment folder and is linked from the note's frontmatter; later saves only replace a file
   * that still matches what was loaded. When that file changed elsewhere, the replace fails quietly
   * and the session retries with `conflictOf`: while the note still links a map drawing, the strokes
   * are kept as an unlinked "(conflict)" copy beside it and the map shows the other version.
   */
  private async saveMapInk(sourceFile: TFile, path: string | null, svg: string, expectedSvg: string | null, conflictOf?: string): Promise<string | null> {
    if (path) {
      const file = this.app.vault.getAbstractFileByPath(path);
      try {
        if (!(file instanceof TFile)) throw new Error("The map drawing was moved or deleted.");
        await this.app.vault.process(file, (current) => {
          if (expectedSvg !== null && current !== expectedSvg) throw new Error("The map drawing changed outside BloomMD.");
          return svg;
        });
      } catch (error) {
        console.warn(`BloomMD did not overwrite ${path}`, error);
        return null;
      }
      return path;
    }
    try {
      if (conflictOf && this.mapInkPath(sourceFile)) {
        const created = await this.createAttachment(sourceFile, conflictFileName(conflictOf), svg);
        new Notice(`BloomMD: ${conflictOf} changed outside BloomMD or was moved. The map shows that version; your strokes were kept as ${created}.`);
        return created;
      }
      return await createLinkedMapInk({
        create: () => this.createAttachment(sourceFile, `${sourceFile.basename} map ink.svg`, svg),
        link: (created) => this.linkMapInk(sourceFile, created),
        warn: (message) => new Notice(message),
      });
    } catch (error) {
      this.showError(error);
      return null;
    }
  }

  /** Writes a new file into the attachment folder of `sourceFile` under a free name; resolves to its path. */
  private async createAttachment(sourceFile: TFile, fileName: string, content: string): Promise<string> {
    const target = await this.app.fileManager.getAvailablePathForAttachment(fileName, sourceFile.path);
    const folder = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    return (await this.app.vault.create(target, content)).path;
  }

  /**
   * Links the map drawing from the note's frontmatter. It runs in the mutation queue like every
   * other note edit and becomes an undo step, so the history keeps matching the note on disk.
   */
  private linkMapInk(sourceFile: TFile, drawingPath: string): Promise<boolean> {
    return this.queueMutation(async () => {
      const drawing = this.app.vault.getAbstractFileByPath(drawingPath);
      if (!(drawing instanceof TFile)) return false;
      const link = this.app.metadataCache.fileToLinktext(drawing, sourceFile.path, false);
      this.writing = true;
      try {
        const before = await this.app.vault.read(sourceFile);
        await this.app.fileManager.processFrontMatter(sourceFile, (frontmatter: Record<string, unknown>) => {
          frontmatter[MAP_INK_PROPERTY] = `[[${link}]]`;
        });
        if (this.sourceFile !== sourceFile) return true;
        const after = await this.app.vault.read(sourceFile);
        if (before !== after) {
          this.undoStack.push({ before, after });
          if (this.undoStack.length > 30) this.undoStack.shift();
          this.redoStack = [];
        }
        this.updateFromMarkdown(after);
        return true;
      } finally {
        this.writing = false;
      }
    });
  }

  private mapInkPath(sourceFile: TFile | null): string | null {
    if (!sourceFile) return null;
    const link = mapInkLink(this.app.metadataCache.getFileCache(sourceFile)?.frontmatter?.[MAP_INK_PROPERTY]);
    return link ? this.app.metadataCache.getFirstLinkpathDest(link, sourceFile.path)?.path ?? null : null;
  }

  /**
   * Turns part of a sketch into structure: a new child node whose content embeds its own drawing.
   * Node, title, embed and links are one mutation, so a single map undo removes all of it.
   */
  private async createNodeFromInk(parentId: string, svg: string, title: string): Promise<string | null> {
    const sourceFile = this.sourceFile;
    if (!sourceFile) return null;
    try {
      const target = await this.app.fileManager.getAvailablePathForAttachment(inkFileName(sourceFile.basename), sourceFile.path);
      const folder = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const file = await this.app.vault.create(target, svg);
      const link = this.app.metadataCache.fileToLinktext(file, sourceFile.path, false);
      const targets = [...new Set(parseInkSvg(svg)?.document.links.map((entry) => entry.target) ?? [])];
      let createdId: string | null = null;
      const saved = await this.applyMutation((markdown) => {
        const added = addChildHeading(markdown, parentId);
        const parent = findHeading(parseHeadingTree(added), parentId);
        const child = parent?.children[parent.children.length - 1];
        if (!child) throw new Error("The new node could not be created.");
        const renamed = renameHeading(added, child.id, title);
        const siblings = findHeading(parseHeadingTree(renamed), parentId)?.children ?? [];
        const renamedChild = siblings[siblings.length - 1];
        if (!renamedChild) throw new Error("The new node could not be created.");
        createdId = renamedChild.id;
        const content = targets.reduce(ensureWikiLink, appendSvgEmbed(this.currentNode(renamed, renamedChild.id).content, link));
        return updateHeadingContent(renamed, renamedChild.id, content);
      });
      return saved ? createdId : null;
    } catch (error) {
      this.showError(error);
      return null;
    }
  }

  private backlinks(): BacklinkEntry[] {
    if (!this.sourceFile) return [];
    const result: BacklinkEntry[] = [];
    for (const [sourcePath, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      if (!targets[this.sourceFile.path]) continue;
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (file instanceof TFile) result.push({ path: file.path, title: file.basename });
    }
    return result.sort((a, b) => a.title.localeCompare(b.title));
  }

  private renderCanvas() {
    if (!this.mount) return;
    const sourceFile = this.sourceFile;
    const editable = Boolean(sourceFile);
    this.mount.render({
      filePath: sourceFile?.path ?? this.layoutKey,
      headings: this.agentChanged.size ? this.headings.map((heading) => (this.agentChanged.has(heading.id) ? { ...heading, agentChanged: true } : heading)) : this.headings,
      rootId: this.rootId,
      files: this.plugin.markdownFiles(this.scopeFolder),
      backlinks: this.backlinks(),
      layout: this.plugin.getLayout(this.layoutKey),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      showNodeContent: this.plugin.settings.showNodeContent,
      sharedStatus: sourceFile ? this.plugin.getSharedDocumentStatus(sourceFile.path) : null,
      mapInkPath: this.mapInkPath(sourceFile),
      // On iPad and iPhone only the BloomMD app (when installed, see settings) can open the note.
      canOpenApp: !Platform.isMobile || this.plugin.settings.mobileAppInstalled,
      mapInkRevision: this.mapInkRevision,
      learning: sourceFile && this.learning && this.plugin.settings.learning.enabled
        ? { settings: this.plugin.settings.learning, entries: this.learning.entries, examDate: this.learning.examDate ?? null, rate: this.rateNode, setExamDate: this.setExamDate }
        : null,
      resources: this.plugin.resourceFiles(this.scopeFolder),
      actions: {
        renameNode: (id, title, expectedTitle) => editable
          ? this.applyMutation((markdown) => {
              const node = this.currentNode(markdown, id);
              if (node.title !== expectedTitle) throw new Error("This title changed in Obsidian. Reload before renaming it.");
              return renameHeading(markdown, id, title);
            })
          : Promise.resolve(false),
        updateContent: (id, content, expectedContent) => editable
          ? this.applyMutation((markdown) => {
              const node = this.currentNode(markdown, id);
              if (node.content !== expectedContent) throw new Error("This node changed in Obsidian. Your draft was kept in the inspector.");
              return updateHeadingContent(markdown, id, content);
            })
          : Promise.resolve(false),
        updateMetadata: (id, metadata, expectedMetadata) => editable
          ? this.applyMutation((markdown) => {
              const node = this.currentNode(markdown, id);
              if (!metadataEquals(node.metadata, expectedMetadata)) throw new Error("This node metadata changed in Obsidian. Reload before editing it.");
              return updateHeadingMetadata(markdown, id, metadata);
            })
          : Promise.resolve(false),
        addChild: (id) => editable ? this.addChildNode(id) : Promise.resolve(null),
        addSibling: (id) => editable ? this.addSiblingNode(id) : Promise.resolve(null),
        deleteBranch: async (id) => {
          if (!editable) return false;
          const node = this.headings.find((heading) => heading.id === id);
          if (!node) return false;
          if (!(await confirmDelete(this.app, node.title))) return false;
          return this.applyMutation((markdown) => deleteHeadingBranch(markdown, id));
        },
        reparentBranch: (id, parentId) => {
          if (!editable) return Promise.resolve(false);
          const node = this.headings.find((heading) => heading.id === id);
          if (node?.parentId === parentId) return Promise.resolve(true);
          return this.applyMutation((markdown) => moveHeadingBranch(markdown, id, parentId));
        },
        copyBranches: (sourceIds, targetParentId) => {
          if (!editable || sourceIds.length === 0) return Promise.resolve(false);
          const selected = new Set(sourceIds);
          const roots = sourceIds.filter((id) => {
            let parent = this.headings.find((heading) => heading.id === id)?.parentId ?? null;
            while (parent) {
              if (selected.has(parent)) return false;
              parent = this.headings.find((heading) => heading.id === parent)?.parentId ?? null;
            }
            return true;
          });
          return this.applyMutation((markdown) => roots.reduce(
            (current, sourceId) => copyHeadingBranch(current, sourceId, targetParentId),
            markdown,
          ));
        },
        undo: (selectedId) => this.restoreHistory("undo", selectedId),
        redo: (selectedId) => this.restoreHistory("redo", selectedId),
        persistLayout: (layout) => this.plugin.saveLayout(this.layoutKey, layout),
        openMarkdown: () => { if (sourceFile) void this.plugin.openMarkdownFile(sourceFile); },
        openBloomMD: (nodeId) => { if (sourceFile) void this.plugin.openFileInBloomMD(sourceFile, nodeId); },
        openWikiLink: (target) => { if (sourceFile) void this.app.workspace.openLinkText(target, sourceFile.path, false); },
        openExternalLink: (url) => window.open(url, "_blank", "noopener,noreferrer"),
        switchFile: (path) => void this.plugin.loadFileIntoView(path, this),
        openFile: (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) void this.plugin.openMarkdownFile(file);
        },
        readInk: async (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          return file instanceof TFile ? this.app.vault.read(file) : null;
        },
        saveInk: (nodeId, path, svg, expectedSvg, conflictOf) => (sourceFile ? this.saveInk(sourceFile, nodeId, path, svg, expectedSvg, conflictOf) : Promise.resolve(null)),
        resolveEmbed: (link) => this.app.metadataCache.getFirstLinkpathDest(link, sourceFile?.path ?? "")?.path ?? null,
        resourceUrl: (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
        },
        pickNote: () => pickNote(this.app, sourceFile?.path ?? ""),
        // Bound to this note: a drawing still saving after the view switched notes stays with its own note.
        saveMapInk: (path, svg, expectedSvg, conflictOf) => sourceFile ? this.saveMapInk(sourceFile, path, svg, expectedSvg, conflictOf) : Promise.resolve(null),
        saveExport: async (extension, data) => {
          if (!sourceFile) return null;
          try {
            const target = await this.app.fileManager.getAvailablePathForAttachment(`${sourceFile.basename} map.${extension}`, sourceFile.path);
            const folder = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
            if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
            const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
            const file = await this.app.vault.createBinary(target, buffer);
            new Notice(`BloomMD: Map exported to ${file.path}`);
            return file.path;
          } catch (error) {
            this.showError(error);
            return null;
          }
        },
        openMenu: (position, items, onHide) => {
          const menu = new Menu();
          if (onHide) menu.onHide(onHide);
          for (const item of items) {
            menu.addItem((entry) => {
              entry.setTitle(item.title).setIcon(item.icon).onClick(item.onClick);
              if (item.danger) entry.setWarning(true);
            });
          }
          menu.showAtPosition(position);
        },
        askAgent: (id, title) => { if (sourceFile) this.plugin.agent.ask(sourceFile.path, id, title); },
        createNodeFromInk: (parentId, svg, title) => editable ? this.createNodeFromInk(parentId, svg, title) : Promise.resolve(null),
        renderMarkdown: (element, markdown) => {
          // One component per render so embeds and post-processors are unloaded with the slide.
          const component = new Component();
          component.load();
          element.empty();
          MarkdownRenderer.render(this.app, markdown, element, sourceFile?.path ?? "", component)
            .catch((error: unknown) => console.error("BloomMD could not render node content", error));
          return () => component.unload();
        },
        linkNote: (id, note, expectedMetadata) => editable
          ? this.applyMutation((markdown) => {
              const node = this.currentNode(markdown, id);
              if (!metadataEquals(node.metadata, expectedMetadata)) throw new Error("This node metadata changed in Obsidian. Reload before linking a note.");
              const linked = updateHeadingMetadata(markdown, id, withLinkedNote(node.metadata, note));
              if (!note) return linked;
              // The wikilink lets Obsidian's graph, backlinks and renames see the connection too.
              return updateHeadingContent(linked, id, ensureWikiLink(this.currentNode(linked, id).content, note));
            })
          : Promise.resolve(false),
        hoverLink: (event, target, targetEl) => {
          this.app.workspace.trigger("hover-link", {
            event,
            source: VIEW_TYPE_BLOOMMD,
            hoverParent: this,
            targetEl,
            linktext: target,
            sourcePath: sourceFile?.path ?? "",
          });
        },
      },
    });
  }

  refreshSettings() {
    this.renderCanvas();
    if (this.plugin.settings.learning.enabled !== Boolean(this.learning)) void this.reloadLearning();
  }

  toggleFocusMode() {
    this.mount?.host.dispatchEvent(new CustomEvent(FOCUS_MODE_EVENT));
  }
}

export default class BloomMDPlugin extends Plugin {
  settings: BloomMDSettings = DEFAULT_SETTINGS;
  private layouts: Record<string, PersistedCanvasLayout> = {};
  private sharedDocumentBindings: ObsidianSharedDocumentEntry[] = [];
  private sharedDocumentSessions = new Map<string, ObsidianSharedDocumentSession>();
  private saveTimer: number | null = null;
  private pendingNoteRenames = new Map<string, string>();
  private noteRetargetTimer: number | null = null;
  learningStore!: LearningStore;
  agent!: AgentHub;

  async onload() {
    await this.loadSettings();
    this.agent = new AgentHub(this, {
      get: () => this.settings.agentReviewer,
      set: async (name) => {
        this.settings.agentReviewer = name;
        await this.persistData();
      },
    });
    // The adapter reaches the hidden .bloommd folder, which the vault API does not index, on every platform.
    this.learningStore = new LearningStore(this.app.vault.adapter);
    // Progress files change when another device syncs; the raw event also sees hidden folders.
    const vaultEvents = this.app.vault as unknown as { on(name: "raw", callback: (path: string) => void): EventRef };
    this.registerEvent(vaultEvents.on("raw", (path) => {
      if (!path.startsWith(`${LEARNING_FOLDER}/`)) return;
      this.bloomViews().forEach((view) => { if (view.usesLearningFile(path)) void view.reloadLearning(); });
    }));
    // Obsidian mobile may not report changes in hidden folders: re-read when the app comes back.
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") this.bloomViews().forEach((view) => void view.reloadLearning());
    });
    this.registerView(VIEW_TYPE_BLOOMMD, (leaf) => new BloomMDView(leaf, this));
    // Page Preview shows notes linked from handwriting on hover (mouse or Apple Pencil) without a modifier key.
    this.registerHoverLinkSource(VIEW_TYPE_BLOOMMD, { display: "BloomMD", defaultMod: false });
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension === "md") {
        void this.retargetInkLinks(file, oldPath);
        this.queueNodeNoteRetarget(file, oldPath);
        // Progress of a map without a BloomMD id is keyed by its path and moves with the note.
        void this.learningStore.move(this.learningKey(file, oldPath), this.learningKey(file), file.path)
          .then((moved) => { if (moved) this.bloomViews().forEach((view) => void view.reloadLearning()); })
          .catch((error: unknown) => console.error("BloomMD could not move learning progress after a rename", error));
      }
    }));
    this.register(() => {
      if (this.noteRetargetTimer !== null) window.clearTimeout(this.noteRetargetTimer);
    });

    this.addRibbonIcon("git-branch", "Visualize current note", () => void this.visualizeCurrentNote());
    this.addCommand({ id: "visualize-current-note", name: "Visualize current note", callback: () => void this.visualizeCurrentNote() });
    this.addCommand({ id: "open-current-note", name: "Open current note", callback: () => void this.openCurrentNoteInBloomMD() });
    this.addCommand({
      id: "toggle-focus-mode",
      name: "Toggle focus mode",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BloomMDView) ?? this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD)[0]?.view;
        if (!(view instanceof BloomMDView)) return false;
        if (!checking) view.toggleFocusMode();
        return true;
      },
    });
    this.addCommand({ id: "visualize-current-folder", name: "Visualize current folder", callback: () => void this.visualizeCurrentFolder() });
    this.addCommand({ id: "share-current-note", name: "Share current note with workspace", callback: () => void this.shareCurrentNote() });
    this.addCommand({ id: "unshare-current-note", name: "Stop sharing current note with workspace", callback: () => void this.unshareCurrentNote() });

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const session = this.sharedDocumentSessions.get(file.path);
      if (session) {
        void this.app.vault.read(file)
          .then((markdown) => session.handleVaultModify(markdown))
          .catch((error: unknown) => console.error("BloomMD: shared vault change could not be mirrored", error));
      }
      this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD).forEach((leaf) => {
        if (leaf.view instanceof BloomMDView) void leaf.view.handleFileChange(file);
      });
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) && !(file instanceof TFolder)) return;
      void this.handleVaultRename(file, oldPath).catch((error: unknown) => {
        console.error("BloomMD: failed to migrate local references after vault rename", error);
        new Notice("BloomMD: The renamed item was kept, but its local BloomMD view state could not be updated.");
      });
    }));
    this.addSettingTab(new BloomMDSettingTab(this.app, this));
  }

  /**
   * A folder rename fires one event per note; collecting them lets a single pass over the vault
   * update every node that linked one of the moved notes.
   */
  private queueNodeNoteRetarget(note: TFile, oldPath: string) {
    for (const [previous, path] of this.pendingNoteRenames) {
      if (path === oldPath) this.pendingNoteRenames.set(previous, note.path);
    }
    this.pendingNoteRenames.set(oldPath, note.path);
    if (this.noteRetargetTimer !== null) window.clearTimeout(this.noteRetargetTimer);
    this.noteRetargetTimer = window.setTimeout(() => {
      this.noteRetargetTimer = null;
      void this.retargetNodeNotes();
    }, NOTE_RETARGET_DELAY_MS);
  }

  /** Nodes linked to a renamed note keep pointing at it; Obsidian only rewrites visible `[[links]]`. */
  private async retargetNodeNotes() {
    const renames = [...this.pendingNoteRenames].flatMap(([oldPath, path]) => {
      const note = this.app.vault.getAbstractFileByPath(path);
      return note instanceof TFile ? [{ oldPath, note, name: oldPath.split("/").pop()!.replace(/\.md$/i, "") }] : [];
    });
    this.pendingNoteRenames.clear();
    if (renames.length === 0) return;
    for (const file of this.app.vault.getMarkdownFiles()) {
      // Node metadata lives on headings, so notes without headings cannot link anything.
      if (!this.app.metadataCache.getFileCache(file)?.headings?.length) continue;
      try {
        const current = await this.app.vault.cachedRead(file);
        if (!current.includes("bloommd:meta") || !renames.some(({ name }) => current.includes(name))) continue;
        const retarget = (markdown: string) => renames.reduce((next, { oldPath, note }) => retargetLinkedNotes(
          next,
          oldPath,
          this.app.metadataCache.fileToLinktext(note, file.path, true),
          // Resolved from this note: a link that now finds another note of that name never meant the renamed one.
          (link) => {
            const destination = this.app.metadataCache.getFirstLinkpathDest(link.split("#")[0]!.trim(), file.path);
            return destination === null || destination === note;
          },
        ), markdown);
        const next = retarget(current);
        if (next === current) continue;
        await this.app.vault.process(file, (latest) => (latest === current ? next : retarget(latest)));
      } catch (error) {
        console.error(`BloomMD could not update linked notes in ${file.path}`, error);
      }
    }
  }

  /** Note-link targets per drawing, keyed by path and valid while the file's mtime is unchanged. */
  private readonly inkLinkTargets = new Map<string, { mtime: number; targets: string[] }>();

  /**
   * Obsidian rewrites `[[links]]` in Markdown on rename; drawings keep their own link list in step.
   * Only SVGs embedded in some note can hold handwriting links, and cached link lists spare reading
   * drawings that cannot point at the renamed note.
   */
  private async retargetInkLinks(note: TFile, oldPath: string) {
    const embedded = new Set<string>();
    for (const targets of Object.values(this.app.metadataCache.resolvedLinks)) {
      for (const target of Object.keys(targets)) if (target.toLowerCase().endsWith(".svg")) embedded.add(target);
    }
    for (const path of embedded) {
      const drawing = this.app.vault.getAbstractFileByPath(path);
      if (!(drawing instanceof TFile)) continue;
      const cached = this.inkLinkTargets.get(path);
      if (cached && cached.mtime === drawing.stat.mtime && !cached.targets.some((target) => linkTargetsPath(target, oldPath))) continue;
      try {
        const current = await this.app.vault.cachedRead(drawing);
        const parsed = parseInkSvg(current);
        this.inkLinkTargets.set(path, { mtime: drawing.stat.mtime, targets: parsed?.document.links.map((link) => link.target) ?? [] });
        if (!parsed || parsed.readOnly) continue;
        // A link that still resolves after the rename points at another note with the same name.
        const resolve = (target: string) => this.app.metadataCache.getFirstLinkpathDest(target, drawing.path)?.path ?? null;
        const next = retargetInkLinks(parsed.document, oldPath, this.app.metadataCache.fileToLinktext(note, drawing.path, true), resolve);
        if (next === parsed.document) continue;
        await this.app.vault.process(drawing, (latest) => (latest === current ? serializeInkSvg(next) : latest));
      } catch (error) {
        console.error(`BloomMD could not update note links in ${drawing.path}`, error);
      }
    }
  }

  onunload() {
    this.sharedDocumentSessions.forEach((session) => session.disconnect());
    this.sharedDocumentSessions.clear();
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.persistData().catch((error: unknown) => {
      console.error("BloomMD: failed to persist plugin data during unload", error);
    });
  }

  private bloomViews(): BloomMDView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD).flatMap((leaf) => (leaf.view instanceof BloomMDView ? [leaf.view] : []));
  }

  learningKey(file: TFile, path = file.path): string {
    return learningKey({ id: this.app.metadataCache.getFileCache(file)?.frontmatter?.id, path });
  }

  async loadLearning(file: TFile): Promise<LearningFile> {
    const key = this.learningKey(file);
    // A note that got a BloomMD id (e.g. in the BloomMD app) keeps the progress stored under its path.
    if (key.startsWith("id-")) await this.learningStore.move(learningKey({ path: file.path }), key, file.path);
    return this.learningStore.load(key);
  }

  /** The map whose progress the settings act on: the one in the BloomMD view. */
  learningMapView(): BloomMDView | null {
    return this.bloomViews().find((view) => view.mapFile()) ?? null;
  }

  async resetLearning(): Promise<void> {
    const view = this.learningMapView();
    const file = view?.mapFile();
    if (!view || !file) {
      new Notice("BloomMD: Open a map first.");
      return;
    }
    const confirmed = await confirmAction(
      this.app,
      "Reset learning progress?",
      `All ratings and the exam date of "${file.basename}" are reset on all your devices. The note is not changed.`,
      "Reset progress",
    );
    if (!confirmed) return;
    const resetAt = new Date().toISOString();
    await view.updateLearning((current) => ({ format: current.format, entries: {}, resetAt, examUpdated: resetAt }));
    new Notice(`BloomMD: Learning progress of ${file.basename} was reset.`);
  }

  async visualizeCurrentNote() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice("BloomMD: Open a Markdown note first.");
      return;
    }
    const view = await this.getOrCreateView();
    await this.loadFileIntoView(file.path, view);
    await this.app.workspace.revealLeaf(view.leaf);
  }

  async visualizeCurrentFolder() {
    const folder = this.getActiveMarkdownFile()?.parent;
    if (!folder) {
      new Notice("BloomMD: Open a Markdown note in the folder you want to visualize.");
      return;
    }
    const view = await this.getOrCreateView();
    view.setFolder(folder);
    await this.app.workspace.revealLeaf(view.leaf);
  }

  async loadFileIntoView(path: string, view: BloomMDView) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const markdown = await this.app.vault.process(file, (current) => ensureHeadingIds(current).markdown);
    await this.connectSharedDocument(file).catch((error: unknown) => {
      console.error("BloomMD: shared document connection could not be restored", error);
      new Notice(`BloomMD collaboration is offline: ${error instanceof Error ? error.message : "connection unavailable"}`);
    });
    view.setNote(file, markdown);
  }

  async shareCurrentNote() {
    if (Platform.isMobile) {
      new Notice(SHARED_MODE_UNAVAILABLE);
      return;
    }
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice("BloomMD: Open a Markdown note first.");
      return;
    }
    if (this.sharedDocumentBindings.some((entry) => entry.localPath === file.path)) {
      new Notice("BloomMD: This note is already shared. Use ‘Stop sharing current note’ to disconnect it.");
      return;
    }
    const token = this.app.secretStorage.getSecret(COLLABORATION_TOKEN_SECRET_ID);
    if (!token) {
      new Notice("BloomMD: Store a collaboration access token in the BloomMD settings first.");
      return;
    }
    await this.app.vault.process(file, (current) => ensureHeadingIds(current).markdown);
    try {
      const { ObsidianSharedDocumentSession, WorkspaceSyncClient } = await loadSharedDocumentRuntime();
      const client = new WorkspaceSyncClient({ baseUrl: this.settings.collaborationServerUrl, accessToken: token });
      const requestedWorkspaceId = this.settings.collaborationWorkspaceId.trim();
      const context = requestedWorkspaceId ? await client.selectWorkspace(requestedWorkspaceId) : await client.listWorkspaces();
      if (!context.workspace) throw new Error("WORKSPACE_NOT_SELECTED");
      if (context.workspace.role === "viewer") throw new Error("WORKSPACE_READ_ONLY");
      const existingDocuments = await client.listDocuments();
      const choice = await chooseSharedDocument(this.app, [
        { kind: "new", filename: `${file.basename}.md` },
        ...existingDocuments.map((document) => ({ kind: "existing" as const, filename: document.filename })),
      ]);
      if (!choice) return;
      const sessionOptions = {
        file: { path: file.path, basename: file.basename },
        vault: this.vaultAdapter(),
        serverUrl: this.settings.collaborationServerUrl,
        accessToken: token,
        workspaceId: context.workspace.id,
        createClient: () => client,
        onBindingChange: async (binding: ObsidianSharedDocumentEntry["binding"]) => this.persistSharedDocumentBinding(file.path, binding),
      };
      const session = choice.kind === "new"
        ? await ObsidianSharedDocumentSession.share({ ...sessionOptions, cloudFilename: choice.filename })
        : await ObsidianSharedDocumentSession.bindExisting({ ...sessionOptions, cloudFilename: choice.filename });
      this.sharedDocumentSessions.set(file.path, session);
      new Notice(choice.kind === "new"
        ? `BloomMD: “${file.basename}” is now shared with the selected workspace.`
        : `BloomMD: “${file.basename}” is now bound to “${choice.filename}”.`);
    } catch (error) {
      console.error("BloomMD: explicit share failed", error);
      new Notice(`BloomMD: The note could not be shared (${error instanceof Error ? error.message : "unknown error"}).`);
    }
  }

  async unshareCurrentNote() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice("BloomMD: Open a Markdown note first.");
      return;
    }
    this.sharedDocumentSessions.get(file.path)?.disconnect();
    this.sharedDocumentSessions.delete(file.path);
    if (!this.sharedDocumentBindings.some((entry) => entry.localPath === file.path)) {
      new Notice("BloomMD: This note is not currently shared.");
      return;
    }
    const entry = this.sharedDocumentBindings.find((candidate) => candidate.localPath === file.path)!;
    this.sharedDocumentBindings = this.sharedDocumentBindings.filter((entry) => entry.localPath !== file.path);
    await this.persistData();
    this.refreshOpenBloomMDViews();
    const token = this.app.secretStorage.getSecret(COLLABORATION_TOKEN_SECRET_ID);
    if (token && !Platform.isMobile) {
      try {
        const { WorkspaceSyncClient } = await loadSharedDocumentRuntime();
        const client = new WorkspaceSyncClient({ baseUrl: this.settings.collaborationServerUrl, accessToken: token });
        await client.selectWorkspace(entry.binding.workspaceId);
        await client.recordSharedDocumentBinding("unbound", entry.binding.documentId);
      } catch (error) {
        console.warn("BloomMD: local unshare completed but audit could not be recorded", error);
      }
    }
    new Notice("BloomMD: Sharing stopped. The local Markdown note and the cloud document were kept.");
  }

  async openMarkdownFile(file: TFile) {
    const existing = this.app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  async openCurrentNoteInBloomMD() {
    await this.openFileInBloomMD(this.getActiveMarkdownFile());
  }

  async openFileInBloomMD(file: TFile | null, nodeId?: string | null) {
    if (!file) {
      new Notice("BloomMD: Open a Markdown note first.");
      return;
    }
    if (this.settings.openTarget === "desktop" && Platform.isDesktop) {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) {
        new Notice("BloomMD: This Vault does not expose a local file path. Opening the web app instead.");
        window.open(BLOOMMD_WEB_DEMO);
        return;
      }
      await this.openInDesktop(adapter.getFullPath(file.path), nodeId);
      return;
    }
    if (Platform.isMobile && this.settings.mobileAppInstalled) {
      // The app opened this vault as its folder, so the vault-relative path names the same note.
      window.open(mobileOpenUrl(file.path, nodeId));
      return;
    }
    if (this.settings.openTarget === "desktop" && Platform.isMobile) {
      new Notice("BloomMD for iPad and iPhone is not available yet. Opening the private web fallback.");
    }
    window.open(BLOOMMD_WEB_DEMO);
    new Notice("BloomMD web opened. Choose the local file manually; note content was not sent.");
  }

  /**
   * Hands the note to BloomMD Desktop: straight to a running app, otherwise by starting it. Only the
   * file path and node id leave Obsidian; no note content is uploaded anywhere.
   */
  private async openInDesktop(absolutePath: string, nodeId?: string | null) {
    let starting: Notice | null = null;
    const result = await openNoteInDesktop(desktopDeps(), absolutePath, desktopNodeId(nodeId), desktopOpenUrl(absolutePath, nodeId), () => {
      starting = new Notice("BloomMD: Starting BloomMD Desktop with this note…", 0);
    });
    (starting as Notice | null)?.hide();
    if (result === "opened" || result === "launched") new Notice("BloomMD: Opened in BloomMD Desktop.");
    else if (result === "unconfirmed") new Notice("BloomMD: BloomMD Desktop did not confirm the note. If it does not show it, choose Open app again once BloomMD is open.", 10_000);
    else this.showDesktopMissing(result);
  }

  private showDesktopMissing(reason: "not-installed" | "not-found" | "start-first") {
    const notice = new Notice("", 10_000);
    notice.messageEl.empty();
    if (reason === "start-first") {
      notice.messageEl.createSpan({ text: "Please start BloomMD Desktop first, then choose Open app again. Not installed yet? Get it from " });
    } else if (reason === "not-found") {
      notice.messageEl.createSpan({ text: "BloomMD Desktop was not found. Start it first, then choose Open app again, or get it from " });
    } else {
      notice.messageEl.createSpan({ text: "BloomMD Desktop is not installed. Get it from " });
    }
    notice.messageEl.createEl("a", { text: "bloommd.io/download", href: BLOOMMD_DOWNLOAD_URL });
    notice.messageEl.createSpan({ text: ", or choose the web app in the BloomMD settings." });
  }

  markdownFiles(folder: TFolder | null): Array<{ path: string; title: string }> {
    return filesInFolder(folder)
      .filter((file) => file.extension === "md")
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .map((file) => ({ path: file.path, title: file.basename }));
  }

  resourceFiles(folder: TFolder | null): ResourceEntry[] {
    return filesInFolder(folder)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => ({ path: file.path, title: file.basename, extension: file.extension.toLowerCase() }));
  }

  getSharedDocumentStatus(localPath: string): ObsidianSharedDocumentEntry["binding"]["connectionState"] | null {
    const state = this.sharedDocumentBindings.find((entry) => entry.localPath === localPath)?.binding.connectionState ?? null;
    // Mobile never connects shared notes, so a synced "connected" state would be misleading there.
    return state && Platform.isMobile && state !== "revoked" ? "offline" : state;
  }

  getLayout(key: string): PersistedCanvasLayout {
    return this.layouts[key] ?? EMPTY_LAYOUT;
  }

  saveLayout(key: string, layout: PersistedCanvasLayout) {
    if (!key) return;
    this.layouts[key] = layout;
    this.schedulePersist();
  }

  private schedulePersist() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistData();
    }, 350);
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    return file?.extension === "md" ? file : null;
  }

  private async getOrCreateView(): Promise<BloomMDView> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD)[0];
    if (existing?.view instanceof BloomMDView) return existing.view;
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: VIEW_TYPE_BLOOMMD, active: true });
    if (!(leaf.view instanceof BloomMDView)) throw new Error("Unable to load BloomMD view.");
    return leaf.view;
  }

  private async loadSettings() {
    const stored = (await this.loadData()) as (Partial<BloomMDData> & Partial<BloomMDSettings> & { preferDesktop?: boolean; preferWeb?: boolean }) | null;
    const storedSettings = stored?.settings ?? stored ?? {};
    const migratedTarget = storedSettings.openTarget
      ?? (storedSettings.preferDesktop === false && storedSettings.preferWeb ? "web" : DEFAULT_SETTINGS.openTarget);
    this.settings = { ...DEFAULT_SETTINGS, ...storedSettings, openTarget: migratedTarget, learning: normalizeLearningSettings(storedSettings.learning) };
    this.layouts = stored?.layouts ?? {};
    this.sharedDocumentBindings = Array.isArray(stored?.sharedDocumentBindings)
      ? stored.sharedDocumentBindings.filter(isSharedDocumentEntry)
      : [];
  }

  async saveSettings() {
    await this.persistData();
    this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD).forEach((leaf) => {
      if (leaf.view instanceof BloomMDView) leaf.view.refreshSettings();
    });
  }

  private async persistData() {
    const data: BloomMDData = { settings: this.settings, layouts: this.layouts, sharedDocumentBindings: this.sharedDocumentBindings };
    await this.saveData(data);
  }

  private vaultAdapter() {
    return {
      readMarkdown: (file: { path: string }) => this.app.vault.read(this.requireMarkdownFile(file.path)),
      writeMarkdown: async (file: { path: string }, markdown: string) => {
        await this.app.vault.modify(this.requireMarkdownFile(file.path), markdown);
      },
    };
  }

  private requireMarkdownFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") throw new Error("LOCAL_MARKDOWN_FILE_NOT_FOUND");
    return file;
  }

  private async persistSharedDocumentBinding(localPath: string, binding: ObsidianSharedDocumentEntry["binding"]) {
    const index = this.sharedDocumentBindings.findIndex((entry) => entry.localPath === localPath);
    const entry: ObsidianSharedDocumentEntry = { localPath, binding };
    if (index >= 0) this.sharedDocumentBindings[index] = entry;
    else this.sharedDocumentBindings.push(entry);
    await this.persistData();
    this.refreshOpenBloomMDViews();
  }

  private async handleVaultRename(file: TFile | TFolder, oldPath: string): Promise<void> {
    const migrated = migratePersistedPathState({
      layouts: this.layouts,
      bindings: this.sharedDocumentBindings,
    }, {
      oldPath,
      newPath: file.path,
      isFolder: file instanceof TFolder,
    });
    if (!migrated.changed) return;

    const sessionsToReconnect = migrated.movedLocalPaths
      .map(({ oldPath: previousPath, newPath }) => ({ previousPath, newPath, session: this.sharedDocumentSessions.get(previousPath) }))
      .filter((entry): entry is { previousPath: string; newPath: string; session: ObsidianSharedDocumentSession } => Boolean(entry.session));
    sessionsToReconnect.forEach(({ previousPath, session }) => {
      session.disconnect();
      this.sharedDocumentSessions.delete(previousPath);
    });

    this.layouts = migrated.layouts;
    this.sharedDocumentBindings = migrated.bindings;
    await this.persistData();
    await Promise.all(sessionsToReconnect.map(async ({ newPath }) => {
      const renamedFile = this.app.vault.getAbstractFileByPath(newPath);
      if (renamedFile instanceof TFile && renamedFile.extension === "md") await this.connectSharedDocument(renamedFile);
    }));
    this.refreshOpenBloomMDViews();
  }

  private refreshOpenBloomMDViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD).forEach((leaf) => {
      if (leaf.view instanceof BloomMDView) leaf.view.refreshSettings();
    });
  }

  private async connectSharedDocument(file: TFile): Promise<void> {
    // Bindings sync to mobile with the vault; they stay untouched and reconnect on desktop.
    if (Platform.isMobile || this.sharedDocumentSessions.has(file.path)) return;
    const entry = this.sharedDocumentBindings.find((candidate) => candidate.localPath === file.path);
    if (!entry || entry.binding.connectionState === "revoked") return;
    const token = this.app.secretStorage.getSecret(COLLABORATION_TOKEN_SECRET_ID);
    if (!token) throw new Error("COLLABORATION_TOKEN_MISSING");
    const { ObsidianSharedDocumentSession } = await loadSharedDocumentRuntime();
    const session = new ObsidianSharedDocumentSession({
      file: { path: file.path, basename: file.basename },
      binding: entry.binding,
      vault: this.vaultAdapter(),
      serverUrl: this.settings.collaborationServerUrl,
      accessToken: token,
      onBindingChange: async (binding) => this.persistSharedDocumentBinding(file.path, binding),
    });
    this.sharedDocumentSessions.set(file.path, session);
    try {
      await session.connect();
    } catch (error) {
      this.sharedDocumentSessions.delete(file.path);
      session.disconnect();
      throw error;
    }
  }
}

class BloomMDSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: BloomMDPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: "group",
      heading: "BloomMD",
      items: [
        {
          name: "Open in BloomMD",
          desc: "Desktop opens the local file at the selected node in BloomMD Desktop. macOS and Linux (package install) start the app when needed; on Windows, start BloomMD Desktop first. Web opens the private local-file demo without uploading note content.",
          control: {
            type: "dropdown",
            key: "openTarget",
            defaultValue: "desktop",
            options: { desktop: "Desktop app", web: "Web app" },
          },
        },
        {
          name: "BloomMD app on this iPad",
          desc: "Turn on when the BloomMD app is installed on this iPad or iPhone and has this vault opened as its folder. Open app then opens the note there, at the selected node.",
          control: { type: "toggle", key: "mobileAppInstalled", defaultValue: false },
        },
        {
          name: "Show content previews",
          desc: "Show a short local Markdown preview inside each mind-map node.",
          control: { type: "toggle", key: "showNodeContent", defaultValue: true },
        },
        {
          name: "Collaboration server",
          desc: "BloomMD app URL used only after you explicitly share a note.",
          control: { type: "text", key: "collaborationServerUrl", defaultValue: "https://bloommd.app", placeholder: "https://bloommd.app" },
        },
        {
          name: "Collaboration workspace ID",
          desc: "Optional. Leave empty to use your default BloomMD workspace. The vault path is never sent.",
          control: { type: "text", key: "collaborationWorkspaceId", defaultValue: "", placeholder: "workspace UUID (optional)" },
        },
        {
          name: "Collaboration access token",
          desc: "Stored in Obsidian’s secret storage, never in the plugin data file.",
          action: () => new CollaborationTokenModal(this.app, this.plugin).open(),
        },
      ],
    }, this.learningGroup()];
  }

  private learningGroup(): SettingDefinitionItem {
    const learning = () => this.plugin.settings.learning;
    const on = () => learning().enabled;
    const spaced = () => on() && learning().spacedRepetition;
    const level = (index: number): SettingDefinitionRender => ({
      name: `Level ${index + 1}`,
      desc: index === 0 ? "Name, color and – with spaced repetition – days until the node is due again." : "",
      visible: () => on() && index < learning().levels,
      render: (setting) => {
        const current = learning();
        const levels = current.levels;
        const defaults = normalizeLearningSettings(undefined);
        setting.addText((text) => text
          .setPlaceholder(defaults.names[levels][index]!)
          .setValue(current.names[levels][index]!)
          .onChange((value) => {
            current.names[levels][index] = value.trim() || defaults.names[levels][index]!;
            void this.plugin.saveSettings();
          }));
        setting.addColorPicker((picker) => picker
          .setValue(current.colors[levels][index]!)
          .onChange((value) => {
            current.colors[levels][index] = value;
            void this.plugin.saveSettings();
          }));
        if (current.spacedRepetition) {
          setting.addText((text) => {
            text.inputEl.type = "number";
            text.inputEl.min = "0";
            text.inputEl.max = "180";
            text.inputEl.setAttribute("aria-label", `Days until due for level ${index + 1}`);
            text.setValue(String(current.intervals[levels][index])).onChange((value) => {
              const days = Number(value);
              if (!Number.isFinite(days) || days < 0 || days > 180) return;
              current.intervals[levels][index] = Math.round(days);
              void this.plugin.saveSettings();
            });
          });
        }
      },
    });
    return {
      type: "group",
      heading: "Learning",
      items: [
        {
          name: "Learning progress",
          desc: "Rate nodes after revealing them in study mode and see your progress on the map. Progress is stored per map in .bloommd/learning/ in the vault and never changes the note.",
          control: { type: "toggle", key: "learning.enabled", defaultValue: true },
        },
        {
          name: "Levels",
          visible: on,
          control: { type: "dropdown", key: "learning.levels", defaultValue: "3", options: { 3: "3 levels", 5: "5 levels" } },
        },
        ...[0, 1, 2, 3, 4].map(level),
        {
          name: "Show on the map",
          desc: "How nodes show their level.",
          visible: on,
          control: { type: "dropdown", key: "learning.display", defaultValue: "border", options: { border: "Colored border", fill: "Fill tint", badge: "Badge", off: "Off" } },
        },
        {
          name: "Branch progress",
          desc: "Show mastered/total nodes on every node with children.",
          visible: on,
          control: { type: "toggle", key: "learning.branchProgress", defaultValue: false },
        },
        {
          name: "Spaced repetition",
          desc: "Rated nodes become due again after their level's interval. Each further top rating in a row multiplies the top interval by the growth factor (up to 180 days).",
          visible: on,
          control: { type: "toggle", key: "learning.spacedRepetition", defaultValue: true },
        },
        {
          name: "Growth factor",
          visible: spaced,
          control: { type: "number", key: "learning.growth", defaultValue: 2.5, min: 1, max: 10, step: 0.1 },
        },
        {
          name: "Default study order",
          visible: on,
          control: { type: "dropdown", key: "learning.order", defaultValue: "due", options: STUDY_ORDERS },
        },
        {
          name: "Reset progress for the current map",
          desc: "Deletes all ratings and the exam date of the map open in BloomMD, on all devices. The note stays unchanged.",
          visible: on,
          disabled: () => !this.plugin.learningMapView(),
          action: () => void this.plugin.resetLearning(),
        },
      ],
    };
  }

  getControlValue(key: string): unknown {
    if (key === "openTarget") return this.plugin.settings.openTarget;
    if (key === "showNodeContent") return this.plugin.settings.showNodeContent;
    if (key === "mobileAppInstalled") return this.plugin.settings.mobileAppInstalled;
    if (key === "collaborationServerUrl") return this.plugin.settings.collaborationServerUrl;
    if (key === "collaborationWorkspaceId") return this.plugin.settings.collaborationWorkspaceId;
    if (key.startsWith("learning.")) {
      const value = this.plugin.settings.learning[key.slice(9) as keyof LearningSettings];
      return key === "learning.levels" ? String(value) : value;
    }
    return undefined;
  }

  setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "openTarget" && (value === "desktop" || value === "web")) {
      this.plugin.settings.openTarget = value;
    } else if (key === "mobileAppInstalled" && typeof value === "boolean") {
      this.plugin.settings.mobileAppInstalled = value;
    } else if (key === "showNodeContent" && typeof value === "boolean") {
      this.plugin.settings.showNodeContent = value;
    } else if (key === "collaborationServerUrl" && typeof value === "string") {
      this.plugin.settings.collaborationServerUrl = value.trim();
    } else if (key === "collaborationWorkspaceId" && typeof value === "string") {
      this.plugin.settings.collaborationWorkspaceId = value.trim();
    } else if (key.startsWith("learning.")) {
      const learning = this.plugin.settings.learning;
      const next = normalizeLearningSettings({ ...learning, [key.slice(9)]: key === "learning.levels" ? Number(value) : value });
      // Settings that show or hide other rows redraw the tab.
      const redraw = next.enabled !== learning.enabled || next.levels !== learning.levels || next.spacedRepetition !== learning.spacedRepetition;
      this.plugin.settings.learning = next;
      if (redraw) {
        this.update();
        this.display();
      }
    }
    return this.plugin.saveSettings();
  }
}

class CollaborationTokenModal extends Modal {
  constructor(app: App, private readonly plugin: BloomMDPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "BloomMD collaboration access token" });
    let token = "";
    new Setting(contentEl)
      .setName("Personal access token")
      .setDesc("This token stays in Obsidian’s secret storage and is not written into the vault or plugin data.")
      .addText((text) => text.setPlaceholder("bloom_pat_…").setValue("").onChange((value) => { token = value.trim(); }));
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Store token").setCta().onClick(() => {
        if (!token) {
          new Notice("BloomMD: Enter a personal access token first.");
          return;
        }
        this.app.secretStorage.setSecret(COLLABORATION_TOKEN_SECRET_ID, token);
        new Notice("BloomMD: Collaboration access token stored securely.");
        this.close();
      }))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }
}

function isSharedDocumentEntry(value: unknown): value is ObsidianSharedDocumentEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { localPath?: unknown; binding?: unknown };
  return typeof candidate.localPath === "string" && Boolean(candidate.binding);
}
