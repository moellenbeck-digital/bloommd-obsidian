/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/core/src/agent-ledger.ts by the BloomMD mirror sync.
 * Source SHA-256: 4c0df04e56db1e93d0c2ff8e3c2c603748b820992dcf4c373a38708d077deaff
 */
/**
 * The agent's state next to a knowledge target (`.bloommd/` in a vault): rights (`agent.json`),
 * proposals only a person may apply, the history used for undo, the change log and the requests a
 * person leaves on a map node for the agent.
 *
 * Storage-free on purpose: the wiki CLI (Node fs) and the Obsidian plugin (vault adapter, also on
 * iPad) use this same code, so approving, rejecting and undoing follow one set of rules.
 */
import { flattenHeadings, parseHeadingTree } from "./markdown-document";

/** What an agent may do in an area: read only, write proposals for review, or write directly. */
export type AgentAccess = "read" | "propose" | "write";
export type AgentTarget = "vault" | "cloud";

export interface AgentAccessConfig {
  /** Access in areas without their own rule. */
  access: AgentAccess;
  /** Per area (top-level folder or cloud prefix), e.g. { "Arbeit": "propose" }. */
  areas?: Record<string, AgentAccess>;
}

export interface AgentHistoryEntry {
  changeId: string;
  at: string;
  agent: string;
  /** "agent" = written by the agent directly; "approved" = a proposal a person applied. */
  origin?: "agent" | "approved";
  tool: string;
  target: AgentTarget;
  path: string;
  before: string | null;
  afterVersion: string;
  reason?: string;
  source?: string;
}

export interface AgentProposal {
  id: string;
  at: string;
  agent: string;
  tool: string;
  target: AgentTarget;
  path: string;
  area: string;
  baseVersion: string | null;
  markdown: string;
  summary: string;
  reason?: string;
  source?: string;
}

/** A question or instruction a person left for the agent, usually on one map node. */
export interface AgentRequest {
  id: string;
  at: string;
  by: string;
  path: string;
  nodeId?: string;
  nodeTitle?: string;
  question: string;
  status: "open" | "answered" | "failed";
  answer?: string;
  answeredAt?: string;
  agent?: string;
  proposalId?: string;
  changeId?: string;
}

/** Files below the state folder; names use "/" (e.g. "proposals/p1.json"). */
export interface AgentStateFiles {
  /** null when the file does not exist. */
  read(name: string): Promise<string | null>;
  /** Creates missing parent folders. */
  write(name: string, text: string): Promise<void>;
  append(name: string, text: string): Promise<void>;
  /** Ignores missing files. */
  remove(name: string): Promise<void>;
  /** File names in a folder; empty when it does not exist. */
  list(dir: string): Promise<string[]>;
}

export interface AgentDocument {
  path: string;
  markdown: string;
  version: string;
}

/** The notes or maps the agent works on. */
export interface AgentDocuments {
  /** null when the document does not exist. */
  read(path: string): Promise<AgentDocument | null>;
  /** Writes when `expectedVersion` still matches (null = must not exist yet). */
  write(path: string, markdown: string, expectedVersion: string | null): Promise<{ version: string }>;
  /** Deletes a document; without it, undoing a created document is refused. */
  remove?(path: string): Promise<void>;
}

export const AGENT_HISTORY_LIMIT = 300;
export const AGENT_ACCESS: readonly AgentAccess[] = ["read", "propose", "write"];

/** Content hash used as document version for optimistic writes (FNV-1a, two 32-bit halves). */
export function knowledgeVersion(markdown: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < markdown.length; index += 1) {
    const code = markdown.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * Names compared the way macOS (APFS, case-insensitive) and iCloud see them: "arbeit", "ARBEIT"
 * and "Arbeit" are the same folder, and so are composed and decomposed umlauts.
 */
export function foldName(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** Top-level folder of a vault path ("" at the top level). */
export function vaultArea(path: string): string {
  return path.includes("/") ? path.split("/")[0]! : "";
}

/** A Markdown path inside the vault, never in a hidden folder or outside of it. */
export function isVaultNotePath(path: string): boolean {
  const parts = path.split("/");
  return /\.md$/i.test(path) && !/^[A-Za-z]:/.test(path) && parts.every((part) => part !== "" && !part.startsWith(".") && part !== "node_modules");
}

/** Reads `agent.json`; without it (or when it is broken) the agent may only propose. */
export function parseAccessConfig(json: string | null): AgentAccessConfig {
  try {
    const parsed = JSON.parse(json ?? "") as Partial<AgentAccessConfig>;
    const valid = (value: unknown): value is AgentAccess => AGENT_ACCESS.includes(value as AgentAccess);
    return { access: valid(parsed.access) ? parsed.access : "propose", areas: Object.fromEntries(Object.entries(parsed.areas ?? {}).filter(([, value]) => valid(value))) };
  } catch {
    return { access: "propose", areas: {} };
  }
}

export function accessFor(config: AgentAccessConfig, area: string): AgentAccess {
  // A rule for "Arbeit" also covers "arbeit" and "ARBEIT"; the strictest matching rule wins.
  const folded = Object.entries(config.areas ?? {}).filter(([key]) => foldName(key) === foldName(area)).map(([, value]) => value);
  if (folded.length === 0) return config.access;
  return folded.includes("read") ? "read" : folded.includes("propose") ? "propose" : "write";
}

export function newAgentId(prefix: "p" | "c" | "r"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The note changed since the proposal was made; `current` lets a person compare before deciding. */
export class AgentProposalConflictError extends Error {
  constructor(readonly proposal: AgentProposal, readonly current: AgentDocument | null) {
    super(`${proposal.path} changed since the proposal was made; reject it and let the agent propose again.`);
    this.name = "AgentProposalConflictError";
  }
}

/** One line of a compact outline diff: + added, - removed, ~ title or text changed. */
export interface OutlineChange {
  mark: "+" | "-" | "~";
  id: string;
  title: string;
  level: number;
}

/** What a change does to the headings of a map, by node id. */
export function outlineDiff(before: string | null, after: string): OutlineChange[] {
  const nodes = (markdown: string) => flattenHeadings(parseHeadingTree(markdown));
  const old = new Map(nodes(before ?? "").map((node) => [node.id, node]));
  const result: OutlineChange[] = [];
  for (const node of nodes(after)) {
    const previous = old.get(node.id);
    old.delete(node.id);
    const line = (mark: OutlineChange["mark"]) => result.push({ mark, id: node.id, title: node.title, level: node.level });
    if (!previous) line("+");
    else if (previous.title !== node.title || previous.content !== node.content || JSON.stringify(previous.metadata) !== JSON.stringify(node.metadata)) line("~");
  }
  for (const node of old.values()) result.push({ mark: "-", id: node.id, title: node.title, level: node.level });
  return result;
}

const json = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));

export class AgentLedger {
  /**
   * @param agent who acts through this ledger: the agent's name (MCP) or the owner (CLI, Obsidian).
   */
  constructor(readonly files: AgentStateFiles, readonly agent: string, readonly target: AgentTarget, private readonly now: () => Date = () => new Date()) {}

  async rights(): Promise<AgentAccessConfig> {
    return parseAccessConfig(await this.files.read("agent.json"));
  }

  async setRights(config: AgentAccessConfig): Promise<void> {
    await this.files.write("agent.json", `${JSON.stringify(config, null, 2)}\n`);
  }

  async access(area: string): Promise<AgentAccess> {
    return accessFor(await this.rights(), area);
  }

  async log(event: Record<string, unknown>): Promise<void> {
    await this.files.append("agent-log.jsonl", `${JSON.stringify({ at: this.now().toISOString(), agent: this.agent, target: this.target, ...event })}\n`);
  }

  /** The newest `limit` log entries, newest first. */
  async changes(limit = 20): Promise<Array<Record<string, unknown>>> {
    const log = (await this.files.read("agent-log.jsonl")) ?? "";
    return log.trim().split("\n").filter(Boolean).slice(-limit).map((line) => JSON.parse(line) as Record<string, unknown>).reverse();
  }

  /** Stores the state before a change for undo; keeps the newest `AGENT_HISTORY_LIMIT` entries. */
  async remember(entry: Omit<AgentHistoryEntry, "changeId" | "at" | "agent" | "target">): Promise<string> {
    const changeId = newAgentId("c");
    const record: AgentHistoryEntry = { changeId, at: this.now().toISOString(), agent: this.agent, target: this.target, ...entry };
    await this.files.write(`history/${changeId}.json`, JSON.stringify(record));
    const names = (await this.files.list("history")).filter((name) => name.endsWith(".json")).sort();
    for (const stale of names.slice(0, Math.max(0, names.length - AGENT_HISTORY_LIMIT))) await this.files.remove(`history/${stale}`);
    return changeId;
  }

  async change(changeId: string): Promise<AgentHistoryEntry> {
    if (!/^c[a-z0-9]+$/.test(changeId)) throw new Error("Unknown change id.");
    const record = json<AgentHistoryEntry>(await this.files.read(`history/${changeId}.json`));
    if (!record) throw new Error(`Change ${changeId} is not in the history (only the last ${AGENT_HISTORY_LIMIT} are kept).`);
    return record;
  }

  /** Undoable changes, newest first. */
  async history(): Promise<AgentHistoryEntry[]> {
    return (await this.readAll<AgentHistoryEntry>("history")).reverse();
  }

  async propose(input: Pick<AgentProposal, "tool" | "path" | "area" | "baseVersion" | "markdown" | "summary"> & { reason?: string; source?: string }): Promise<string> {
    const proposal: AgentProposal = {
      id: newAgentId("p"),
      at: this.now().toISOString(),
      agent: this.agent,
      tool: input.tool,
      target: this.target,
      path: input.path,
      area: input.area,
      baseVersion: input.baseVersion,
      markdown: input.markdown,
      summary: input.summary,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.source ? { source: input.source } : {}),
    };
    await this.files.write(`proposals/${proposal.id}.json`, `${JSON.stringify(proposal, null, 2)}\n`);
    await this.log({ event: "proposed", tool: input.tool, path: input.path, proposalId: proposal.id, summary: input.summary, reason: input.reason, source: input.source });
    return proposal.id;
  }

  /** Oldest first. */
  async proposals(): Promise<AgentProposal[]> {
    return this.readAll<AgentProposal>("proposals");
  }

  async proposal(id: string): Promise<AgentProposal> {
    const proposal = /^p[a-z0-9]+$/.test(id) ? json<AgentProposal>(await this.files.read(`proposals/${id}.json`)) : null;
    if (!proposal) throw new Error(`Proposal ${id} not found.`);
    return proposal;
  }

  /**
   * Applies a proposal. For people only: neither the MCP server nor the agent may call this.
   * Refused when the document changed since the proposal, unless the person saw the current state
   * and decided to apply it anyway (`overwrite`); the history keeps what it replaced.
   */
  async applyProposal(proposal: AgentProposal, reviewer: string, store: AgentDocuments, options: { overwrite?: boolean } = {}) {
    const current = await store.read(proposal.path);
    const changed = (proposal.baseVersion === null) !== (current === null) || (current !== null && current.version !== proposal.baseVersion);
    if (changed && !options.overwrite) throw new AgentProposalConflictError(proposal, current);
    const written = await store.write(proposal.path, proposal.markdown, changed ? current?.version ?? null : proposal.baseVersion);
    const changeId = await this.remember({ origin: "approved", tool: `${proposal.tool} (approved by ${reviewer})`, path: proposal.path, before: current?.markdown ?? null, afterVersion: written.version, reason: proposal.reason, source: proposal.source });
    await this.files.remove(`proposals/${proposal.id}.json`);
    await this.log({ event: "approved", path: proposal.path, proposalId: proposal.id, changeId, reviewer, ...(changed ? { overwrote: current?.version ?? null } : {}) });
    return { applied: proposal.id, changeId, path: proposal.path };
  }

  async rejectProposal(id: string, reviewer: string, reason?: string) {
    if (!/^p[a-z0-9]+$/.test(id) || (await this.files.read(`proposals/${id}.json`)) === null) throw new Error(`Proposal ${id} not found.`);
    await this.files.remove(`proposals/${id}.json`);
    await this.log({ event: "rejected", proposalId: id, reviewer, ...(reason ? { reason } : {}) });
    return { rejected: id };
  }

  /**
   * Restores the state before a change, unless the document was edited since.
   *
   * By default (the agent) only the agent's own direct writes can be undone, and only within its
   * rights: in a `propose` area the undo becomes a proposal, in a `read` area it is refused. A
   * change a person approved is never undone by the agent. `asOwner` (CLI, Obsidian) may undo any
   * change.
   */
  async undo(changeId: string, store: AgentDocuments, options: { asOwner?: boolean; areaOf: (path: string) => string }) {
    const record = await this.change(changeId);
    const current = await store.read(record.path);
    if (!current || current.version !== record.afterVersion) throw new Error(`${record.path} was edited after change ${changeId}; undo it by hand.`);
    if (!options.asOwner) {
      // Entries from before `origin` existed: approved ones carry the reviewer in the tool name.
      const origin = record.origin ?? (/\(approved by /.test(record.tool) ? "approved" : "agent");
      if (origin !== "agent" || record.agent !== this.agent) {
        throw new Error(`Change ${changeId} was approved or made by someone else; only the owner can undo it (bloommd-wiki agent undo).`);
      }
      const area = options.areaOf(current.path);
      const access = await this.access(area);
      if (access === "read") throw new Error(`The agent may only read in "${area || "(top level)"}"; ask the owner to undo change ${changeId}.`);
      if (access === "propose") {
        if (record.before === null) throw new Error(`Removing a map needs the owner in "${area || "(top level)"}"; ask them to undo change ${changeId}.`);
        const proposalId = await this.propose({ tool: "bloommd_undo", path: current.path, area, baseVersion: current.version, markdown: record.before, summary: `Undo change ${changeId}` });
        return { proposed: proposalId, changeId, path: current.path };
      }
    }
    if (record.before === null) {
      if (!store.remove) throw new Error("Removing a created cloud map is not supported; delete it in BloomMD.");
      await store.remove(record.path);
    } else {
      await store.write(record.path, record.before, current.version);
    }
    await this.files.remove(`history/${changeId}.json`);
    await this.log({ event: "undone", path: record.path, changeId, ...(options.asOwner ? { by: "owner" } : {}) });
    return { undone: changeId, path: record.path };
  }

  /** Newest first. */
  async requests(): Promise<AgentRequest[]> {
    return (await this.readAll<AgentRequest>("requests")).reverse();
  }

  async request(id: string): Promise<AgentRequest> {
    const request = /^r[a-z0-9]+$/.test(id) ? json<AgentRequest>(await this.files.read(`requests/${id}.json`)) : null;
    if (!request) throw new Error(`Request ${id} not found.`);
    return request;
  }

  async createRequest(input: Pick<AgentRequest, "path" | "question"> & Partial<Pick<AgentRequest, "nodeId" | "nodeTitle">>): Promise<AgentRequest> {
    const question = input.question.trim();
    if (!question) throw new Error("The request needs a question or instruction.");
    const request: AgentRequest = { id: newAgentId("r"), at: this.now().toISOString(), by: this.agent, path: input.path, ...(input.nodeId ? { nodeId: input.nodeId, nodeTitle: input.nodeTitle } : {}), question, status: "open" };
    await this.files.write(`requests/${request.id}.json`, `${JSON.stringify(request, null, 2)}\n`);
    await this.log({ event: "requested", path: request.path, requestId: request.id, nodeId: request.nodeId });
    return request;
  }

  /** The agent's answer; a resulting change is linked as proposal or change id. */
  async answerRequest(id: string, answer: Pick<AgentRequest, "answer"> & Partial<Pick<AgentRequest, "status" | "proposalId" | "changeId">>): Promise<AgentRequest> {
    const request = await this.request(id);
    const next: AgentRequest = { ...request, status: answer.status ?? "answered", answer: answer.answer, answeredAt: this.now().toISOString(), agent: this.agent, ...(answer.proposalId ? { proposalId: answer.proposalId } : {}), ...(answer.changeId ? { changeId: answer.changeId } : {}) };
    await this.files.write(`requests/${id}.json`, `${JSON.stringify(next, null, 2)}\n`);
    await this.log({ event: "answered", path: request.path, requestId: id, status: next.status, proposalId: answer.proposalId, changeId: answer.changeId });
    return next;
  }

  async removeRequest(id: string): Promise<void> {
    await this.request(id);
    await this.files.remove(`requests/${id}.json`);
  }

  private async readAll<T>(dir: string): Promise<T[]> {
    const names = (await this.files.list(dir)).filter((name) => name.endsWith(".json")).sort();
    const entries: Array<T | null> = await Promise.all(names.map(async (name) => json<T>(await this.files.read(`${dir}/${name}`))));
    return entries.filter((entry): entry is T => entry !== null);
  }
}
