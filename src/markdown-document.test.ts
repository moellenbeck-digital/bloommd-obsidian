import { describe, expect, test } from "bun:test";
import {
  addChildHeading,
  addSiblingHeading,
  copyHeadingBranch,
  deleteHeadingBranch,
  editHeading,
  findHeading,
  ensureHeadingIds,
  flattenHeadings,
  moveHeadingBranch,
  parseHeadingTree,
  type MarkdownHeadingNode,
} from "./markdown-document";

const NOTE = `---
title: Plugin test
---
# BloomMD Plugin Test

## Goal
Visualize this note as a mind map.

## Architecture
### Parser
Should ignore headings inside code blocks.

\`\`\`ts
# Not a heading
function test() {}
\`\`\`

### Privacy
No note content should be uploaded.

## Open Questions
- Does the ribbon button work?
`;

function nodeId(markdown: string, title: string): string {
  const node = flattenHeadings(parseHeadingTree(markdown)).find((candidate) => candidate.title === title);
  if (!node) throw new Error(`Missing test node: ${title}`);
  return node.id;
}

describe("Obsidian Markdown editing", () => {
  test("hides and preserves BloomMD type metadata", () => {
    const markdown = '# Portal <!-- bloommd:id=portal --> <!-- bloommd:meta={"kind":"portal","file":"Roadmap.md"} -->\n\nOpen it.\n';
    const parsed = parseHeadingTree(markdown);
    expect(parsed[0]?.id).toBe("portal");
    expect(parsed[0]?.title).toBe("Portal");

    const renamed = editHeading(markdown, "portal", "Roadmap portal", "Updated.");
    expect(renamed).toContain('<!-- bloommd:meta={"kind":"portal","file":"Roadmap.md"} -->');
    expect(parseHeadingTree(renamed)[0]?.title).toBe("Roadmap portal");
  });

  test("parses frontmatter and ignores headings inside code fences", () => {
    const nodes = parseHeadingTree(NOTE);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.title).toBe("BloomMD Plugin Test");
    expect(nodes[0]?.children.map((node) => node.title)).toEqual(["Goal", "Architecture", "Open Questions"]);
    expect(nodes[0]?.children[1]?.children.map((node) => node.title)).toEqual(["Parser", "Privacy"]);
  });

  test("edits only the selected node title and content", () => {
    const result = editHeading(NOTE, nodeId(NOTE, "Privacy"), "Local privacy", "Nothing leaves the vault.");
    expect(result).toContain("title: Plugin test");
    expect(result).toContain("### Local privacy\n\nNothing leaves the vault.");
    expect(result).toContain("# Not a heading");
    expect(result).toContain("## Open Questions");
  });

  test("adds a child after the complete parent branch", () => {
    const result = addChildHeading(NOTE, nodeId(NOTE, "Architecture"), "Deployment");
    expect(result.indexOf("### Deployment")).toBeGreaterThan(result.indexOf("### Privacy"));
    expect(result.indexOf("### Deployment")).toBeLessThan(result.indexOf("## Open Questions"));
  });

  test("adds stable IDs without changing frontmatter or fenced code", () => {
    const result = ensureHeadingIds(NOTE);
    expect(result.changed).toBe(true);
    expect(result.markdown.match(/bloommd:id=/g)?.length).toBe(6);
    expect(result.markdown).toContain("# Not a heading");
    expect(ensureHeadingIds(result.markdown)).toEqual({ markdown: result.markdown, changed: false });
    expect(parseHeadingTree(result.markdown)[0]?.id).not.toStartWith("heading-");
  });

  test("adds a sibling with the same heading level", () => {
    const withIds = ensureHeadingIds(NOTE).markdown;
    const result = addSiblingHeading(withIds, nodeId(withIds, "Privacy"), "Security");
    expect(result).toContain("### Security <!-- bloommd:id=");
    expect(result.indexOf("### Security")).toBeLessThan(result.indexOf("## Open Questions"));
  });

  test("moves a complete branch and adjusts all heading levels", () => {
    const architectureId = nodeId(NOTE, "Architecture");
    const goalId = nodeId(NOTE, "Goal");
    const result = moveHeadingBranch(NOTE, architectureId, goalId);
    expect(result).toContain("### Architecture");
    expect(result).toContain("#### Parser");
    expect(result).toContain("#### Privacy");
    expect(result.indexOf("### Architecture")).toBeLessThan(result.indexOf("## Open Questions"));
    expect(result).toContain("# Not a heading");
  });

  test("keeps stable IDs through rename, content edits, and reparenting", () => {
    const withIds = ensureHeadingIds(NOTE).markdown;
    const architectureId = nodeId(withIds, "Architecture");
    const goalId = nodeId(withIds, "Goal");
    const renamed = editHeading(withIds, architectureId, "System Architecture", "Updated locally.");
    const moved = moveHeadingBranch(renamed, architectureId, goalId);
    const node = findHeading(parseHeadingTree(moved), architectureId);
    expect(node?.title).toBe("System Architecture");
    expect(node?.content).toBe("Updated locally.");
    expect(node?.level).toBe(3);
  });

  test("deletes a branch without touching adjacent content", () => {
    const result = deleteHeadingBranch(NOTE, nodeId(NOTE, "Architecture"));
    expect(result).not.toContain("## Architecture");
    expect(result).not.toContain("### Parser");
    expect(result).toContain("## Goal");
    expect(result).toContain("## Open Questions");
    expect(result).toContain("title: Plugin test");
  });

  test("copies a complete branch with fresh IDs and preserved type metadata", () => {
    const withIds = ensureHeadingIds(NOTE.replace("## Architecture", '## Architecture <!-- bloommd:meta={"kind":"decision"} -->')).markdown;
    const sourceId = nodeId(withIds, "Architecture");
    const targetId = nodeId(withIds, "Goal");
    const result = copyHeadingBranch(withIds, sourceId, targetId);
    const architectures = flattenHeadings(parseHeadingTree(result)).filter((node) => node.title === "Architecture");

    expect(architectures).toHaveLength(2);
    expect(new Set(architectures.map((node) => node.id)).size).toBe(2);
    expect(architectures.some((node) => node.level === 3)).toBe(true);
    expect(result.match(/bloommd:meta=\{"kind":"decision"\}/g)).toHaveLength(2);
    expect(result).toContain("#### Parser");
    expect(result).toContain("# Not a heading");
  });

  test("does not copy a branch into itself or past heading level six", () => {
    const withIds = ensureHeadingIds(NOTE).markdown;
    const architectureId = nodeId(withIds, "Architecture");
    const parserId = nodeId(withIds, "Parser");
    expect(() => copyHeadingBranch(withIds, architectureId, parserId)).toThrow("outside the copied branch");

    const deep = "# Root\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n";
    const deepWithIds = ensureHeadingIds(deep).markdown;
    expect(() => copyHeadingBranch(deepWithIds, nodeId(deepWithIds, "Five"), nodeId(deepWithIds, "Six"))).toThrow();
  });
});

describe("CommonMark parity with the BloomMD core parser", () => {
  test("reads Setext headings as nodes", () => {
    const tree = parseHeadingTree("Project\n=======\n\nBody.\n\nSection\n-------\n\nMore.\n");
    expect(tree).toHaveLength(1);
    expect(tree[0]!.title).toBe("Project");
    expect(tree[0]!.level).toBe(1);
    expect(tree[0]!.children[0]!.title).toBe("Section");
    expect(tree[0]!.children[0]!.level).toBe(2);
  });

  test("keeps a Setext heading intact when its content is edited", () => {
    const note = "Project\n=======\n\nOld body.\n";
    const withIds = ensureHeadingIds(note).markdown;
    const id = parseHeadingTree(withIds)[0]!.id;
    const updated = editHeading(withIds, id, "Renamed", "New body.");
    expect(updated).toContain("=======");
    expect(updated).toContain("Renamed");
    expect(updated).toContain("New body.");
    expect(updated).not.toContain("Old body.");
    expect(parseHeadingTree(updated)[0]!.level).toBe(1);
  });

  test("converts a Setext heading to ATX when a move pushes it past level 2", () => {
    const note = "# Root\n\n## Branch\n\nMoved\n-----\n\nBody.\n";
    const withIds = ensureHeadingIds(note).markdown;
    const tree = parseHeadingTree(withIds);
    const moved = tree[0]!.children.find((node) => node.title === "Moved")!;
    const branch = tree[0]!.children.find((node) => node.title === "Branch")!;
    const result = moveHeadingBranch(withIds, moved.id, branch.id);
    expect(result).toContain("### Moved");
    expect(result).not.toMatch(/^-----$/m);
    expect(findHeading(parseHeadingTree(result), moved.id)!.level).toBe(3);
  });

  test("ignores headings inside an HTML block", () => {
    const tree = parseHeadingTree("# Root\n\n<div>\n# not a heading\n</div>\n\n## Real\n");
    expect(flattenHeadings(tree).map((node) => node.title)).toEqual(["Root", "Real"]);
  });

  test("does not write ids into an HTML block", () => {
    const note = "# Root\n\n<div>\n# not a heading\n</div>\n";
    const result = ensureHeadingIds(note).markdown;
    expect(result).toContain("<div>\n# not a heading\n</div>");
  });

  test("treats unterminated frontmatter as content instead of hiding the note", () => {
    const tree = parseHeadingTree("---\ntitle: X\n\n# Root\n\n## A\n");
    expect(flattenHeadings(tree).map((node) => node.title)).toEqual(["Root", "A"]);
  });

  test("drops an ATX closing sequence but keeps a trailing hash without space", () => {
    expect(parseHeadingTree("# Title ###\n")[0]!.title).toBe("Title");
    expect(parseHeadingTree("# Title#\n")[0]!.title).toBe("Title#");
  });

  test("keeps an empty ATX heading as a node", () => {
    expect(parseHeadingTree("# \n\n## A\n")).toHaveLength(1);
  });

  test("does not treat a thematic break or list dash as a Setext underline", () => {
    expect(parseHeadingTree("Paragraph.\n\n---\n\nMore.\n")).toHaveLength(0);
    expect(parseHeadingTree("- item\n- item\n")).toHaveLength(0);
  });
});

describe("id stability in real vaults", () => {
  test("replaces a duplicated id instead of appending a second comment", () => {
    let note = "# Root <!-- bloommd:id=dup -->\n\n## A <!-- bloommd:id=dup -->\n";
    for (let pass = 0; pass < 3; pass += 1) note = ensureHeadingIds(note).markdown;
    const line = note.split("\n").find((value) => value.startsWith("## A"))!;
    expect(line.match(/bloommd:id=/g)).toHaveLength(1);
    expect(ensureHeadingIds(note).changed).toBe(false);
  });

  test("keeps ids unique after a heading is duplicated in the editor", () => {
    const note = ensureHeadingIds("# Root <!-- bloommd:id=dup -->\n\n## A <!-- bloommd:id=dup -->\n").markdown;
    const ids = flattenHeadings(parseHeadingTree(note)).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ignores tab-indented headings, which are indented code", () => {
    const tree = parseHeadingTree("# Root\n\n\t## not a heading\n\n## Real\n");
    expect(flattenHeadings(tree).map((node) => node.title)).toEqual(["Root", "Real"]);
  });

  test("preserves CRLF line endings", () => {
    const result = ensureHeadingIds("# Root\r\n\r\n## A\r\n").markdown;
    expect(result).toContain("\r\n");
    expect(result).not.toMatch(/[^\r]\n/);
  });
});

describe("branch moves keep the hierarchy intact", () => {
  const ids = (markdown: string) =>
    Object.fromEntries(flattenHeadings(parseHeadingTree(markdown)).map((node) => [node.title, node.id]));

  test("moving the last branch onto its own parent keeps it inside that section", () => {
    // Regression: the splice index was only corrected for targets strictly after the branch, so a
    // parent whose section ended with the branch received it *after* the section instead.
    let note = ensureHeadingIds("# Root\n\n## Alpha\n\n### One\n\n### Two\n\n## Beta\n").markdown;
    const before = ids(note);
    note = moveHeadingBranch(note, before.Two!, before.Alpha!);
    const alpha = flattenHeadings(parseHeadingTree(note)).find((node) => node.title === "Alpha")!;
    expect(alpha.children.map((child) => child.title)).toEqual(["One", "Two"]);
    expect(alpha.children.every((child) => child.level === alpha.level + 1)).toBe(true);
  });

  test("every child stays exactly one level below its parent after a move", () => {
    let note = ensureHeadingIds("# Root\n\n## Alpha\n\n### One\n\n## Beta\n\n### Two\n").markdown;
    const before = ids(note);
    note = moveHeadingBranch(note, before.Beta!, before.One!);
    const walk = (node: MarkdownHeadingNode) => {
      for (const child of node.children) {
        expect(child.level).toBe(node.level + 1);
        walk(child);
      }
    };
    parseHeadingTree(note).forEach(walk);
  });
});
