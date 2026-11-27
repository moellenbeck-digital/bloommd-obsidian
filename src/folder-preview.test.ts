import { expect, test } from "bun:test";
import { folderFilePreview, isEditableHeading } from "./folder-preview";
import { assignHeadingIds } from "./heading-ids";
import { parseHeadingTree } from "./markdown-document";

test("folder previews fold the matching title, keep source ids and namespace files", () => {
  const markdown = "# Plan\n\n## Gleich\n\nEins\n\n## Gleich\n\nZwei\n";
  const source = parseHeadingTree(assignHeadingIds(markdown).markdown)[0]!;
  const first = folderFilePreview("Team/Plan.md", "Plan", markdown);
  const second = folderFilePreview("Else/Plan.md", "Plan", markdown);
  expect(first).toHaveLength(2);
  expect(first.map((node) => node.sourceHeadingId)).toEqual(source.children.map((node) => node.id));
  expect(new Set([...first, ...second].map((node) => node.id)).size).toBe(4);
  expect(first.map((node) => isEditableHeading(node))).toEqual([false, false]);
  expect(first[1]?.content).toContain("Zwei");
  expect(first[0]?.parentId).toBe("file:Team/Plan.md");
});

test("previewing existing heading ids keeps them and nested hierarchy intact", () => {
  const result = folderFilePreview("a.md", "a", "# Title <!-- bloommd:id=root -->\n\n## Child <!-- bloommd:id=child -->\n");
  expect(result[0]?.sourceHeadingId).toBe("root");
  expect(result[1]?.parentId).toBe(result[0]?.id);
  expect(result[0]?.children).toEqual([result[1]!.id]);
});
