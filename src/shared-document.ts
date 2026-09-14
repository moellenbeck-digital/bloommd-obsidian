import {
  SharedDocumentMirror,
  WorkspaceSyncClient,
  createLocalSharedDocumentState,
  documentToYDoc,
  hashSharedDocumentMarkdown,
  parseFile,
  serializeToMarkdown,
  transitionSharedDocumentState,
  yDocToDocument,
  type SharedDocumentBinding,
  type SharedDocumentConnectionState,
  SyncProvider,
} from "./shared-dependencies";
import * as Y from "yjs";

export interface SharedVaultFile {
  /** Vault-relative local identity. It is never sent to the BloomMD API. */
  path: string;
  basename: string;
}

export interface SharedVaultAdapter {
  readMarkdown(file: SharedVaultFile): Promise<string>;
  writeMarkdown(file: SharedVaultFile, markdown: string): Promise<void>;
}

export interface ObsidianSharedDocumentEntry {
  localPath: string;
  binding: SharedDocumentBinding;
}

export interface ObsidianSharedDocumentSessionOptions {
  file: SharedVaultFile;
  binding: SharedDocumentBinding;
  accessToken: string;
  serverUrl: string;
  vault: SharedVaultAdapter;
  onBindingChange: (binding: SharedDocumentBinding) => Promise<void> | void;
  onStatusChange?: (state: SharedDocumentConnectionState) => void;
  createClient?: (serverUrl: string, accessToken: string) => WorkspaceSyncClient;
  createProvider?: (input: ConstructorParameters<typeof SyncProvider>[0]) => SharedSyncProvider;
}

export interface SharedSyncProvider {
  getStatus(): ReturnType<SyncProvider["getStatus"]>;
  setConnectionUrl(url: string, refreshUrl?: () => Promise<string>): void;
  connect(): void;
  disconnect(): void;
}

/**
 * Obsidian adapter around the shared local Markdown mirror. It owns a single, explicitly bound
 * vault file; paths remain client-local and only the cloud filename enters tickets and API calls.
 */
export class ObsidianSharedDocumentSession {
  private readonly file: SharedVaultFile;
  private readonly vault: SharedVaultAdapter;
  private readonly onBindingChange: (binding: SharedDocumentBinding) => Promise<void> | void;
  private readonly onStatusChange?: (state: SharedDocumentConnectionState) => void;
  private readonly client: WorkspaceSyncClient;
  private readonly yDoc = new Y.Doc();
  private readonly mirror: SharedDocumentMirror;
  private readonly provider: SharedSyncProvider;
  private disposed = false;

  constructor(options: ObsidianSharedDocumentSessionOptions) {
    this.file = options.file;
    this.vault = options.vault;
    this.onBindingChange = options.onBindingChange;
    this.onStatusChange = options.onStatusChange;
    this.client = (options.createClient ?? ((serverUrl, accessToken) => new WorkspaceSyncClient({ baseUrl: serverUrl, accessToken })))(options.serverUrl, options.accessToken);
    this.mirror = new SharedDocumentMirror({
      binding: options.binding,
      hashMarkdown: hashSharedDocumentMarkdown,
      file: {
        readMarkdown: () => this.vault.readMarkdown(this.file),
        writeMarkdown: (markdown) => this.vault.writeMarkdown(this.file, markdown),
      },
      publishLocalMarkdown: async (markdown, expectedCloudVersion) => {
        if (this.provider.getStatus() !== "connected") throw new Error("SYNC_OFFLINE");
        documentToYDoc(parseFile(this.file.basename, markdown), this.yDoc, OBSIDIAN_LOCAL_FILE_ORIGIN);
        return { kind: "acknowledged", cloudVersion: expectedCloudVersion };
      },
      onBindingChange: (binding) => {
        this.onStatusChange?.(binding.connectionState);
        void Promise.resolve(this.onBindingChange(binding)).catch((error: unknown) => {
          console.error("BloomMD: failed to persist shared document binding", error);
        });
      },
      classifyPublishError: (error) => /(?:401|403|404|access[_ -]?revoked)/iu.test(error instanceof Error ? error.message : String(error)) ? "revoked" : "offline",
    });
    this.provider = (options.createProvider ?? ((input) => new SyncProvider(input)))({
      url: "ws://invalid-before-ticket",
      doc: this.yDoc,
      onStatusChange: (status) => {
        if (this.disposed) return;
        if (status === "connected") {
          void this.restoreAndPublishLocalMarkdown();
        } else if (status === "disconnected" || status === "reconnecting" || status === "failed") {
          void this.markConnectionUnavailable();
        }
      },
      onAccessRevoked: () => {
        void this.mirror.markAccessRevoked();
      },
    });
    this.yDoc.on("update", this.handleYDocUpdate);
  }

  static async share(options: Omit<ObsidianSharedDocumentSessionOptions, "binding"> & { workspaceId?: string; cloudFilename?: string }): Promise<ObsidianSharedDocumentSession> {
    const markdown = await options.vault.readMarkdown(options.file);
    const client = (options.createClient ?? ((serverUrl, accessToken) => new WorkspaceSyncClient({ baseUrl: serverUrl, accessToken })))(options.serverUrl, options.accessToken);
    const requestedWorkspaceId = options.workspaceId?.trim();
    const context = requestedWorkspaceId ? await client.selectWorkspace(requestedWorkspaceId) : await client.listWorkspaces();
    if (context.workspace?.role === "viewer") throw new Error("WORKSPACE_READ_ONLY");
    if (!context.workspace) throw new Error("WORKSPACE_NOT_SELECTED");
    const cloudFilename = options.cloudFilename?.trim() || `${options.file.basename}.md`;
    const created = await client.createDocument(cloudFilename, markdown);
    const local = createLocalSharedDocumentState(hashSharedDocumentMarkdown(markdown));
    const sharing = transitionSharedDocumentState(local, { type: "share_requested", workspaceId: context.workspace.id, cloudFilename });
    const connected = transitionSharedDocumentState(sharing, {
      type: "share_confirmed",
      documentId: created.documentId,
      cloudVersion: created.cloudVersion,
      markdownHash: hashSharedDocumentMarkdown(markdown),
    });
    if (connected.kind !== "connected") throw new Error("SHARED_DOCUMENT_BINDING_FAILED");
    await client.recordSharedDocumentBinding("bound", connected.binding.documentId);
    const session = new ObsidianSharedDocumentSession({ ...options, binding: connected.binding, createClient: () => client });
    await options.onBindingChange(connected.binding);
    await session.connect();
    return session;
  }

  /**
   * Explicitly binds this local note to an already existing cloud document. Unlike `share`, this
   * never creates a second cloud file when Desktop or another client already owns the document.
   * The current local hash becomes the comparison baseline: a later remote mismatch is surfaced
   * by SharedDocumentMirror as a conflict instead of overwriting either side.
   */
  static async bindExisting(options: Omit<ObsidianSharedDocumentSessionOptions, "binding"> & { workspaceId?: string; cloudFilename: string }): Promise<ObsidianSharedDocumentSession> {
    const markdown = await options.vault.readMarkdown(options.file);
    const client = (options.createClient ?? ((serverUrl, accessToken) => new WorkspaceSyncClient({ baseUrl: serverUrl, accessToken })))(options.serverUrl, options.accessToken);
    const requestedWorkspaceId = options.workspaceId?.trim();
    const context = requestedWorkspaceId ? await client.selectWorkspace(requestedWorkspaceId) : await client.listWorkspaces();
    if (context.workspace?.role === "viewer") throw new Error("WORKSPACE_READ_ONLY");
    if (!context.workspace) throw new Error("WORKSPACE_NOT_SELECTED");
    const existing = await client.getExistingDocument(options.cloudFilename);
    const local = createLocalSharedDocumentState(hashSharedDocumentMarkdown(markdown));
    const bindingRequested = transitionSharedDocumentState(local, {
      type: "share_requested",
      workspaceId: context.workspace.id,
      cloudFilename: existing.filename,
    });
    const connected = transitionSharedDocumentState(bindingRequested, {
      type: "share_confirmed",
      documentId: existing.documentId,
      cloudVersion: existing.cloudVersion,
      markdownHash: hashSharedDocumentMarkdown(markdown),
    });
    if (connected.kind !== "connected") throw new Error("SHARED_DOCUMENT_BINDING_FAILED");
    await client.recordSharedDocumentBinding("bound", connected.binding.documentId);
    const session = new ObsidianSharedDocumentSession({ ...options, binding: connected.binding, createClient: () => client });
    await options.onBindingChange(connected.binding);
    await session.connect();
    return session;
  }

  getBinding(): SharedDocumentBinding {
    return this.mirror.getBinding();
  }

  async connect(): Promise<void> {
    const ticket = await this.client.fetchSyncTicket(this.mirror.getBinding().cloudFilename);
    if (ticket.permission !== "write") throw new Error("WORKSPACE_READ_ONLY");
    this.provider.setConnectionUrl(ticket.websocketUrl, async () => {
      const refreshed = await this.client.fetchSyncTicket(this.mirror.getBinding().cloudFilename);
      return refreshed.websocketUrl;
    });
    this.provider.connect();
  }

  async handleVaultModify(markdown: string): Promise<void> {
    if (this.disposed) return;
    await this.mirror.handleLocalMarkdown(markdown);
  }

  disconnect(): void {
    this.disposed = true;
    this.yDoc.off("update", this.handleYDocUpdate);
    this.provider.disconnect();
    this.yDoc.destroy();
  }

  private readonly handleYDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (this.disposed || origin === OBSIDIAN_LOCAL_FILE_ORIGIN) return;
    const document = yDocToDocument(this.yDoc);
    if (document.nodes.size === 0) return;
    const markdown = serializeToMarkdown(document);
    void this.mirror.applyRemoteMarkdown(markdown, this.mirror.getBinding().lastKnownCloudVersion)
      .catch((error: unknown) => console.error("BloomMD: failed to mirror remote shared Markdown", error));
  };

  private async restoreAndPublishLocalMarkdown(): Promise<void> {
    await this.mirror.markConnectionRestored();
    const markdown = await this.vault.readMarkdown(this.file);
    await this.mirror.handleLocalMarkdown(markdown);
  }

  private async markConnectionUnavailable(): Promise<void> {
    if (this.mirror.getBinding().connectionState !== "connected") return;
    await this.mirror.markConnectionLost();
  }
}

const OBSIDIAN_LOCAL_FILE_ORIGIN = "obsidian-local-file-mirror" as const;
