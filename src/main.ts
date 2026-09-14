import {
  App,
  ConfirmationModal,
  FileSystemAdapter,
  ItemView,
  MarkdownView,
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
  type SettingDefinitionItem,
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
  createCanvasMount,
  type BacklinkEntry,
  type CanvasHeading,
  type CanvasMount,
  type PersistedCanvasLayout,
  type ResourceEntry,
} from "./canvas";
import { historyFocusId } from "./history-focus";
import { migratePersistedPathState } from "./path-migration";
import type { ObsidianSharedDocumentEntry, ObsidianSharedDocumentSession } from "./shared-document";

const VIEW_TYPE_BLOOMMD = "bloommd-mindmap-view";
const BLOOMMD_WEB_DEMO = "https://bloommd.io/demo";
const COLLABORATION_TOKEN_SECRET_ID = "bloommd-collaboration-token";

type SharedDocumentRuntime = typeof import("./shared-runtime");

/**
 * Collaboration is an opt-in feature. The runtime is a second CommonJS artifact so opening a
 * purely local vault note never has to parse Yjs and the sync protocol.
 */
function loadSharedDocumentRuntime(): Promise<SharedDocumentRuntime> {
  return import("./shared-runtime");
}

interface BloomMDSettings {
  openTarget: "desktop" | "web";
  showNodeContent: boolean;
  collaborationServerUrl: string;
  collaborationWorkspaceId: string;
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

function chooseSharedDocument(app: App, choices: SharedDocumentChoice[]): Promise<SharedDocumentChoice | null> {
  return new Promise((resolveChoice) => new SharedDocumentChoiceModal(app, choices, resolveChoice).open());
}

const DEFAULT_SETTINGS: BloomMDSettings = {
  openTarget: "desktop",
  showNodeContent: true,
  collaborationServerUrl: "https://bloommd.app",
  collaborationWorkspaceId: "",
};

const EMPTY_LAYOUT: PersistedCanvasLayout = { positions: {}, collapsed: [] };

function confirmDelete(app: App, title: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    new ConfirmationModal(app)
      .setTitle("Delete branch?")
      .setContent(`Delete "${title}" and its complete branch?`)
      .addButton((button) => {
        button
          .setButtonText("Delete branch")
          .setDestructive()
          .setCta()
          .onClick(() => finish(true));
      })
      .addCancelButton("Cancel")
      .setCloseCallback(() => finish(false))
      .open();
  });
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
    this.scopeFolder = file.parent;
    this.layoutKey = `file:${file.path}`;
    this.lastKnownMarkdown = markdown;
    const tree = parseHeadingTree(markdown);
    this.headings = canvasHeadings(tree);
    this.rootId = tree[0]?.id ?? "";
    this.renderCanvas();
  }

  setFolder(folder: TFolder) {
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
      files: this.plugin.markdownFiles(this.scopeFolder),
      backlinks: this.backlinks(),
      layout: this.plugin.getLayout(this.layoutKey),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      showNodeContent: this.plugin.settings.showNodeContent,
      sharedStatus: sourceFile ? this.plugin.getSharedDocumentStatus(sourceFile.path) : null,
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
  private sharedDocumentBindings: ObsidianSharedDocumentEntry[] = [];
  private sharedDocumentSessions = new Map<string, ObsidianSharedDocumentSession>();
  private saveTimer: number | null = null;

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_BLOOMMD, (leaf) => new BloomMDView(leaf, this));

    this.addRibbonIcon("git-branch", "Visualize current note", () => void this.visualizeCurrentNote());
    this.addCommand({ id: "visualize-current-note", name: "Visualize current note", callback: () => void this.visualizeCurrentNote() });
    this.addCommand({ id: "open-current-note", name: "Open current note", callback: () => void this.openCurrentNoteInBloomMD() });
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
    if (token) {
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
    return this.sharedDocumentBindings.find((entry) => entry.localPath === localPath)?.binding.connectionState ?? null;
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
    this.settings = { ...DEFAULT_SETTINGS, ...storedSettings, openTarget: migratedTarget };
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
    if (this.sharedDocumentSessions.has(file.path)) return;
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
          desc: "Desktop opens the local file on macOS. Web opens the private local-file demo without uploading note content.",
          control: {
            type: "dropdown",
            key: "openTarget",
            defaultValue: "desktop",
            options: { desktop: "Desktop app", web: "Web app" },
          },
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
    }];
  }

  getControlValue(key: string): unknown {
    if (key === "openTarget") return this.plugin.settings.openTarget;
    if (key === "showNodeContent") return this.plugin.settings.showNodeContent;
    if (key === "collaborationServerUrl") return this.plugin.settings.collaborationServerUrl;
    if (key === "collaborationWorkspaceId") return this.plugin.settings.collaborationWorkspaceId;
    return undefined;
  }

  setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "openTarget" && (value === "desktop" || value === "web")) {
      this.plugin.settings.openTarget = value;
    } else if (key === "showNodeContent" && typeof value === "boolean") {
      this.plugin.settings.showNodeContent = value;
    } else if (key === "collaborationServerUrl" && typeof value === "string") {
      this.plugin.settings.collaborationServerUrl = value.trim();
    } else if (key === "collaborationWorkspaceId" && typeof value === "string") {
      this.plugin.settings.collaborationWorkspaceId = value.trim();
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
