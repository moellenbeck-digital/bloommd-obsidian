import { describe, expect, test } from "bun:test";
import { DEFAULT_LEARNING_SETTINGS, learningFilePath, parseLearningFile, rateEntry, serializeLearningFile, type LearningFile } from "./learning";
import { LearningStore, type LearningAdapter } from "./learning-store";

/** An in-memory vault adapter; `files` can be changed "by another device". */
function fakeAdapter() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const writes: string[] = [];
  const adapter: LearningAdapter = {
    exists: async (path) => files.has(path) || folders.has(path),
    read: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    write: async (path, data) => {
      if (!folders.has(path.slice(0, path.lastIndexOf("/")))) throw new Error("folder missing");
      writes.push(path);
      files.set(path, data);
    },
    mkdir: async (path) => { folders.add(path); },
    remove: async (path) => { files.delete(path); },
  };
  return { adapter, files, folders, writes };
}

const rate = (id: string, level: number, time: string) => (file: LearningFile): LearningFile =>
  ({ ...file, entries: { ...file.entries, [id]: rateEntry(file.entries[id], level, DEFAULT_LEARNING_SETTINGS, new Date(time)) } });
const stored = (files: Map<string, string>, key: string) => parseLearningFile(files.get(learningFilePath(key)));

describe("learning store", () => {
  test("creates the hidden folder and writes the progress file outside the note", async () => {
    const { adapter, files, folders } = fakeAdapter();
    const store = new LearningStore(adapter);
    expect(await store.load("id-map1")).toEqual({ format: 1, entries: {} });
    await store.update("id-map1", rate("n1", 2, "2026-10-10T08:00:00Z"));
    expect([...folders]).toEqual([".bloommd", ".bloommd/learning"]);
    expect(stored(files, "id-map1").entries.n1?.level).toBe(2);
  });

  test("a rating merges into what another device wrote meanwhile instead of overwriting it", async () => {
    const { adapter, files } = fakeAdapter();
    const store = new LearningStore(adapter);
    await store.update("id-map1", rate("n1", 1, "2026-10-10T08:00:00Z"));
    // The iPad rated n2 (and n1 later); the file arrives through sync.
    const ipad = [rate("n1", 2, "2026-10-10T09:00:00Z"), rate("n2", 0, "2026-10-10T09:00:00Z")].reduce((file, change) => change(file), stored(files, "id-map1"));
    files.set(learningFilePath("id-map1"), serializeLearningFile(ipad));
    await store.update("id-map1", rate("n3", 1, "2026-10-10T08:30:00Z"));
    const merged = stored(files, "id-map1");
    expect(merged.entries.n1?.level).toBe(2);
    expect(merged.entries.n2?.level).toBe(0);
    expect(merged.entries.n3?.level).toBe(1);
  });

  test("reloading after a stale copy replaced the file writes back the newer ratings it lost", async () => {
    const { adapter, files, writes } = fakeAdapter();
    const store = new LearningStore(adapter);
    await store.update("id-map1", rate("n1", 2, "2026-10-10T08:00:00Z"));
    files.set(learningFilePath("id-map1"), serializeLearningFile({ format: 1, entries: {} }));
    const loaded = await store.load("id-map1");
    expect(loaded.entries.n1?.level).toBe(2);
    expect(stored(files, "id-map1").entries.n1?.level).toBe(2);
    const count = writes.length;
    await store.load("id-map1");
    expect(writes.length).toBe(count);
  });

  test("a reset from another device wins over older ratings still in memory", async () => {
    const { adapter, files } = fakeAdapter();
    const store = new LearningStore(adapter);
    await store.update("id-map1", rate("n1", 2, "2026-10-10T08:00:00Z"));
    files.set(learningFilePath("id-map1"), serializeLearningFile({ format: 1, resetAt: "2026-10-10T10:00:00Z", entries: {} }));
    expect((await store.load("id-map1")).entries).toEqual({});
  });

  test("moves progress to a new key after a rename and merges with an existing file", async () => {
    const { adapter, files } = fakeAdapter();
    const store = new LearningStore(adapter);
    await store.update("path-old", rate("n1", 2, "2026-10-10T08:00:00Z"));
    await store.update("path-new", rate("n2", 1, "2026-10-10T08:00:00Z"));
    expect(await store.move("path-old", "path-new", "Bio/Neu.md")).toBe(true);
    expect(files.has(learningFilePath("path-old"))).toBe(false);
    const moved = stored(files, "path-new");
    expect(Object.keys(moved.entries).sort()).toEqual(["n1", "n2"]);
    expect(moved.path).toBe("Bio/Neu.md");
    expect(await store.move("path-missing", "path-new", "x.md")).toBe(false);
  });
});
