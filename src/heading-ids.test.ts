import { describe, expect, test } from "bun:test";
import { assignHeadingIds } from "./heading-ids";
import { ensureHeadingIds, parseHeadingTree, flattenHeadings, renameHeading } from "./markdown-document";

const NOTE = `---
title: Demo
---
# Demo

## Goal
Text.

## Architecture
### Parser
### Parser

## Goal
Again.
`;

const idsOf = (markdown: string) => flattenHeadings(parseHeadingTree(markdown)).map((node) => node.id);

describe("assignHeadingIds", () => {
  test("gives the same ids on every call for the same note", () => {
    const first = assignHeadingIds(NOTE);
    const second = assignHeadingIds(NOTE);
    expect(first.changed).toBe(true);
    expect(first.markdown).toBe(second.markdown);
    expect(idsOf(first.markdown)).toEqual(idsOf(second.markdown));
  });

  test("ensureHeadingIds, by contrast, is random", () => {
    expect(ensureHeadingIds(NOTE).markdown).not.toBe(ensureHeadingIds(NOTE).markdown);
  });

  test("every heading gets a unique id, also repeated titles", () => {
    const ids = idsOf(assignHeadingIds(NOTE).markdown);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids.every((id) => /^[0-9a-f]{12}$/.test(id))).toBe(true);
  });

  test("only adds the id comments: removing them gives the note back", () => {
    const withIds = assignHeadingIds(NOTE).markdown;
    expect(withIds.replace(/ <!-- bloommd:id=[0-9a-f]{12} -->/g, "")).toBe(NOTE);
  });

  test("a note that already has ids is returned as it is", () => {
    const written = assignHeadingIds(NOTE).markdown;
    const again = assignHeadingIds(written);
    expect(again.changed).toBe(false);
    expect(again.markdown).toBe(written);
  });

  test("a heading that has an id keeps it; new headings get theirs without disturbing the rest", () => {
    const written = assignHeadingIds(NOTE).markdown;
    const before = idsOf(written);
    const extended = `${written}\n## Later\n`;
    const after = idsOf(assignHeadingIds(extended).markdown);
    expect(after.slice(0, 6)).toEqual(before);
    expect(after).toHaveLength(7);
    expect(new Set(after).size).toBe(7);
  });

  test("a stale duplicate id is replaced by a stable one", () => {
    const duplicated = "# A <!-- bloommd:id=aaaaaaaaaaaa -->\n\n## B <!-- bloommd:id=aaaaaaaaaaaa -->\n";
    const first = assignHeadingIds(duplicated);
    expect(first.changed).toBe(true);
    expect(idsOf(first.markdown)[0]).toBe("aaaaaaaaaaaa");
    expect(idsOf(first.markdown)[1]).not.toBe("aaaaaaaaaaaa");
    expect(assignHeadingIds(duplicated).markdown).toBe(first.markdown);
  });

  test("keeps CRLF line endings", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const result = assignHeadingIds(crlf).markdown;
    expect(result.includes("\r\n")).toBe(true);
    expect(result.replace(/\r\n/g, "\n").includes("\r")).toBe(false);
    expect(result.replace(/ <!-- bloommd:id=[0-9a-f]{12} -->/g, "")).toBe(crlf);
  });

  test("an edit on the assigned note keeps every id (the first write only adds them to the file)", () => {
    const assigned = assignHeadingIds(NOTE).markdown;
    const target = flattenHeadings(parseHeadingTree(assigned))[1]!;
    const edited = ensureHeadingIds(renameHeading(assigned, target.id, "Objective")).markdown;
    const ids = idsOf(edited);
    expect(ids).toEqual(idsOf(assigned));
    expect(flattenHeadings(parseHeadingTree(edited))[1]!.title).toBe("Objective");
  });

  test("a note without headings stays untouched", () => {
    const result = assignHeadingIds("Just text.\n");
    expect(result).toEqual({ markdown: "Just text.\n", changed: false });
  });
});
