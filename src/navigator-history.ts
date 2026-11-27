/**
 * Back/forward history of the navigator. An entry is a navigation context: a folder and,
 * optionally, a file in it. The history is immutable; every function returns a new one.
 */
import { remapPath } from "./navigator-model";

export interface NavContext {
  folder: string;
  file: string | null;
}

export interface NavHistory {
  entries: readonly NavContext[];
  /** Index of the current entry, -1 while the history is empty. */
  index: number;
}

export const HISTORY_LIMIT = 100;

export const emptyHistory: NavHistory = { entries: [], index: -1 };

export const sameContext = (a: NavContext, b: NavContext) => a.folder === b.folder && a.file === b.file;

export function currentContext(history: NavHistory): NavContext | null {
  return history.entries[history.index] ?? null;
}

/** Records a visited context. Visiting the current one again changes nothing; visiting a new one drops the forward entries. */
export function pushContext(history: NavHistory, context: NavContext): NavHistory {
  const current = currentContext(history);
  if (current && sameContext(current, context)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), context].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

export const canGoBack = (history: NavHistory) => history.index > 0;
export const canGoForward = (history: NavHistory) => history.index >= 0 && history.index < history.entries.length - 1;

/**
 * Steps back or forward to the nearest entry `isValid` accepts (so contexts whose folder was deleted
 * in the meantime are skipped). Returns null when there is no such entry.
 */
export function step(history: NavHistory, direction: -1 | 1, isValid: (context: NavContext) => boolean = () => true): NavHistory | null {
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    const entry = history.entries[index];
    if (entry && isValid(entry)) return { entries: history.entries, index };
  }
  return null;
}

/** Applies a rename or move of a file or folder to every entry. */
export function remapHistory(history: NavHistory, from: string, to: string): NavHistory {
  return {
    index: history.index,
    entries: history.entries.map((entry) => ({
      folder: remapPath(entry.folder, from, to),
      file: entry.file === null ? null : remapPath(entry.file, from, to),
    })),
  };
}
