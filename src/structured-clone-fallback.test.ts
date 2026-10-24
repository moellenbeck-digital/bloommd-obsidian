import { describe, expect, test } from "bun:test";
import { cloneFallback } from "./structured-clone-fallback";

describe("cloneFallback", () => {
  test("deep-copies the shapes BloomMD clones", () => {
    const date = new Date("2026-10-24T10:00:00Z");
    const source = { title: "Map", tags: ["a", "b"], due: date, nested: { kind: "task", n: 1, ok: true, none: null }, map: new Map([["k", { v: 1 }]]), set: new Set([1, 2]) };
    const copy = cloneFallback(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.tags).not.toBe(source.tags);
    expect(copy.nested).not.toBe(source.nested);
    expect(copy.due).not.toBe(date);
    expect(copy.due.getTime()).toBe(date.getTime());
    expect(copy.map.get("k")).not.toBe(source.map.get("k"));
  });

  test("keeps cycles intact", () => {
    const node: { name: string; self?: unknown } = { name: "loop" };
    node.self = node;
    const copy = cloneFallback(node);
    expect(copy.self).toBe(copy);
  });
});
