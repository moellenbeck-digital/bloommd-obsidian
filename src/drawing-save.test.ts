import { describe, expect, test } from "bun:test";
import { conflictFileName, linkDrawingIntoNode, saveDrawing, type DrawingStore } from "./drawing-save";

function fakeStore(options: { link?: DrawingStore["link"]; replace?: DrawingStore["replace"] } = {}) {
  const files = new Map<string, string>();
  const notices: string[] = [];
  const store: DrawingStore = {
    replace: options.replace ?? (async (path, svg, expected) => {
      if (files.get(path) !== expected) throw new Error("changed");
      files.set(path, svg);
    }),
    create: async (fileName, svg) => {
      let path = fileName;
      for (let index = 1; files.has(path); index += 1) path = fileName.replace(/\.svg$/, ` ${index}.svg`);
      files.set(path, svg);
      return path;
    },
    link: options.link ?? (async () => true),
    notify: (message) => notices.push(message),
  };
  return { store, files, notices };
}

const request = (path: string | null, svg: string, expectedSvg: string | null = null) => ({ path, svg, expectedSvg, noteBasename: "Physik" });

describe("saveDrawing", () => {
  test("reports the new file even when linking it into a deleted node throws", async () => {
    const { store, files, notices } = fakeStore({ link: async () => { throw new Error("The node no longer exists."); } });
    const first = await saveDrawing(store, request(null, "<svg>1</svg>"));
    expect(first).toBe("Physik ink.svg");
    expect(notices).toHaveLength(1);
    // The next autosave targets the same file instead of creating "Physik ink 1.svg".
    expect(await saveDrawing(store, request(first, "<svg>2</svg>", "<svg>1</svg>"))).toBe("Physik ink.svg");
    expect([...files.keys()]).toEqual(["Physik ink.svg"]);
    expect(files.get("Physik ink.svg")).toBe("<svg>2</svg>");
  });

  test("keeps the path of an existing drawing when its links cannot be added", async () => {
    const { store, files, notices } = fakeStore({ link: async () => false });
    files.set("a.svg", "old");
    expect(await saveDrawing(store, request("a.svg", "new", "old"))).toBe("a.svg");
    expect(notices).toEqual(["The drawing was saved, but its note links could not be added to the node."]);
  });

  test("a changed file fails silently so the editor can save a conflict copy that reports once", async () => {
    const { store, files, notices } = fakeStore();
    files.set("Physik/Arbeit ink.svg", "theirs");
    expect(await saveDrawing(store, request("Physik/Arbeit ink.svg", "mine", "base"))).toBeNull();
    expect(notices).toHaveLength(0);
    const copy = await saveDrawing(store, { ...request(null, "mine"), conflictOf: "Physik/Arbeit ink.svg" });
    expect(copy).toBe("Arbeit ink (conflict).svg");
    expect(files.get("Physik/Arbeit ink.svg")).toBe("theirs");
    expect(files.get(copy!)).toBe("mine");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Arbeit ink (conflict).svg");
  });
});

describe("conflictFileName", () => {
  test("names the copy after the drawing it replaces", () => {
    expect(conflictFileName("a/b/Note ink 2.svg")).toBe("Note ink 2 (conflict).svg");
  });
});

describe("linkDrawingIntoNode", () => {
  const markdown = "# Root <!-- bloommd:id=root -->\n\nText\n";

  test("reports a missing node instead of throwing", () => {
    expect(linkDrawingIntoNode(markdown, "gone", ["Arbeit"], (content) => content)).toEqual({ markdown, found: false });
  });

  test("adds the embed and note links to the node", () => {
    const linked = linkDrawingIntoNode(markdown, "root", ["Arbeit"], (content) => `${content.trim()}\n\n![[x.svg]]`);
    expect(linked.found).toBe(true);
    expect(linked.markdown).toContain("![[x.svg]]");
    expect(linked.markdown).toContain("[[Arbeit]]");
  });
});
