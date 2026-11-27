import { describe, expect, test } from "bun:test";
import { HISTORY_LIMIT, canGoBack, canGoForward, currentContext, emptyHistory, pushContext, remapHistory, step } from "./navigator-history";

const at = (folder: string, file: string | null = null) => ({ folder, file });

describe("navigation history", () => {
  test("starts empty and cannot move", () => {
    expect(currentContext(emptyHistory)).toBeNull();
    expect(canGoBack(emptyHistory)).toBe(false);
    expect(canGoForward(emptyHistory)).toBe(false);
    expect(step(emptyHistory, -1)).toBeNull();
  });

  test("goes back and forward through folder and file contexts", () => {
    let history = pushContext(emptyHistory, at("/"));
    history = pushContext(history, at("Projects"));
    history = pushContext(history, at("Projects/Alpha", "Projects/Alpha/Notes.md"));
    expect(currentContext(history)).toEqual(at("Projects/Alpha", "Projects/Alpha/Notes.md"));

    const back = step(history, -1)!;
    expect(currentContext(back)).toEqual(at("Projects"));
    expect(canGoForward(back)).toBe(true);
    expect(currentContext(step(back, 1)!)).toEqual(at("Projects/Alpha", "Projects/Alpha/Notes.md"));
    expect(step(step(back, -1)!, -1)).toBeNull();
  });

  test("does not record the current context twice", () => {
    const history = pushContext(emptyHistory, at("Projects"));
    expect(pushContext(history, at("Projects"))).toBe(history);
    expect(pushContext(history, at("Projects", "Projects/Notes.md")).entries).toHaveLength(2);
  });

  test("a new context drops the forward entries", () => {
    let history = pushContext(pushContext(pushContext(emptyHistory, at("/")), at("A")), at("B"));
    history = step(step(history, -1)!, -1)!;
    history = pushContext(history, at("C"));
    expect(history.entries.map((entry) => entry.folder)).toEqual(["/", "C"]);
    expect(canGoForward(history)).toBe(false);
  });

  test("skips entries that are no longer valid", () => {
    const history = pushContext(pushContext(pushContext(emptyHistory, at("/")), at("Gone")), at("B"));
    const back = step(history, -1, (entry) => entry.folder !== "Gone");
    expect(currentContext(back!)).toEqual(at("/"));
    expect(step(history, -1, () => false)).toBeNull();
  });

  test("keeps only the most recent entries", () => {
    let history = emptyHistory;
    for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) history = pushContext(history, at(`f${index}`));
    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(currentContext(history)?.folder).toBe(`f${HISTORY_LIMIT + 19}`);
    expect(history.index).toBe(HISTORY_LIMIT - 1);
  });

  test("remaps folders and files after a rename", () => {
    const history = pushContext(pushContext(emptyHistory, at("/")), at("Projects/Alpha", "Projects/Alpha/Notes.md"));
    const renamed = remapHistory(history, "Projects", "Work");
    expect(renamed.entries).toEqual([at("/"), at("Work/Alpha", "Work/Alpha/Notes.md")]);
    expect(renamed.index).toBe(1);
  });
});
