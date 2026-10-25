/**
 * The agent side view: review the agent's proposals, see and undo its changes, set its rights and
 * leave requests on map nodes. Plain Obsidian DOM (no React tree) keeps it small for main.js.
 *
 * Approving, rejecting and undoing are things only a person does here; the agent (MCP server) has
 * no tool for them. The rules come from the shared AgentLedger, the same as `bloommd-wiki agent`.
 */
import { ConfirmationModal, ItemView, Modal, Notice, Setting, type App, type EventRef, type Plugin, type WorkspaceLeaf } from "obsidian";
import {
  AGENT_ACCESS,
  AgentLedger,
  AgentProposalConflictError,
  outlineDiff,
  parseAccessConfig,
  vaultArea,
  type AgentAccess,
  type AgentProposal,
  type AgentRequest,
} from "./agent-ledger";
import { vaultAgentDocuments, vaultAgentFiles } from "./agent-vault";

export const VIEW_TYPE_AGENT = "bloommd-agent-view";
const POLL_MS = 20_000;
type Tab = "proposals" | "requests" | "history" | "rights";

const ACCESS_HELP: Record<AgentAccess, string> = {
  read: "Read: the agent may only read and search.",
  propose: "Propose: changes wait here until you approve them.",
  write: "Write: the agent writes directly, with log and undo (suggested for your own agent).",
};

/** A confirmation dialog; resolves to true when the action button was chosen. */
export function confirmAction(app: App, title: string, content: string, action: string, destructive = true): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) resolve(value);
      settled = true;
    };
    new ConfirmationModal(app)
      .setTitle(title)
      .setContent(content)
      .addButton((button) => {
        if (destructive) button.setDestructive();
        button.setButtonText(action).setCta().onClick(() => finish(true));
      })
      .addCancelButton("Cancel")
      .setCloseCallback(() => finish(false))
      .open();
  });
}

/** Asks for a line of text: the request to the agent, or an optional reason for a rejection. */
class TextModal extends Modal {
  constructor(app: App, private readonly options: { title: string; hint: string; action: string; required: boolean; submit: (text: string) => Promise<void> }) {
    super(app);
  }

  onOpen() {
    this.setTitle(this.options.title);
    this.modalEl.addClass("bloommd-agent-modal");
    const input = this.contentEl.createEl("textarea", { attr: { rows: "4", placeholder: this.options.hint, "aria-label": this.options.title } });
    new Setting(this.contentEl).addButton((button) => button.setButtonText(this.options.action).setCta().onClick(async () => {
      if (this.options.required && !input.value.trim()) return input.focus();
      await this.options.submit(input.value.trim());
      this.close();
    }));
    window.setTimeout(() => input.focus(), 0);
  }
}

const when = (at: string | undefined) => (at ? new Date(at).toLocaleString() : "");

/** Agent state for the whole plugin: watches `.bloommd`, shows the badge and notices, owns the views. */
export class AgentHub {
  readonly documents;
  proposals: AgentProposal[] = [];
  requests: AgentRequest[] = [];
  private seen: Set<string> | null = null;
  private signature = "";
  private ribbon: HTMLElement;
  private timer = 0;

  constructor(readonly plugin: Plugin, readonly reviewer: { get: () => string; set: (name: string) => Promise<void> }) {
    const app = plugin.app;
    this.documents = vaultAgentDocuments(app);
    plugin.registerView(VIEW_TYPE_AGENT, (leaf) => new AgentView(leaf, this));
    this.ribbon = plugin.addRibbonIcon("bot", "BloomMD agent", () => void this.open());
    this.ribbon.addClass("bloommd-agent-ribbon");
    plugin.addCommand({ id: "open-agent-panel", name: "Open agent panel", callback: () => void this.open() });
    plugin.addCommand({
      id: "ask-agent-current-note",
      name: "Ask agent about current note",
      callback: () => this.askActive(),
    });
    // Dot folders are not indexed, so their changes come as raw events (desktop) or by polling (iPad).
    const ref: EventRef = (app.vault as unknown as { on(name: "raw", callback: (path: string) => void): EventRef }).on("raw", (path) => {
      if (!path.startsWith(".bloommd/")) return;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.refresh(), 300);
    });
    plugin.registerEvent(ref);
    plugin.registerInterval(window.setInterval(() => void this.refresh(), POLL_MS));
    plugin.register(() => window.clearTimeout(this.timer));
    app.workspace.onLayoutReady(() => void this.refresh());
  }

  /** The ledger acts as the person using Obsidian. */
  ledger(): AgentLedger {
    return new AgentLedger(vaultAgentFiles(this.plugin.app.vault.adapter), this.reviewer.get() || "Owner", "vault");
  }

  async open(tab?: Tab) {
    const workspace = this.plugin.app.workspace;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_AGENT)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("split");
      await leaf.setViewState({ type: VIEW_TYPE_AGENT, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (tab && leaf.view instanceof AgentView) leaf.view.show(tab);
  }

  /** Leaves a question or instruction for the agent, optionally on one map node. */
  ask(path: string, nodeId?: string, nodeTitle?: string) {
    new TextModal(this.plugin.app, {
      title: `Ask agent about ${nodeTitle ?? path.replace(/\.md$/i, "")}`,
      hint: "Question or instruction, e.g. “Expand this node with the key points.”",
      action: "Send to agent",
      required: true,
      submit: async (question) => {
        await this.ledger().createRequest({ path, nodeId, nodeTitle, question });
        new Notice("BloomMD: Request saved. The agent picks it up on its next run.");
        await this.refresh(true);
      },
    }).open();
  }

  /**
   * Nodes of a map the agent wrote or a person approved since this map was last opened on this
   * device; opening it now counts as seen.
   */
  async changedNodes(path: string, markdown: string): Promise<Set<string>> {
    const app = this.plugin.app;
    const key = `bloommd-agent-seen:${path}`;
    const seen = app.loadLocalStorage(key) as string | null;
    app.saveLocalStorage(key, new Date().toISOString());
    const ids = new Set<string>();
    if (!seen) return ids;
    const ledger = this.ledger();
    const history = await ledger.history();
    for (const entry of await ledger.changes(300)) {
      if (entry.path !== path || String(entry.at) <= seen) continue;
      if (entry.event === "written") for (const id of [...(entry.created as string[] || []), ...(entry.updated as string[] || [])]) ids.add(id);
      const approved = entry.event === "approved" && history.find((item) => item.changeId === entry.changeId);
      if (approved) for (const change of outlineDiff(approved.before, markdown)) if (change.mark !== "-") ids.add(change.id);
    }
    return ids;
  }

  askActive() {
    const file = this.plugin.app.workspace.getActiveFile();
    if (file && file.extension === "md") this.ask(file.path);
    else new Notice("BloomMD: Open a Markdown note first, or use “Ask agent…” on a map node.");
  }

  /** Re-reads `.bloommd`; open panels re-render only when something changed or on `force`. */
  async refresh(force = false) {
    const before = this.signature;
    try {
      const ledger = this.ledger();
      [this.proposals, this.requests] = await Promise.all([ledger.proposals(), ledger.requests()]);
    } catch (error) {
      console.error("BloomMD: agent state could not be read", error);
      return;
    }
    const keys = new Set([...this.proposals.map((proposal) => proposal.id), ...this.requests.filter((request) => request.status !== "open").map((request) => `${request.id}:${request.status}`)]);
    if (this.seen) {
      const fresh = [...keys].filter((key) => !this.seen!.has(key));
      const proposals = fresh.filter((key) => key.startsWith("p")).length;
      if (proposals) new Notice(`BloomMD: ${proposals} new agent proposal${proposals > 1 ? "s" : ""} to review.`);
      if (fresh.length > proposals) new Notice("BloomMD: The agent answered a request.");
    }
    this.seen = keys;
    const count = this.proposals.length;
    this.ribbon.toggleClass("has-badge", count > 0);
    this.ribbon.setAttr("data-count", count ? String(count) : null);
    this.ribbon.setAttr("aria-label", count ? `BloomMD agent: ${count} proposal${count > 1 ? "s" : ""}` : "BloomMD agent");
    this.signature = JSON.stringify([...keys, this.requests.length]);
    if (!force && before === this.signature) return;
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT).forEach((leaf) => {
      if (leaf.view instanceof AgentView) void leaf.view.render();
    });
  }

  /** Runs a person's action, reports failures, then refreshes. */
  async act(task: () => Promise<unknown>, done?: string) {
    try {
      await task();
      if (done) new Notice(`BloomMD: ${done}`);
    } catch (error) {
      new Notice(`BloomMD: ${error instanceof Error ? error.message : String(error)}`, 8_000);
    }
    await this.refresh(true);
  }
}

class AgentView extends ItemView {
  private tab: Tab = "proposals";
  /** Proposals whose note changed: the current text, so the person can compare before deciding. */
  private conflicts = new Map<string, string | null>();

  constructor(leaf: WorkspaceLeaf, private readonly hub: AgentHub) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_AGENT;
  }

  getDisplayText() {
    return "BloomMD agent";
  }

  getIcon() {
    return "bot";
  }

  async onOpen() {
    this.contentEl.addClass("bloommd-agent");
    await this.hub.refresh(true);
  }

  show(tab: Tab) {
    this.tab = tab;
    void this.render();
  }

  async render() {
    const { hub } = this;
    const root = this.contentEl;
    const body = createDiv("bloommd-agent-body");
    const answered = hub.requests.filter((request) => request.status !== "open").length;
    const tabs: Array<[Tab, string]> = [
      ["proposals", `Proposals${hub.proposals.length ? ` (${hub.proposals.length})` : ""}`],
      ["requests", `Requests${answered ? ` (${answered})` : ""}`],
      ["history", "History"],
      ["rights", "Rights"],
    ];
    const bar = createDiv({ cls: "bloommd-agent-tabs", attr: { role: "tablist" } });
    for (const [id, label] of tabs) {
      bar.createEl("button", { text: label, cls: id === this.tab ? "is-active" : "", attr: { role: "tab", "aria-selected": String(id === this.tab), "data-tab": id } })
        .onclick = () => this.show(id);
    }
    try {
      if (this.tab === "proposals") this.renderProposals(body);
      else if (this.tab === "requests") this.renderRequests(body);
      else if (this.tab === "history") await this.renderHistory(body);
      else await this.renderRights(body);
    } catch (error) {
      body.createEl("p", { text: `Could not read the agent state: ${error instanceof Error ? error.message : String(error)}`, cls: "mod-warning" });
    }
    // Swapped in one step, so a re-render while reading never shows a half-built panel.
    root.replaceChildren(bar, body);
  }

  private openNote(path: string) {
    const file = this.app.vault.getFileByPath(path);
    if (file) void this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`BloomMD: ${path} does not exist (any more).`);
  }

  private card(parent: HTMLElement, title: string, meta: string, path: string) {
    const card = parent.createDiv("bloommd-agent-card");
    const head = card.createDiv("bloommd-agent-head");
    head.createEl("strong", { text: title });
    head.createSpan({ text: meta, cls: "bloommd-agent-meta" });
    if (path) card.createEl("button", { text: path, cls: "bloommd-agent-path", attr: { "aria-label": `Open ${path}` } }).onclick = () => this.openNote(path);
    return card;
  }

  private outline(parent: HTMLElement, before: string | null, after: string) {
    const changes = outlineDiff(before, after);
    const list = parent.createEl("ul", { cls: "bloommd-agent-diff" });
    for (const change of changes.slice(0, 40)) {
      list.createEl("li", { text: `${change.mark} ${change.title}`, attr: { "data-mark": change.mark, style: `padding-left:${(change.level - 1) * 12}px` } });
    }
    if (!changes.length) list.createEl("li", { text: "No heading changes (text only)." });
  }

  private renderProposals(body: HTMLElement) {
    const { hub } = this;
    if (!hub.proposals.length) body.createEl("p", { text: "No proposals. In areas where the agent may only propose, its changes wait here for you.", cls: "bloommd-agent-empty" });
    for (const proposal of [...hub.proposals].reverse()) {
      const card = this.card(body, proposal.agent, when(proposal.at), proposal.path);
      card.dataset.proposal = proposal.id;
      card.createEl("p", { text: [proposal.summary, proposal.reason, proposal.source && `Source: ${proposal.source}`].filter(Boolean).join(" · ") });
      const conflict = this.conflicts.get(proposal.id);
      if (conflict !== undefined) {
        const box = card.createDiv("bloommd-agent-conflict");
        box.createEl("p", { text: conflict === null ? "The note was deleted since the proposal." : "The note changed since the proposal. Applying replaces these edits (undo stays possible):" });
        if (conflict !== null) this.outline(box, proposal.markdown, conflict);
      }
      const diff = card.createDiv();
      void hub.documents.read(proposal.path).then(
        (current) => this.outline(diff, proposal.baseVersion === null ? null : current?.markdown ?? null, proposal.markdown),
        (error: unknown) => card.createEl("p", { text: String(error), cls: "mod-warning" }),
      );
      const details = card.createEl("details");
      details.createEl("summary", { text: "Full text" });
      details.createEl("pre", { text: proposal.markdown });
      const actions = card.createDiv("bloommd-agent-actions");
      const approve = actions.createEl("button", { text: conflict !== undefined ? "Apply anyway" : "Approve", cls: "mod-cta" });
      approve.onclick = () => void hub.act(async () => {
        try {
          await hub.ledger().applyProposal(proposal, hub.ledger().agent, hub.documents, { overwrite: conflict !== undefined });
          this.conflicts.delete(proposal.id);
        } catch (error) {
          if (!(error instanceof AgentProposalConflictError)) throw error;
          this.conflicts.set(proposal.id, error.current?.markdown ?? null);
          throw error;
        }
      }, `Applied to ${proposal.path}`);
      actions.createEl("button", { text: "Reject" }).onclick = () => new TextModal(this.app, {
        title: "Reject proposal",
        hint: "Reason for the agent (optional)",
        action: "Reject",
        required: false,
        submit: (reason) => hub.act(() => hub.ledger().rejectProposal(proposal.id, hub.ledger().agent, reason || undefined), "Proposal rejected"),
      }).open();
    }
  }

  private renderRequests(body: HTMLElement) {
    const { hub } = this;
    body.createEl("button", { text: "Ask about current note…", cls: "bloommd-agent-ask" }).onclick = () => hub.askActive();
    if (!hub.requests.length) body.createEl("p", { text: "No requests. Use “Ask agent…” in a node's menu on the map.", cls: "bloommd-agent-empty" });
    for (const request of hub.requests) {
      const card = this.card(body, request.nodeTitle ?? request.path.replace(/\.md$/i, ""), when(request.at), request.path);
      card.dataset.request = request.id;
      card.createSpan({ text: request.status === "open" ? "Waiting for agent" : request.status === "failed" ? "Agent could not answer" : `Answered by ${request.agent ?? "agent"}`, cls: `bloommd-agent-status is-${request.status}` });
      card.createEl("p", { text: request.question, cls: "bloommd-agent-question" });
      if (request.answer) card.createEl("p", { text: request.answer, cls: "bloommd-agent-answer" });
      const actions = card.createDiv("bloommd-agent-actions");
      if (request.proposalId && hub.proposals.some((proposal) => proposal.id === request.proposalId)) actions.createEl("button", { text: "Review proposal", cls: "mod-cta" }).onclick = () => this.show("proposals");
      actions.createEl("button", { text: request.status === "open" ? "Withdraw" : "Done" }).onclick = () => void hub.act(() => hub.ledger().removeRequest(request.id));
    }
  }

  private async renderHistory(body: HTMLElement) {
    const { hub } = this;
    const ledger = hub.ledger();
    const [changes, history] = await Promise.all([ledger.changes(100), ledger.history()]);
    const undoable = new Set(history.map((entry) => entry.changeId));
    if (!changes.length) body.createEl("p", { text: "The agent has not changed anything yet.", cls: "bloommd-agent-empty" });
    for (const change of changes) {
      const text = (key: string) => (typeof change[key] === "string" ? change[key] : "");
      const event = text("event");
      const who = text("reviewer") ? `${event} by ${text("reviewer")}` : `${event} · ${text("agent")}`;
      const card = this.card(body, who, when(text("at")), text("path"));
      card.createEl("p", { text: [text("summary"), text("reason"), text("source") && `Source: ${text("source")}`].filter(Boolean).join(" · ") });
      const changeId = text("changeId");
      if (undoable.has(changeId) && (event === "written" || event === "approved")) {
        card.createDiv("bloommd-agent-actions").createEl("button", { text: "Undo", cls: "mod-warning" }).onclick = async () => {
          const entry = history.find((item) => item.changeId === changeId)!;
          const action = entry.before === null ? `This moves ${entry.path} to the trash.` : `This restores ${entry.path} as it was before the change.`;
          if (!(await confirmAction(this.app, "Undo agent change?", `${action} It only works if nobody edited the note since.`, "Undo"))) return;
          await hub.act(() => ledger.undo(changeId, hub.documents, { asOwner: true, areaOf: vaultArea }), "Change undone");
        };
      }
    }
  }

  private async renderRights(body: HTMLElement) {
    const { hub } = this;
    const ledger = hub.ledger();
    const raw = await ledger.files.read("agent.json");
    const config = parseAccessConfig(raw);
    const help = body.createEl("ul", { cls: "bloommd-agent-help" });
    for (const access of AGENT_ACCESS) help.createEl("li", { text: ACCESS_HELP[access] });
    if (raw === null) body.createEl("p", { text: "No rights set yet, so the agent may only propose. For your own agent, “write” is the usual choice.", cls: "bloommd-agent-empty" });
    new Setting(body).setName("Your name").setDesc("Recorded as reviewer when you approve, reject or ask.").addText((text) => text.setPlaceholder("Owner").setValue(hub.reviewer.get()).onChange((name) => void hub.reviewer.set(name.trim())));
    const save = () => hub.act(() => ledger.setRights(config), "Agent rights saved");
    const options = Object.fromEntries(AGENT_ACCESS.map((access) => [access, access]));
    new Setting(body).setName("Default").setDesc("For notes outside the folders below.").addDropdown((dropdown) => dropdown.addOptions(options).setValue(config.access).onChange((value) => {
      config.access = value as AgentAccess;
      void save();
    }));
    const folders = this.app.vault.getRoot().children.filter((entry) => "children" in entry && !entry.name.startsWith(".")).map((entry) => entry.name);
    const areas = config.areas ?? {};
    for (const area of [...new Set([...folders, ...Object.keys(areas)])].sort()) {
      new Setting(body).setName(area).addDropdown((dropdown) => dropdown.addOptions({ "": "default", ...options }).setValue(areas[area] ?? "").onChange((value) => {
        if (value) areas[area] = value as AgentAccess;
        else delete areas[area];
        config.areas = areas;
        void save();
      }));
    }
  }
}
