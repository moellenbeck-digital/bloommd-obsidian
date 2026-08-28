import { findHeading, findHeadingParent, parseHeadingTree } from "./markdown-document";

/**
 * Keep keyboard focus useful after an undo/redo operation. A restored node keeps focus; when the
 * selected node disappears (for example, undoing a freshly-created node), its parent is preferred.
 */
export function historyFocusId(currentMarkdown: string, replacementMarkdown: string, selectedId: string | null): string | null {
  const replacementTree = parseHeadingTree(replacementMarkdown);
  if (selectedId && findHeading(replacementTree, selectedId)) return selectedId;

  const currentTree = parseHeadingTree(currentMarkdown);
  const parentId = selectedId && findHeading(currentTree, selectedId)
    ? findHeadingParent(currentTree, selectedId)?.id
    : undefined;
  if (parentId && findHeading(replacementTree, parentId)) return parentId;
  return replacementTree[0]?.id ?? null;
}
