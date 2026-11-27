import { describe, expect, test } from "bun:test";
import {
  ROOT_PATH,
  ancestorFolders,
  findFile,
  findFolder,
  parentPath,
  remapPath,
  scrollToReveal,
  shortenMiddle,
  visibleRows,
  visibleWindow,
} from "./navigator-model";
import { LONG_NAME, root } from "./navigator-fixture";

describe("buildFolderNode", () => {
  test("keeps folders and Markdown files only, sorted naturally, and skips dot folders", () => {
    expect(root.name).toBe("My vault");
    expect(root.path).toBe(ROOT_PATH);
    expect(root.folders.map((entry) => entry.name)).toEqual(["Archive", "Projects"]);
    expect(root.files.map((entry) => entry.name)).toEqual(["Home.md"]);
    expect(findFolder(root, "Projects/Alpha")?.files.map((entry) => entry.name)).toEqual(["Notes.md", "Plan 2.md", "Plan 10.md"]);
  });
});

describe("paths", () => {
  test("parentPath and ancestorFolders", () => {
    expect(parentPath("Home.md")).toBe(ROOT_PATH);
    expect(parentPath("Projects/Alpha/Notes.md")).toBe("Projects/Alpha");
    expect(ancestorFolders("Home.md")).toEqual([ROOT_PATH]);
    expect(ancestorFolders("Projects/Alpha/Deep/x.md")).toEqual([ROOT_PATH, "Projects", "Projects/Alpha", "Projects/Alpha/Deep"]);
  });

  test("findFolder and findFile resolve nested paths and miss unknown ones", () => {
    expect(findFolder(root, ROOT_PATH)).toBe(root);
    expect(findFolder(root, "Projects/Alpha/Deep")?.files).toHaveLength(1);
    expect(findFolder(root, "Projects/Gamma")).toBeNull();
    expect(findFile(root, `Projects/Alpha/Deep/${LONG_NAME}`)?.name).toBe(LONG_NAME);
    expect(findFile(root, "Projects/Alpha/Missing.md")).toBeNull();
  });

  test("files with the same name in different folders stay distinct", () => {
    const alpha = findFile(root, "Projects/Alpha/Notes.md");
    const beta = findFile(root, "Projects/Beta/Notes.md");
    expect(alpha?.name).toBe(beta?.name ?? "");
    expect(alpha?.path).not.toBe(beta?.path ?? "");
  });

  test("remapPath moves a path below a renamed folder, and only that", () => {
    expect(remapPath("Projects/Alpha/Notes.md", "Projects", "Work")).toBe("Work/Alpha/Notes.md");
    expect(remapPath("Projects", "Projects", "Work")).toBe("Work");
    expect(remapPath("Projects2/Notes.md", "Projects", "Work")).toBe("Projects2/Notes.md");
  });
});

describe("visibleRows", () => {
  test("shows the root and its folders while everything else is closed", () => {
    const rows = visibleRows(root, new Set());
    expect(rows.map((row) => [row.name, row.depth])).toEqual([["My vault", 0], ["Archive", 1], ["Projects", 1]]);
    expect(rows[1]?.hasChildren).toBe(false);
    expect(rows[2]).toMatchObject({ hasChildren: true, expanded: false });
  });

  test("shows nested folders under open ones with their depth", () => {
    const rows = visibleRows(root, new Set(["Projects", "Projects/Alpha"]));
    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.name}`)).toEqual(["My vault", "  Archive", "  Projects", "    Alpha", "      Deep", "    Beta"]);
  });

  test("an open folder below a closed one stays hidden", () => {
    expect(visibleRows(root, new Set(["Projects/Alpha"])).map((row) => row.path)).toEqual([ROOT_PATH, "Archive", "Projects"]);
  });
});

describe("shortenMiddle", () => {
  test("keeps start and extension of a long file name within the limit", () => {
    const shortened = shortenMiddle(LONG_NAME, 24);
    expect(shortened).toHaveLength(24);
    expect(shortened.startsWith("A very long")).toBe(true);
    expect(shortened.endsWith("tion.md")).toBe(true);
    expect(shortened).toContain("…");
  });

  test("leaves short names alone", () => {
    expect(shortenMiddle("Home.md", 24)).toBe("Home.md");
    expect(shortenMiddle("abc", 3)).toBe("abc");
  });
});

describe("virtual window", () => {
  test("renders the visible rows plus overscan", () => {
    expect(visibleWindow(1000, 0, 260, 26, 4)).toEqual({ start: 0, end: 14 });
    expect(visibleWindow(1000, 2600, 260, 26, 4)).toEqual({ start: 96, end: 114 });
  });

  test("clamps to the list and handles empty lists", () => {
    expect(visibleWindow(10, 200, 260, 26, 6)).toEqual({ start: 1, end: 10 });
    expect(visibleWindow(0, 0, 260, 26)).toEqual({ start: 0, end: 0 });
  });

  test("scrollToReveal changes the scroll position only when the row is outside the viewport", () => {
    expect(scrollToReveal(3, 0, 260, 26)).toBe(0);
    expect(scrollToReveal(40, 0, 260, 26)).toBe(40 * 26 + 26 - 260);
    expect(scrollToReveal(2, 520, 260, 26)).toBe(52);
  });
});
