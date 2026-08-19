import { describe, expect, test } from "bun:test";
import { claimPendingAction, contentPreview, externalLinks, externalResourceKind, orderedHeadingIds, visibleHeadingIds, wikiLinks } from "./canvas";
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
