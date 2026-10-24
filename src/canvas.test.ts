import { describe, expect, test } from "bun:test";
import { autoLayout, claimPendingAction, contentPreview, externalLinks, externalResourceKind, mapInkStep, orderedHeadingIds, visibleHeadingIds, wikiLinks } from "./canvas";
import type { CanvasHeading } from "./canvas";

const heading = (id: string, parentId: string | null, children: string[], level = 1): CanvasHeading => ({
  id,
  parentId,
  level,
  title: id,
  content: "",
  children,
  kind: "heading",
});

describe("externalLinks", () => {
  test("prefers the Markdown label over the bare host", () => {
    const [link] = externalLinks("See [CommonMark spec](https://spec.commonmark.org/0.31.2/).");
    expect(link?.url).toBe("https://spec.commonmark.org/0.31.2/");
    expect(link?.label).toBe("CommonMark spec");
    expect(link?.host).toBe("spec.commonmark.org");
  });

  test("keeps balanced parentheses inside a Markdown link target", () => {
    // Research notes are full of Wikipedia URLs; truncating at the first ")" produces a dead link.
    const [link] = externalLinks("[Turing](https://en.wikipedia.org/wiki/Turing_(machine))");
    expect(link?.url).toBe("https://en.wikipedia.org/wiki/Turing_(machine)");
  });

  test("detects a bare URL and labels it with its host", () => {
    const [link] = externalLinks("Reference: https://example.com/a/b");
    expect(link?.url).toBe("https://example.com/a/b");
    expect(link?.label).toBe("example.com");
  });

  test("strips trailing sentence punctuation from a bare URL", () => {
    expect(externalLinks("See https://example.com/page.")[0]?.url).toBe("https://example.com/page");
  });

  test("does not list the same target twice", () => {
    const links = externalLinks("[A](https://example.com) and again https://example.com");
    expect(links).toHaveLength(1);
    expect(links[0]?.label).toBe("A");
  });

  test("ignores non-http schemes", () => {
    expect(externalLinks("mailto:someone@example.com and ftp://example.com/file")).toEqual([]);
  });
});

describe("externalResourceKind", () => {
  test("classifies media and document URLs for local previews", () => {
    expect(externalResourceKind("https://example.com/cover.png")).toBe("image");
    expect(externalResourceKind("https://example.com/talk.mp4")).toBe("video");
    expect(externalResourceKind("https://example.com/theme.mp3")).toBe("audio");
    expect(externalResourceKind("https://example.com/spec.pdf")).toBe("pdf");
  });

  test("treats ordinary links as websites", () => {
    expect(externalResourceKind("https://example.com/docs")).toBe("website");
  });
});

describe("wikiLinks", () => {
  test("reads a plain wiki link", () => {
    expect(wikiLinks("See [[Architecture]].")).toEqual([{ target: "Architecture", label: "Architecture" }]);
  });

  test("uses the alias as the label", () => {
    expect(wikiLinks("See [[Architecture|the design]].")).toEqual([{ target: "Architecture", label: "the design" }]);
  });

  test("keeps a heading anchor on the target so Obsidian can resolve it", () => {
    expect(wikiLinks("[[Notes#Section]]")[0]?.target).toBe("Notes#Section");
  });

  test("deduplicates repeated targets", () => {
    expect(wikiLinks("[[A]] and [[A|again]]")).toHaveLength(1);
  });

  test("reads adjacent links and skips embeds", () => {
    expect(wikiLinks("[[a]][[b]]").map((link) => link.target)).toEqual(["a", "b"]);
    expect(wikiLinks("![[x ink.svg]][[c]] ![[d]]").map((link) => link.target)).toEqual(["c"]);
  });
});

describe("contentPreview", () => {
  test("collapses a fenced code block instead of dumping the code", () => {
    expect(contentPreview("Before\n\n```ts\nconst x = 1;\n```\n\nAfter")).toBe("Before Code block After");
  });

  test("shows the link text rather than the URL", () => {
    expect(contentPreview("See [the spec](https://example.com/very/long/path).")).toBe("See the spec.");
  });

  test("shows the alias of a wiki link", () => {
    expect(contentPreview("See [[Architecture|the design]].")).toBe("See the design.");
  });

  test("collapses whitespace so a preview stays on one line", () => {
    expect(contentPreview("Line one\n\n\nLine two")).toBe("Line one Line two");
  });
});

describe("visibleHeadingIds", () => {
  const tree = [
    heading("root", null, ["a", "b"]),
    heading("a", "root", ["a1"], 2),
    heading("a1", "a", [], 3),
    heading("b", "root", [], 2),
  ];

  test("shows the whole tree when nothing is collapsed", () => {
    expect([...visibleHeadingIds(tree, new Set(), "root")].sort()).toEqual(["a", "a1", "b", "root"]);
  });

  test("hides the children of a collapsed branch but keeps the branch itself", () => {
    const visible = visibleHeadingIds(tree, new Set(["a"]), "root");
    expect(visible.has("a")).toBe(true);
    expect(visible.has("a1")).toBe(false);
    expect(visible.has("b")).toBe(true);
  });

  test("includes additional top-level branches that are not under the root", () => {
    const multi = [...tree, heading("second-root", null, [])];
    expect(visibleHeadingIds(multi, new Set(), "root").has("second-root")).toBe(true);
  });

  test("survives a cyclic parent reference without looping forever", () => {
    const cyclic = [heading("x", null, ["y"]), heading("y", "x", ["x"], 2)];
    expect([...visibleHeadingIds(cyclic, new Set(), "x")].sort()).toEqual(["x", "y"]);
  });

  test("still shows the tree when the root id is stale", () => {
    // Degrading to the parentless branches beats rendering an empty canvas after an edit.
    expect(visibleHeadingIds(tree, new Set(), "missing").size).toBe(4);
  });
});

describe("orderedHeadingIds", () => {
  test("follows the document hierarchy for outline and presentation", () => {
    const tree = [
      heading("root", null, ["a", "b"]),
      heading("a", "root", ["a1"], 2),
      heading("a1", "a", [], 3),
      heading("b", "root", [], 2),
    ];
    expect(orderedHeadingIds(tree, "root")).toEqual(["root", "a", "a1", "b"]);
  });
});

describe("keyboard mutation guards", () => {
  test("allows one pending child action per source node", () => {
    const pending = new Set<string>();

    expect(claimPendingAction(pending, "root")).toBe(true);
    expect(claimPendingAction(pending, "root")).toBe(false);

    pending.delete("root");
    expect(claimPendingAction(pending, "root")).toBe(true);
  });
});

describe("embedded drawings", () => {
  test("image embeds are not counted as wikilinks", () => {
    expect(wikiLinks("![[Thermo ink.svg]] see [[Arbeit]]").map((link) => link.target)).toEqual(["Arbeit"]);
    expect(wikiLinks("[[Arbeit]] at the start").map((link) => link.target)).toEqual(["Arbeit"]);
  });

  test("node previews hide embed syntax", () => {
    expect(contentPreview("Formel\n\n![[Thermo ink.svg]]\n\n[[Arbeit]]")).toBe("Formel Arbeit");
  });
});

describe("autoLayout", () => {
  test("lays out children to the right of their parent without overlaps", () => {
    const headings = [heading("root", null, ["a", "b"]), heading("a", "root", [], 2), heading("b", "root", [], 2)];
    const positions = autoLayout(headings, new Set(["root", "a", "b"]));
    expect(positions.a!.x).toBeGreaterThan(positions.root!.x);
    expect(positions.b!.x).toBe(positions.a!.x);
    expect(Math.abs(positions.a!.y - positions.b!.y)).toBeGreaterThanOrEqual(92);
  });
});

describe("autoLayout with resized nodes", () => {
  test("keeps resized siblings from overlapping", () => {
    const headings = [heading("root", null, ["a", "b"]), heading("a", "root", [], 2), heading("b", "root", [], 2)];
    const positions = autoLayout(headings, new Set(["root", "a", "b"]), { a: { width: 400, height: 300 } });
    const [top, bottom] = [positions.a!, positions.b!].sort((left, right) => left.y - right.y);
    const topHeight = top === positions.a ? 300 : 92;
    expect(bottom!.y - top!.y).toBeGreaterThanOrEqual(topHeight);
  });
});

describe("tree layout", () => {
  const tree = [
    heading("root", null, ["a", "b", "c"]),
    heading("a", "root", ["a1", "a2"], 2),
    heading("a1", "a", [], 3),
    heading("a2", "a", [], 3),
    heading("b", "root", [], 2),
    heading("c", "root", [], 2),
  ];
  const all = new Set(tree.map((entry) => entry.id));
  const box = (positions: Record<string, { x: number; y: number }>, id: string, sizes: Record<string, { width: number; height: number }> = {}) => ({
    ...positions[id]!,
    width: sizes[id]?.width ?? 236,
    height: sizes[id]?.height ?? 92,
  });
  const overlap = (left: ReturnType<typeof box>, right: ReturnType<typeof box>) =>
    left.x < right.x + right.width && right.x < left.x + left.width && left.y < right.y + right.height && right.y < left.y + left.height;

  test("places levels in columns and centres parents on their children", () => {
    const positions = autoLayout(tree, all);
    expect(positions.a!.x).toBe(positions.b!.x);
    expect(positions.a1!.x).toBeGreaterThan(positions.a!.x + 236);
    const childCentre = (positions.a1!.y + positions.a2!.y) / 2;
    expect(positions.a!.y).toBeCloseTo(childCentre);
  });

  test("never overlaps nodes, also with resized ones", () => {
    const sizes = { a1: { width: 420, height: 300 }, b: { width: 300, height: 180 } };
    const positions = autoLayout(tree, all, sizes);
    const ids = [...all];
    for (const left of ids) for (const right of ids) {
      if (left < right) expect(overlap(box(positions, left, sizes), box(positions, right, sizes))).toBe(false);
    }
    expect(positions.a1!.x).toBe(positions.a2!.x);
  });

  test("lays out only visible nodes and several top-level headings", () => {
    const positions = autoLayout([...tree, heading("second", null, [])], new Set(["root", "a", "b", "c", "second"]));
    expect(positions.a1).toBeUndefined();
    expect(positions.second!.y).toBeGreaterThan(positions.c!.y);
  });
});

describe("TaskFacts", () => {
  const render = async (metadata: CanvasHeading["metadata"]) => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { TaskFacts } = await import("./canvas");
    return renderToStaticMarkup(createElement(TaskFacts, { metadata, today: "2026-10-05" }));
  };

  test("shows due date, responsible person and marks overdue open tasks", async () => {
    const html = await render({ kind: "task", status: "open", due: "2026-10-03", assignee: "Max" });
    expect(html).toContain("is-overdue");
    expect(html).toContain("Max");
    expect(html).toContain("Overdue since 2026-10-03");
  });

  test("a done task is never overdue; a decision shows its state", async () => {
    expect(await render({ kind: "task", status: "done", due: "2026-10-03" })).not.toContain("is-overdue");
    expect(await render({ kind: "decision", decision: "accepted", assignee: "Lea" })).toContain("is-accepted");
  });

  test("renders nothing for plain topics", async () => {
    expect(await render({ kind: "topic" })).toBe("");
    expect(await render(undefined)).toBe("");
  });
});

describe("mapInkStep", () => {
  test("opens the linked drawing of the note on screen", () => {
    expect(mapInkStep("A.md", "A map ink.svg", null)).toBe("open");
    expect(mapInkStep("B.md", "B map ink.svg", { path: "A map ink.svg", note: "A.md" })).toBe("open");
    expect(mapInkStep("A.md", "A map ink.svg", { path: "A map ink.svg", note: "A.md" })).toBeNull();
  });

  test("closes the previous note's drawing when the reused view shows a note without one", () => {
    expect(mapInkStep("B.md", null, { path: "A map ink.svg", note: "A.md" })).toBe("close");
    expect(mapInkStep("B.md", null, { path: null, note: "A.md" })).toBe("close");
    expect(mapInkStep("B.md", null, null)).toBeNull();
  });

  test("keeps a just-created drawing while its frontmatter link is being indexed", () => {
    expect(mapInkStep("A.md", null, { path: "A map ink.svg", note: "A.md" })).toBeNull();
    expect(mapInkStep("A.md", null, { path: null, note: "A.md" })).toBeNull();
  });
});
