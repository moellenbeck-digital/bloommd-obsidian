import { parseHeadingTree } from "./markdown-document";
import { assignHeadingIds } from "./heading-ids";
import type { CanvasHeading } from "./canvas";

/** Namespaced overview ids never masquerade as editable ids in the source note. No Vault writes. */
export function folderFilePreview(path: string, title: string, markdown: string): CanvasHeading[] {
  const roots = parseHeadingTree(assignHeadingIds(markdown).markdown);
  const result: CanvasHeading[] = [];
  const prefix = `preview:${encodeURIComponent(path)}:`;
  const walk = (node: (typeof roots)[number], parentId: string) => {
    result.push({ id: `${prefix}${node.id}`, parentId, title: node.title, content: node.content,
      level: node.level, children: node.children.map((child) => `${prefix}${child.id}`), kind: "heading",
      filePath: path, sourceHeadingId: node.id, ...(node.metadata ? { metadata: node.metadata } : {}) });
    node.children.forEach((child) => walk(child, `${prefix}${node.id}`));
  };
  const shown = roots.length === 1 && roots[0]!.level === 1 && roots[0]!.title.trim() === title.trim() && !roots[0]!.metadata
    ? roots[0]!.children : roots;
  shown.forEach((node) => walk(node, `file:${path}`));
  return result;
}

export function isEditableHeading(heading: CanvasHeading): boolean {
  return heading.kind === "heading" && !heading.sourceHeadingId;
}
