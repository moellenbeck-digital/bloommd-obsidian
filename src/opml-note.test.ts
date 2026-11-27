import { describe, expect, test } from "bun:test";
import { OpmlError } from "./opml";
import { headingsToOpml, planOpmlNote } from "./opml-note";

describe("headingsToOpml", () => {
  const headings = [
    { id: "a", title: "Wurzel", content: "Notiz & mehr", children: ["b", "c"] },
    { id: "b", title: "Kind <1>", content: "", children: [] },
    { id: "c", title: "Kind 2", content: "Zeile 1\nZeile 2", children: ["d"] },
    { id: "d", title: "Enkel", content: "", children: [] },
  ];

  test("nests the headings and puts content into _note", () => {
    const xml = headingsToOpml("Reise", headings);
    expect(xml).toContain("<title>Reise</title>");
    expect(xml).toContain('<outline text="Wurzel" _note="Notiz &amp; mehr">');
    expect(xml).toContain('<outline text="Kind &lt;1&gt;"/>');
    expect(xml).toContain('<outline text="Kind 2" _note="Zeile 1&#10;Zeile 2">');
    expect(xml).toContain('<outline text="Enkel"/>');
  });

  test("a heading cycle cannot loop", () => {
    const xml = headingsToOpml("Zyklus", [{ id: "a", title: "A", content: "", children: ["b"] }, { id: "b", title: "B", content: "", children: ["a"] }]);
    expect(xml.match(/<outline /g)?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe("planOpmlNote", () => {
  const xml = `<opml version="2.0"><head><title>Plan</title></head><body><outline text="Root"><outline text="Kind"/></outline></body></opml>`;

  test("names the note after the file and keeps the heading hierarchy", () => {
    const plan = planOpmlNote({ folder: "Projekte", fileName: "Wechsel.opml", xml, exists: () => false });
    expect(plan.path).toBe("Projekte/Wechsel.md");
    expect(plan.content).toBe("# Root\n\n## Kind\n");
  });

  test("never overwrites: a taken name gets a number", () => {
    const taken = new Set(["Wechsel.md", "Wechsel 1.md"]);
    expect(planOpmlNote({ folder: "", fileName: "Wechsel.opml", xml, exists: (path) => taken.has(path) }).path).toBe("Wechsel 2.md");
  });

  test("characters Obsidian rejects are replaced and an unusable name falls back", () => {
    expect(planOpmlNote({ folder: "/", fileName: "a:b#c.opml", xml, exists: () => false }).path).toBe("a-b-c.md");
    expect(planOpmlNote({ folder: "", fileName: ".opml", xml, exists: () => false }).path).toBe("Plan.md");
  });

  test("broken OPML raises a readable OpmlError and creates nothing", () => {
    expect(() => planOpmlNote({ folder: "", fileName: "x.opml", xml: "<opml><body>", exists: () => false })).toThrow(OpmlError);
    expect(() => planOpmlNote({ folder: "", fileName: "x.opml", xml: "", exists: () => false })).toThrow("empty");
  });
});
