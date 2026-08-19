import {
  App,
  FileSystemAdapter,
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import {
  addChildHeading,
  addSiblingHeading,
  copyHeadingBranch,
  deleteHeadingBranch,
  ensureHeadingIds,
  findHeading,
  findHeadingParent,
  flattenHeadings,
  metadataEquals,
  moveHeadingBranch,
  parseHeadingTree,
  renameHeading,
  updateHeadingMetadata,
  updateHeadingContent,
  type MarkdownHeadingNode,
} from "./markdown-document";
import {
  createCanvasMount,
  type BacklinkEntry,
  type CanvasHeading,
  type CanvasMount,
  type PersistedCanvasLayout,
  type ResourceEntry,
} from "./canvas";

const VIEW_TYPE_BLOOMMD = "bloommd-mindmap-view";
const BLOOMMD_WEB_DEMO = "https://bloommd.io/demo";

interface BloomMDSettings {
  openTarget: "desktop" | "web";
  showNodeContent: boolean;
}

interface BloomMDData {
  settings: BloomMDSettings;
  layouts: Record<string, PersistedCanvasLayout>;
}

interface HistoryEntry {
  before: string;
  after: string;
}

const DEFAULT_SETTINGS: BloomMDSettings = {
  openTarget: "desktop",
  showNodeContent: true,
};

const EMPTY_LAYOUT: PersistedCanvasLayout = { positions: {}, collapsed: [] };

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

class BloomMDView extends ItemView {
  private sourceFile: TFile | null = null;
  private layoutKey = "";
  private headings: CanvasHeading[] = [];
  private rootId = "";
  private mount: CanvasMount | null = null;
  private writing = false;
  private lastKnownMarkdown = "";
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private mutationQueue: Promise<unknown> = Promise.resolve();

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
    }
    this.sourceFile = file;
    this.layoutKey = `file:${file.path}`;
    this.lastKnownMarkdown = markdown;
    const tree = parseHeadingTree(markdown);
    this.headings = canvasHeadings(tree);
    this.rootId = tree[0]?.id ?? "";
    this.renderCanvas();
  }

  setFolder(folder: TFolder) {
    this.sourceFile = null;
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

  private queueMutation(task: () => Promise<boolean>): Promise<boolean> {
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

  private restoreHistory(direction: "undo" | "redo"): Promise<boolean> {
    return this.queueMutation(async () => {
      if (!this.sourceFile) return false;
      const source = direction === "undo" ? this.undoStack : this.redoStack;
      const target = direction === "undo" ? this.redoStack : this.undoStack;
      const entry = source[source.length - 1];
      if (!entry) return false;
      this.writing = true;
      try {
        const expected = direction === "undo" ? entry.after : entry.before;
        const replacement = direction === "undo" ? entry.before : entry.after;
        const markdown = await this.app.vault.process(this.sourceFile, (current) => {
          if (current !== expected) throw new Error("The note changed outside BloomMD. History restore was cancelled.");
          return replacement;
        });
        source.pop();
        target.push(entry);
        this.updateFromMarkdown(markdown);
        return true;
      } catch (error) {
        this.showError(error);
        return false;
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
      headings: this.headings,
      rootId: this.rootId,
      files: this.plugin.markdownFiles(),
      backlinks: this.backlinks(),
      layout: this.plugin.getLayout(this.layoutKey),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      showNodeContent: this.plugin.settings.showNodeContent,
      resources: this.plugin.resourceFiles(),
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
          if (!window.confirm(`Delete "${node.title}" and its complete branch?`)) return false;
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
        undo: () => this.restoreHistory("undo"),
        redo: () => this.restoreHistory("redo"),
        persistLayout: (layout) => this.plugin.saveLayout(this.layoutKey, layout),
        openMarkdown: () => { if (sourceFile) void this.plugin.openMarkdownFile(sourceFile); },
        openBloomMD: () => { if (sourceFile) void this.plugin.openFileInBloomMD(sourceFile); },
        openWikiLink: (target) => { if (sourceFile) void this.app.workspace.openLinkText(target, sourceFile.path, false); },
        openExternalLink: (url) => window.open(url, "_blank", "noopener,noreferrer"),
        switchFile: (path) => void this.plugin.loadFileIntoView(path, this),
        openFile: (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) void this.plugin.openMarkdownFile(file);
        },
      },
    });
  }

  refreshSettings() {
    this.renderCanvas();
  }
}

export default class BloomMDPlugin extends Plugin {
  settings: BloomMDSettings = DEFAULT_SETTINGS;
  private layouts: Record<string, PersistedCanvasLayout> = {};
  private saveTimer: number | null = null;

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_BLOOMMD, (leaf) => new BloomMDView(leaf, this));

    this.addRibbonIcon("git-branch", "BloomMD: Visualize current note", () => void this.visualizeCurrentNote());
    this.addCommand({ id: "visualize-current-note", name: "Visualize current note", callback: () => void this.visualizeCurrentNote() });
    this.addCommand({ id: "open-current-note-in-bloommd", name: "Open current note in BloomMD", callback: () => void this.openCurrentNoteInBloomMD() });
    this.addCommand({ id: "visualize-current-folder", name: "Visualize current folder", callback: () => void this.visualizeCurrentFolder() });

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD).forEach((leaf) => {
        if (leaf.view instanceof BloomMDView) void leaf.view.handleFileChange(file);
      });
    }));
    this.addSettingTab(new BloomMDSettingTab(this.app, this));
  }

  onunload() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    void this.persistData();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_BLOOMMD);
  }

  async visualizeCurrentNote() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice("BloomMD: Open a Markdown note first.");
      return;
    }
    const view = await this.getOrCreateView();
    await this.loadFileIntoView(file.path, view);
    this.app.workspace.revealLeaf(view.leaf);
  }

  async visualizeCurrentFolder() {
    const folder = this.getActiveMarkdownFile()?.parent ?? this.app.vault.getRoot();
    const view = await this.getOrCreateView();
    view.setFolder(folder);
    this.app.workspace.revealLeaf(view.leaf);
  }

  async loadFileIntoView(path: string, view: BloomMDView) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const markdown = await this.app.vault.process(file, (current) => ensureHeadingIds(current).markdown);
    view.setNote(file, markdown);
  }

  async openMarkdownFile(file: TFile) {
    const existing = this.app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  async openCurrentNoteInBloomMD() {
    await this.openFileInBloomMD(this.getActiveMarkdownFile());
  }

  async openFileInBloomMD(file: TFile | null) {
    if (!file) {
      new Notice("BloomMD: Open a Markdown note first.");
      return;
    }
    if (this.settings.openTarget === "desktop" && Platform.isDesktop && Platform.isMacOS) {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) {
        new Notice("BloomMD: This Vault does not expose a local file path. Opening the web app instead.");
        window.open(BLOOMMD_WEB_DEMO);
        return;
      }
      const absolutePath = adapter.getFullPath(file.path);
      window.open(`bloommd://open?path=${encodeURIComponent(absolutePath)}`);
      new Notice("BloomMD: Opening the local note in the desktop app. No note content was uploaded.");
      return;
    }
    if (this.settings.openTarget === "desktop" && !(Platform.isDesktop && Platform.isMacOS)) {
      new Notice("BloomMD Desktop file handoff is currently available on macOS. Opening the private web fallback.");
    }
    window.open(BLOOMMD_WEB_DEMO);
    new Notice("BloomMD web opened. Choose the local file manually; note content was not sent.");
  }

  markdownFiles(): Array<{ path: string; title: string }> {
    return this.app.vault.getMarkdownFiles()
      .slice()
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .map((file) => ({ path: file.path, title: file.basename }));
  }

  resourceFiles(): ResourceEntry[] {
    return this.app.vault.getFiles()
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => ({ path: file.path, title: file.basename, extension: file.extension.toLowerCase() }));
  }

  getLayout(key: string): PersistedCanvasLayout {
    return this.layouts[key] ?? EMPTY_LAYOUT;
  }

  saveLayout(key: string, layout: PersistedCanvasLayout) {
    if (!key) return;
    this.layouts[key] = layout;
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
    this.settings = { ...DEFAULT_SETTINGS, ...storedSettings, openTarget: migratedTarget };
    this.layouts = stored?.layouts ?? {};
  }

  async saveSettings() {
    await this.persistData();
    this.app.workspace.getLeavesOfType(VIEW_TYPE_BLOOMMD).forEach((leaf) => {
      if (leaf.view instanceof BloomMDView) leaf.view.refreshSettings();
    });
  }

  private async persistData() {
    const data: BloomMDData = { settings: this.settings, layouts: this.layouts };
    await this.saveData(data);
  }
}

class BloomMDSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: BloomMDPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "BloomMD" });

    new Setting(this.containerEl)
      .setName("Open in BloomMD")
      .setDesc("Desktop opens the local file on macOS. Web opens the private local-file demo without uploading note content.")
      .addDropdown((dropdown) => dropdown
        .addOption("desktop", "Desktop app")
        .addOption("web", "Web app")
        .setValue(this.plugin.settings.openTarget)
        .onChange(async (value) => {
        this.plugin.settings.openTarget = value === "web" ? "web" : "desktop";
        await this.plugin.saveSettings();
      }));

    new Setting(this.containerEl)
      .setName("Show content previews")
      .setDesc("Show a short local Markdown preview inside each mind-map node.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showNodeContent).onChange(async (value) => {
        this.plugin.settings.showNodeContent = value;
        await this.plugin.saveSettings();
      }));

  }
}
