import { describe, expect, test } from "bun:test";
import { appendSvgEmbed, ensureWikiLink, inkFileName, svgEmbeds } from "./ink-embeds";

describe("svgEmbeds", () => {
  test("finds SVG embeds with spaces, folders, sizes and aliases", () => {
    const markdown = "Intro\n\n![[anhaenge/Thermo ink.svg]]\n\n![[Formel 2.svg|400]] and ![[Other.SVG#x]]";
    expect(svgEmbeds(markdown).map((embed) => embed.link)).toEqual(["anhaenge/Thermo ink.svg", "Formel 2.svg", "Other.SVG"]);
  });

  test("ignores links, other images and duplicates", () => {
    expect(svgEmbeds("[[Note.svg]] ![[photo.png]] ![[a.svg]] ![[a.svg|200]]").map((embed) => embed.link)).toEqual(["a.svg"]);
  });
});

describe("appendSvgEmbed", () => {
  test("appends the embed as its own paragraph", () => {
    expect(appendSvgEmbed("Some text\n\n\n", "x ink.svg")).toBe("Some text\n\n![[x ink.svg]]\n");
    expect(appendSvgEmbed("", "x ink.svg")).toBe("![[x ink.svg]]\n");
  });

  test("does not add the same drawing twice", () => {
    const markdown = "![[x ink.svg|300]]\n";
    expect(appendSvgEmbed(markdown, "x ink.svg")).toBe(markdown);
  });
});

describe("ensureWikiLink", () => {
  test("adds a missing wikilink once", () => {
    const once = ensureWikiLink("![[x ink.svg]]\n", "Arbeit");
    expect(once).toBe("![[x ink.svg]]\n\n[[Arbeit]]\n");
    expect(ensureWikiLink(once, "Arbeit")).toBe(once);
  });

  test("treats aliased and heading links as present but not embeds", () => {
    expect(ensureWikiLink("See [[Arbeit|W]]", "Arbeit")).toBe("See [[Arbeit|W]]");
    expect(ensureWikiLink("See [[Arbeit#Definition]]", "Arbeit")).toBe("See [[Arbeit#Definition]]");
    expect(ensureWikiLink("![[Arbeit]]", "Arbeit")).toBe("![[Arbeit]]\n\n[[Arbeit]]\n");
  });

  test("escapes regex characters in targets", () => {
    expect(ensureWikiLink("[[C++ (Sprache)]]", "C++ (Sprache)")).toBe("[[C++ (Sprache)]]");
  });
});

describe("inkFileName", () => {
  test("derives a safe name from the note", () => {
    expect(inkFileName("Thermodynamik")).toBe("Thermodynamik ink.svg");
    expect(inkFileName("A/B: [draft]#1")).toBe("A B draft 1 ink.svg");
    expect(inkFileName("  ")).toBe("Drawing ink.svg");
  });
});
