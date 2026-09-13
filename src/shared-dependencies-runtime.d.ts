/**
 * GENERATED RELEASE CONTRACT — DO NOT EDIT IN THE PUBLIC MIRROR.
 *
 * This source-side declaration is copied beside the generated browser bundle. It gives the
 * standalone Obsidian build the same narrow, strict type surface as the canonical plugin without
 * leaking a private workspace dependency into its package manifest.
 */
import type * as Y from "yjs";
import type { MindMapDocument } from "./core-types";

export type SharedDocumentConnectionState = "connected" | "offline" | "conflict" | "revoked";

export interface SharedDocumentBinding {
  schemaVersion: 1;
  workspaceId: string;
  documentId: string;
  cloudFilename: string;
  lastAcknowledgedMarkdownHash: string;
  lastKnownCloudVersion: number;
  connectionState: SharedDocumentConnectionState;
}

export type SharedDocumentState =
  | { kind: "local" | "unshared"; localMarkdownHash: string }
  | { kind: "sharing"; localMarkdownHash: string; workspaceId: string; cloudFilename: string }
  | { kind: SharedDocumentConnectionState; binding: SharedDocumentBinding };

export type SharedDocumentEvent =
  | { type: "share_requested"; workspaceId: string; cloudFilename: string }
  | { type: "share_confirmed"; documentId: string; cloudVersion: number; markdownHash: string }
  | { type: "connection_restored" }
  | { type: "connection_lost" }
  | { type: "conflict_detected" }
  | { type: "conflict_resolved"; cloudVersion: number; markdownHash: string }
  | { type: "access_revoked" }
  | { type: "mirror_acknowledged"; cloudVersion: number; markdownHash: string }
  | { type: "unshared"; localMarkdownHash: string };

export interface SharedDocumentMirrorFileAdapter {
  readMarkdown(): Promise<string>;
  writeMarkdown(markdown: string): Promise<void>;
}

export type SharedDocumentMirrorPublishResult =
  | { kind: "acknowledged"; cloudVersion: number; markdownHash?: string }
  | { kind: "conflict" }
  | { kind: "revoked" };

export interface SharedDocumentMirrorOptions {
  binding: SharedDocumentBinding;
  file: SharedDocumentMirrorFileAdapter;
  hashMarkdown(markdown: string): string;
  publishLocalMarkdown(markdown: string, expectedCloudVersion: number): Promise<SharedDocumentMirrorPublishResult>;
  onBindingChange?(binding: SharedDocumentBinding): void;
  classifyPublishError?(error: unknown): "offline" | "revoked";
}

export declare class SharedDocumentMirror {
  constructor(options: SharedDocumentMirrorOptions);
  getBinding(): SharedDocumentBinding;
  handleLocalMarkdown(markdown: string): Promise<unknown>;
  applyRemoteMarkdown(markdown: string, cloudVersion: number): Promise<unknown>;
  markConnectionRestored(): Promise<SharedDocumentBinding>;
  markConnectionLost(): Promise<SharedDocumentBinding>;
  markAccessRevoked(): Promise<SharedDocumentBinding>;
}

export interface WorkspaceSyncClientConfig {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface WorkspaceSyncWorkspace {
  id: string;
  name: string;
  slug: string;
  kind: "personal" | "team";
  role: "owner" | "editor" | "viewer";
}

export interface WorkspaceSyncContext {
  workspace: WorkspaceSyncWorkspace | null;
  workspaces: WorkspaceSyncWorkspace[];
}

export declare class WorkspaceSyncClient {
  constructor(config: WorkspaceSyncClientConfig);
  listWorkspaces(): Promise<WorkspaceSyncContext>;
  selectWorkspace(workspaceId: string): Promise<WorkspaceSyncContext>;
  createDocument(filename: string, markdown: string): Promise<{ documentId: string; cloudVersion: number }>;
  fetchSyncTicket(filename: string): Promise<{ websocketUrl: string; expiresAt: string; permission: "read" | "write" }>;
  recordSharedDocumentBinding(action: "bound" | "unbound", documentId: string): Promise<void>;
}

export type SyncStatus = "disconnected" | "connecting" | "reconnecting" | "connected" | "failed";

export interface SyncProviderOptions {
  url: string;
  doc: Y.Doc;
  refreshUrl?: () => Promise<string>;
  onStatusChange?: (status: SyncStatus) => void;
  onAccessRevoked?: () => void;
}

export declare class SyncProvider {
  constructor(options: SyncProviderOptions);
  getStatus(): SyncStatus;
  setConnectionUrl(url: string, refreshUrl?: () => Promise<string>): void;
  connect(): void;
  disconnect(): void;
}

export declare function createLocalSharedDocumentState(localMarkdownHash: string): { kind: "local"; localMarkdownHash: string };
export declare function transitionSharedDocumentState(state: SharedDocumentState, event: SharedDocumentEvent): SharedDocumentState;
export declare function hashSharedDocumentMarkdown(markdown: string): string;
export declare function parseFile(filePath: string, raw: string): MindMapDocument;
export declare function serializeToMarkdown(document: MindMapDocument): string;
export declare function documentToYDoc(document: MindMapDocument, existingDoc?: Y.Doc, origin?: unknown): Y.Doc;
export declare function yDocToDocument(document: Y.Doc): MindMapDocument;
