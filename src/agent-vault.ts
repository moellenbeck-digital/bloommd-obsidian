/**
 * The agent ledger on top of an Obsidian vault. Agent state lives in `.bloommd/`, which Obsidian
 * does not index (dot folder), so it goes through the vault adapter; that works on desktop and on
 * iPad. Notes go through the Vault API, so open editors and the map see every change.
 */
import { TFile, type App, type DataAdapter } from "obsidian";
import { isVaultNotePath, knowledgeVersion, type AgentDocuments, type AgentStateFiles } from "./agent-ledger";

export const AGENT_STATE_DIR = ".bloommd";

/** Creates `path` and its missing parents one by one (mobile adapters do not create parents). */
async function ensureFolder(exists: (path: string) => Promise<boolean>, create: (path: string) => Promise<unknown>, path: string): Promise<void> {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!(await exists(current))) await create(current);
  }
}

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

export function vaultAgentFiles(adapter: DataAdapter): AgentStateFiles {
  const full = (name: string) => `${AGENT_STATE_DIR}/${name}`;
  const exists = (path: string) => adapter.exists(path);
  const prepare = (name: string) => ensureFolder(exists, (path) => adapter.mkdir(path), parentOf(full(name)));
  return {
    read: async (name) => ((await exists(full(name))) ? adapter.read(full(name)) : null),
    async write(name, text) {
      await prepare(name);
      await adapter.write(full(name), text);
    },
    async append(name, text) {
      await prepare(name);
      await ((await exists(full(name))) ? adapter.append(full(name), text) : adapter.write(full(name), text));
    },
    async remove(name) {
      if (await exists(full(name))) await adapter.remove(full(name));
    },
    list: async (dir) => ((await exists(full(dir))) ? (await adapter.list(full(dir))).files.map((path) => path.slice(path.lastIndexOf("/") + 1)) : []),
  };
}

export class AgentNoteConflictError extends Error {
  constructor(path: string) {
    super(`${path} changed since it was read. Read it again and repeat the change.`);
  }
}

export function vaultAgentDocuments(app: App): AgentDocuments {
  const file = (path: string): TFile | null => {
    if (!isVaultNotePath(path)) throw new Error(`"${path}" is not a note inside the vault.`);
    const entry = app.vault.getAbstractFileByPath(path);
    return entry instanceof TFile ? entry : null;
  };
  return {
    async read(path) {
      const note = file(path);
      if (!note) return null;
      const markdown = await app.vault.read(note);
      return { path, markdown, version: knowledgeVersion(markdown) };
    },
    async write(path, markdown, expectedVersion) {
      const note = file(path);
      if (!note) {
        if (expectedVersion !== null) throw new AgentNoteConflictError(path);
        await ensureFolder(async (folder) => app.vault.getAbstractFileByPath(folder) !== null, (folder) => app.vault.createFolder(folder), parentOf(path));
        await app.vault.create(path, markdown);
      } else {
        if (expectedVersion === null) throw new AgentNoteConflictError(path);
        // Checked inside the atomic edit: a keystroke between read and write is never overwritten.
        await app.vault.process(note, (latest) => {
          if (knowledgeVersion(latest) !== expectedVersion) throw new AgentNoteConflictError(path);
          return markdown;
        });
      }
      return { version: knowledgeVersion(markdown) };
    },
    async remove(path) {
      const note = file(path);
      // Respects the user's deletion setting (system trash, .trash or permanent).
      if (note) await app.fileManager.trashFile(note);
    },
  };
}
