import { describe, expect, test } from "bun:test";
import { migratePersistedPathState } from "./path-migration";

describe("migratePersistedPathState", () => {
  test("moves a single note layout and its local collaboration binding", () => {
    const result = migratePersistedPathState({
      layouts: { "file:Inbox/Sync check.md": { positions: { root: { x: 1, y: 2 } } } },
      bindings: [{ localPath: "Inbox/Sync check.md", binding: { documentId: "doc-1" } }],
    }, { oldPath: "Inbox/Sync check.md", newPath: "Projects/Sync check.md", isFolder: false });

    expect(result.layouts).toEqual({ "file:Projects/Sync check.md": { positions: { root: { x: 1, y: 2 } } } });
    expect(result.bindings).toEqual([{ localPath: "Projects/Sync check.md", binding: { documentId: "doc-1" } }]);
    expect(result.movedLocalPaths).toEqual([{ oldPath: "Inbox/Sync check.md", newPath: "Projects/Sync check.md" }]);
  });

  test("moves all file and folder references below a renamed folder", () => {
    const result = migratePersistedPathState({
      layouts: {
        "folder:Research": { collapsed: [] },
        "folder:Research/Notes": { collapsed: ["topic"] },
        "file:Research/Notes/Plan.md": { positions: {} },
        "file:Elsewhere.md": { positions: {} },
      },
      bindings: [
        { localPath: "Research/Notes/Plan.md", binding: { documentId: "doc-1" } },
        { localPath: "Elsewhere.md", binding: { documentId: "doc-2" } },
      ],
    }, { oldPath: "Research", newPath: "Archive/Research", isFolder: true });

    expect(Object.keys(result.layouts).sort()).toEqual([
      "file:Archive/Research/Notes/Plan.md",
      "file:Elsewhere.md",
      "folder:Archive/Research",
      "folder:Archive/Research/Notes",
    ]);
    expect(result.bindings.map((entry) => entry.localPath)).toEqual(["Archive/Research/Notes/Plan.md", "Elsewhere.md"]);
  });

  test("does not overwrite an already existing target binding", () => {
    const result = migratePersistedPathState({
      layouts: { "file:Old.md": { positions: {} }, "file:New.md": { positions: { root: { x: 1, y: 1 } } } },
      bindings: [
        { localPath: "Old.md", binding: { documentId: "old" } },
        { localPath: "New.md", binding: { documentId: "new" } },
      ],
    }, { oldPath: "Old.md", newPath: "New.md", isFolder: false });

    expect(result.layouts).toEqual({ "file:New.md": { positions: { root: { x: 1, y: 1 } } } });
    expect(result.bindings).toEqual([{ localPath: "New.md", binding: { documentId: "new" } }]);
  });
});
