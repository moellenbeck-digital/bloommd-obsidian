import { describe, expect, test } from "bun:test";
import { borderPoint, connectionFromStroke, createLinkedMapInk, floatingEdgeEnds, freePosition, mapInkLink, studyCards, studyProgress, relationEdges, retargetLinkedNotes, withKind, withLinkedNote, withRelations } from "./concept-map";
import { parseHeadingTree } from "./markdown-document";

describe("withLinkedNote", () => {
  test("links a plain topic and removes the link again", () => {
    expect(withLinkedNote(undefined, "Arbeit")).toEqual({ kind: "topic", note: "Arbeit" });
    expect(withLinkedNote({ kind: "topic", note: "Arbeit" }, null)).toBeUndefined();
  });

  test("keeps other metadata", () => {
    expect(withLinkedNote({ kind: "task", status: "done" }, "Arbeit")).toEqual({ kind: "task", status: "done", note: "Arbeit" });
    expect(withLinkedNote({ kind: "topic", note: "A", relations: [{ target: "x" }] }, null)).toEqual({ kind: "topic", relations: [{ target: "x" }] });
  });
});

describe("withRelations", () => {
  test("deduplicates targets, trims labels and drops empty lists", () => {
    expect(withRelations(undefined, [{ target: "a", label: " braucht " }, { target: "a" }, { target: "b", label: " " }])).toEqual({
      kind: "topic",
      relations: [{ target: "a", label: "braucht" }, { target: "b" }],
    });
    expect(withRelations({ kind: "topic", relations: [{ target: "a" }] }, [])).toBeUndefined();
  });
});

describe("withKind", () => {
  test("keeps the linked note and relations across type changes", () => {
    const linked = { kind: "topic" as const, note: "Arbeit", relations: [{ target: "x" }] };
    expect(withKind(linked, "task")).toEqual({ kind: "task", note: "Arbeit", relations: [{ target: "x" }] });
    expect(withKind({ kind: "web", url: "https://example.com", note: "Arbeit" }, "topic")).toEqual({ kind: "topic", note: "Arbeit" });
    expect(withKind({ kind: "web", url: "https://example.com" }, "topic")).toBeUndefined();
    expect(withKind(undefined, "task")).toEqual({ kind: "task" });
  });
});

describe("relationEdges", () => {
  const headings = [
    { id: "w", parentId: null, metadata: { kind: "topic" as const, relations: [{ target: "u", label: "braucht" }, { target: "a" }, { target: "gone" }, { target: "w" }] } },
    { id: "a", parentId: "w" },
    { id: "u", parentId: "w", metadata: { kind: "topic" as const, relations: [{ target: "w" }, { target: "p" }] } },
    { id: "p", parentId: "a" },
  ];

  test("draws relations between visible nodes, once per pair, skipping hierarchy edges", () => {
    expect(relationEdges(headings, new Set(["w", "a", "u", "p"]))).toEqual([
      { id: "relation:u:p", source: "u", target: "p" },
    ]);
  });

  test("keeps relations hidden while an end is collapsed", () => {
    expect(relationEdges(headings, new Set(["w", "a", "u"]))).toEqual([]);
  });

  test("labels survive", () => {
    const flat = [
      { id: "a", parentId: null, metadata: { kind: "topic" as const, relations: [{ target: "b", label: "braucht" }] } },
      { id: "b", parentId: null },
    ];
    expect(relationEdges(flat, new Set(["a", "b"]))).toEqual([{ id: "relation:a:b", source: "a", target: "b", label: "braucht" }]);
  });
});

describe("retargetLinkedNotes", () => {
  test("rewrites linked notes after a rename and leaves other nodes alone", () => {
    const markdown = [
      "# Physik <!-- bloommd:id=p --> <!-- bloommd:meta={\"kind\":\"topic\",\"note\":\"Arbeit#Definition\"} -->",
      "## Wärme <!-- bloommd:id=w --> <!-- bloommd:meta={\"kind\":\"topic\",\"note\":\"Wärme\"} -->",
      "",
    ].join("\n");
    const next = retargetLinkedNotes(markdown, "Physik/Arbeit.md", "Mechanische Arbeit");
    const [root] = parseHeadingTree(next);
    expect(root?.metadata?.note).toBe("Mechanische Arbeit#Definition");
    expect(root?.children[0]?.metadata?.note).toBe("Wärme");
  });

  test("leaves links that still resolve to another note of the same name", () => {
    const markdown = "# Physik <!-- bloommd:id=p --> <!-- bloommd:meta={\"kind\":\"topic\",\"note\":\"Arbeit\"} -->\n";
    expect(retargetLinkedNotes(markdown, "Alt/Arbeit.md", "Neu", () => false)).toBe(markdown);
    expect(parseHeadingTree(retargetLinkedNotes(markdown, "Alt/Arbeit.md", "Neu", (note) => note === "Arbeit"))[0]?.metadata?.note).toBe("Neu");
  });

  test("returns the same string when nothing links the note", () => {
    const markdown = "# Physik <!-- bloommd:id=p -->\n";
    expect(retargetLinkedNotes(markdown, "Arbeit.md", "Neu")).toBe(markdown);
  });
});

describe("floating edges", () => {
  const box = { x: 0, y: 0, width: 200, height: 100 };

  test("leave the box on the side facing the other node", () => {
    expect(borderPoint(box, { x: 500, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(borderPoint(box, { x: 100, y: -300 })).toEqual({ x: 100, y: 0 });
    expect(borderPoint(box, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  test("connect facing borders of two nodes", () => {
    expect(floatingEdgeEnds(box, { x: 0, y: 300, width: 200, height: 100 })).toEqual({ sx: 100, sy: 100, tx: 100, ty: 300 });
  });
});

describe("study mode", () => {
  test("only nodes with content are cards, and progress counts revealed cards", () => {
    const cards = studyCards([
      { id: "a", kind: "heading", content: "ΔU = Q + W" },
      { id: "b", kind: "heading", content: "  " },
      { id: "c", kind: "heading", content: "![[Thermo ink.svg]]" },
      { id: "d", kind: "file", content: "x" },
    ]);
    expect(cards).toEqual(["a", "c"]);
    expect(studyProgress(cards, new Set(["c", "b"]))).toEqual({ revealed: 1, total: 2 });
  });
});

describe("map ink", () => {
  test("reads the drawing link from frontmatter", () => {
    expect(mapInkLink("[[Physik map ink.svg]]")).toBe("Physik map ink.svg");
    expect(mapInkLink("![[Anhänge/x.svg|300]]")).toBe("Anhänge/x.svg");
    expect(mapInkLink("plain.svg")).toBe("plain.svg");
    expect(mapInkLink("[[note]]")).toBeNull();
    expect(mapInkLink(42)).toBeNull();
  });

  test("a stroke from one node to another is a connection", () => {
    const nodes = [{ id: "a", x: 0, y: 0, width: 100, height: 50 }, { id: "b", x: 300, y: 0, width: 100, height: 50 }];
    expect(connectionFromStroke([[50, 25, 0.5], [200, 30, 0.5], [350, 20, 0.5]], nodes)).toEqual({ source: "a", target: "b" });
    expect(connectionFromStroke([[50, 25], [80, 30]], nodes)).toBeNull();
    expect(connectionFromStroke([[150, 25], [350, 20]], nodes)).toBeNull();
    expect(connectionFromStroke([[50, 25]], nodes)).toBeNull();
  });
});

describe("freePosition", () => {
  test("keeps a free spot and moves below nodes placed by hand", () => {
    const candidate = { x: 100, y: 100, width: 200, height: 80 };
    expect(freePosition(candidate, [{ x: 400, y: 100, width: 200, height: 80 }])).toEqual({ x: 100, y: 100 });
    expect(freePosition(candidate, [{ x: 150, y: 120, width: 200, height: 80 }])).toEqual({ x: 100, y: 224 });
    expect(freePosition(candidate, [{ x: 150, y: 120, width: 200, height: 80 }, { x: 90, y: 230, width: 200, height: 50 }])).toEqual({ x: 100, y: 304 });
  });
});

describe("createLinkedMapInk", () => {
  test("returns the created drawing even when linking it from the note fails", async () => {
    const warnings: string[] = [];
    let created = 0;
    const store = {
      create: async () => `A map ink${++created > 1 ? ` ${created}` : ""}.svg`,
      link: async () => {
        throw new Error("frontmatter is invalid YAML");
      },
      warn: (message: string) => warnings.push(message),
    };
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(await createLinkedMapInk(store)).toBe("A map ink.svg");
    } finally {
      console.error = originalError;
    }
    expect(created).toBe(1);
    expect(warnings).toEqual(["BloomMD: The map drawing was saved as A map ink.svg, but it could not be linked from the note."]);
  });

  test("links the drawing without a warning", async () => {
    const linked: string[] = [];
    const warnings: string[] = [];
    const path = await createLinkedMapInk({ create: async () => "x.svg", link: async (target) => { linked.push(target); return true; }, warn: (message) => warnings.push(message) });
    expect(path).toBe("x.svg");
    expect(linked).toEqual(["x.svg"]);
    expect(warnings).toEqual([]);
  });
});
