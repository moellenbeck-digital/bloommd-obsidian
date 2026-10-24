import { describe, expect, test } from "bun:test";
import type { App, DataAdapter } from "obsidian";
import { AgentLedger, AgentProposalConflictError, knowledgeVersion, vaultArea } from "./agent-ledger";
import { vaultAgentDocuments, vaultAgentFiles } from "./agent-vault";

/**
 * A vault as Obsidian's adapter and Vault API see it. Like the iPad adapter, `mkdir` and `write`
 * fail when the parent folder is missing, so the adapters must create `.bloommd/…` step by step.
 */
function fakeVault() {
  const files = new Map<string, string>();
  const folders = new Set<string>([""]);
  const trashed: string[] = [];
  const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const needParent = (path: string) => {
    if (!folders.has(parent(path))) throw new Error(`ENOENT: ${parent(path)}`);
  };
  const adapter = {
    exists: async (path: string) => files.has(path) || folders.has(path),
    read: async (path: string) => files.get(path)!,
    write: async (path: string, text: string) => {
      needParent(path);
      files.set(path, text);
    },
    append: async (path: string, text: string) => void files.set(path, (files.get(path) ?? "") + text),
    remove: async (path: string) => void files.delete(path),
    mkdir: async (path: string) => {
      needParent(path);
      folders.add(path);
    },
    list: async (path: string) => ({ files: [...files.keys()].filter((name) => parent(name) === path), folders: [] }),
  } as unknown as DataAdapter;
  const file = (path: string) => ({ path, extension: "md" });
  const app = {
    vault: {
      adapter,
      getAbstractFileByPath: (path: string) => (files.has(path) ? file(path) : folders.has(path) ? { path, children: [] } : null),
      read: async (entry: { path: string }) => files.get(entry.path)!,
      process: async (entry: { path: string }, change: (text: string) => string) => {
        const next = change(files.get(entry.path)!);
        files.set(entry.path, next);
        return next;
      },
      create: async (path: string, text: string) => {
        needParent(path);
        files.set(path, text);
        return file(path);
      },
      createFolder: async (path: string) => {
        needParent(path);
        folders.add(path);
      },
    },
    fileManager: { trashFile: async (entry: { path: string }) => void (trashed.push(entry.path), files.delete(entry.path)) },
  } as unknown as App;
  return { app, files, folders, trashed };
}

const MAP = "# Physik <!-- bloommd:id=root -->\n";
const NEXT = "# Physik <!-- bloommd:id=root -->\n\n## Optik <!-- bloommd:id=o -->\n";

describe("agent state in the vault", () => {
  test("proposals from the agent are approved through the Vault API with history and log", async () => {
    const vault = fakeVault();
    vault.folders.add("Schule");
    vault.files.set("Schule/Physik.md", MAP);
    const files = vaultAgentFiles(vault.app.vault.adapter);
    await new AgentLedger(files, "OpenClaw", "vault").propose({ tool: "bloommd_update_map", path: "Schule/Physik.md", area: "Schule", baseVersion: knowledgeVersion(MAP), markdown: NEXT, summary: "1 created" });
    expect([...vault.files.keys()].some((name) => name.startsWith(".bloommd/proposals/p"))).toBe(true);
    const owner = new AgentLedger(files, "Max", "vault");
    const documents = vaultAgentDocuments(vault.app);
    const [proposal] = await owner.proposals();
    const { changeId } = await owner.applyProposal(proposal!, "Max", documents);
    expect(vault.files.get("Schule/Physik.md")).toBe(NEXT);
    expect(await owner.proposals()).toEqual([]);
    expect((await owner.history())[0]).toEqual(expect.objectContaining({ changeId, origin: "approved", before: MAP }));
    await owner.undo(changeId, documents, { asOwner: true, areaOf: vaultArea });
    expect(vault.files.get("Schule/Physik.md")).toBe(MAP);
    expect((await owner.changes()).map((entry) => entry.event)).toEqual(["undone", "approved", "proposed"]);
  });

  test("an edit between reading and writing is a conflict, never overwritten", async () => {
    const vault = fakeVault();
    vault.files.set("Top.md", MAP);
    const owner = new AgentLedger(vaultAgentFiles(vault.app.vault.adapter), "Max", "vault");
    const id = await owner.propose({ tool: "t", path: "Top.md", area: "", baseVersion: knowledgeVersion(MAP), markdown: NEXT, summary: "x" });
    vault.files.set("Top.md", `${MAP}typed\n`);
    const proposal = await owner.proposal(id);
    await expect(owner.applyProposal(proposal, "Max", vaultAgentDocuments(vault.app))).rejects.toBeInstanceOf(AgentProposalConflictError);
    expect(vault.files.get("Top.md")).toBe(`${MAP}typed\n`);
    // A keystroke landing inside the atomic edit is caught there too.
    const documents = vaultAgentDocuments(vault.app);
    await expect(documents.write("Top.md", NEXT, knowledgeVersion(MAP))).rejects.toThrow(/changed since it was read/);
  });

  test("new notes get their folders; undoing a created note moves it to the trash", async () => {
    const vault = fakeVault();
    const owner = new AgentLedger(vaultAgentFiles(vault.app.vault.adapter), "Max", "vault");
    const documents = vaultAgentDocuments(vault.app);
    const id = await owner.propose({ tool: "bloommd_create_map", path: "Arbeit/Q4/Budget.md", area: "Arbeit", baseVersion: null, markdown: "# Budget\n", summary: "new" });
    const { changeId } = await owner.applyProposal(await owner.proposal(id), "Max", documents);
    expect(vault.files.get("Arbeit/Q4/Budget.md")).toBe("# Budget\n");
    await owner.undo(changeId, documents, { asOwner: true, areaOf: vaultArea });
    expect(vault.trashed).toEqual(["Arbeit/Q4/Budget.md"]);
  });

  test("paths outside the vault or in hidden folders are refused", async () => {
    const documents = vaultAgentDocuments(fakeVault().app);
    for (const path of ["../outside.md", ".obsidian/workspace.md", ".bloommd/agent.md", "x/../../y.md"]) {
      await expect(documents.read(path)).rejects.toThrow(/not a note inside the vault/);
    }
  });

  test("rights and requests persist in .bloommd", async () => {
    const vault = fakeVault();
    const owner = new AgentLedger(vaultAgentFiles(vault.app.vault.adapter), "Max", "vault");
    expect(await owner.rights()).toEqual({ access: "propose", areas: {} });
    await owner.setRights({ access: "write", areas: { Arbeit: "propose" } });
    expect(JSON.parse(vault.files.get(".bloommd/agent.json")!)).toEqual({ access: "write", areas: { Arbeit: "propose" } });
    const request = await owner.createRequest({ path: "Schule/Physik.md", nodeId: "root", nodeTitle: "Physik", question: "Was fehlt?" });
    expect(JSON.parse(vault.files.get(`.bloommd/requests/${request.id}.json`)!)).toEqual(expect.objectContaining({ status: "open", by: "Max" }));
  });
});
