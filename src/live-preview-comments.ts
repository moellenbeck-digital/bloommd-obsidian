import { EditorSelection, EditorState, StateField, Transaction, findClusterBreak, type Extension, type Text, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type PluginValue, type ViewUpdate } from "@codemirror/view";

/**
 * BloomMD stores node ids and metadata as HTML comments behind headings
 * (`## Title <!-- bloommd:id=abc --> <!-- bloommd:meta={...} -->`). They are needed for the
 * round trip, but Obsidian's Live Preview shows them. This module hides exactly those comments in
 * the display; the document itself is never touched.
 */

/** A document range (offsets) that Live Preview hides. */
export interface HiddenRange {
  from: number;
  to: number;
}

/** The part of a document the scan needs; CodeMirror's `Text` satisfies it. */
export interface LineSource {
  readonly lines: number;
  line(number: number): { readonly text: string; readonly from: number };
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const HEADING_MARKER_ONLY = /^ {0,3}#{1,6}$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// Same shapes as the Core parser: `bloommd:id=<id>` and `bloommd:meta=<json>`. The JSON never contains `-->` (Core escapes it), so the first `-->` ends the comment.
const BLOOMMD_COMMENT = /<!--\s*bloommd:(?:id=[A-Za-z0-9_-]+|meta=\{.*?\})\s*-->/gi;

/**
 * The BloomMD comments at the end of one heading line, as offsets into the line, or null.
 * A line that is not an ATX heading, or whose comments are not trailing, has nothing to hide.
 * Whitespace between the title and the first comment is part of the range so that the cursor
 * rests directly behind the title text.
 */
export function trailingCommentRange(line: string): HiddenRange | null {
  if (!ATX_HEADING.test(line)) return null;
  const comments: HiddenRange[] = [];
  BLOOMMD_COMMENT.lastIndex = 0;
  for (let match = BLOOMMD_COMMENT.exec(line); match; match = BLOOMMD_COMMENT.exec(line)) {
    comments.push({ from: match.index, to: match.index + match[0].length });
  }
  const last = comments[comments.length - 1];
  if (!last || line.slice(last.to).trim() !== "") return null;
  let start = last.from;
  for (let index = comments.length - 2; index >= 0; index -= 1) {
    const previous = comments[index]!;
    if (line.slice(previous.to, start).trim() !== "") break;
    start = previous.from;
  }
  const titleEnd = line.slice(0, start).trimEnd().length;
  // `# <!-- bloommd:id=x -->` keeps the space after the marker: the heading stays a heading.
  const from = HEADING_MARKER_ONLY.test(line.slice(0, titleEnd)) ? start : titleEnd;
  return { from, to: last.to };
}

/** Ranges to hide in a whole document: headings only, never in front matter or fenced code. */
export function hiddenCommentRanges(doc: LineSource): HiddenRange[] {
  const ranges: HiddenRange[] = [];
  let fence: { char: string; length: number } | null = null;
  let inFrontmatter = doc.lines > 0 && doc.line(1).text.trimEnd() === "---";
  for (let number = 1; number <= doc.lines; number += 1) {
    const { text, from } = doc.line(number);
    const line = text.endsWith("\r") ? text.slice(0, -1) : text;
    if (inFrontmatter) {
      if (number > 1 && (line.trimEnd() === "---" || line.trimEnd() === "...")) inFrontmatter = false;
      continue;
    }
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      continue;
    }
    const range = trailingCommentRange(line);
    if (range) ranges.push({ from: from + range.from, to: from + range.to });
  }
  return ranges;
}

/** Same scan for a plain string, for callers without an editor. */
export function hiddenCommentRangesInText(text: string): HiddenRange[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return hiddenCommentRanges({ lines: lines.length, line: (number) => ({ text: lines[number - 1]!, from: starts[number - 1]! }) });
}

/** What a user edit at the edge of a hidden range becomes so that the comment survives. */
export interface RedirectedChange {
  from: number;
  to: number;
  insert: string;
  /** Where the cursor belongs afterwards (document after the change). */
  cursor: number;
}

/**
 * The cursor can only rest next to a hidden range, so an edit made "at the end of the title" lands
 * behind the comment. Typing there would push text after the comment, and Backspace (which skips
 * the atomic range) would delete the comment. This moves such an edit to the title text instead.
 * Returns null when the edit does not touch a hidden range (or is too unusual to redirect).
 */
export function redirectChange(
  doc: Text,
  ranges: readonly HiddenRange[],
  change: { from: number; to: number; insert: string },
  backward: boolean,
): RedirectedChange | null {
  const { from, to, insert } = change;
  for (const range of ranges) {
    if (range.from > to) break;
    const inside = from >= range.from && to <= range.to;
    if (!inside) continue;
    if (from === to) {
      if (from === range.from) return null;
      if (/^\r?\n/.test(insert)) return from === range.to ? null : { from: range.to, to: range.to, insert, cursor: range.to + insert.length };
      return { from: range.from, to: range.from, insert, cursor: range.from + insert.length };
    }
    if (insert !== "") return { from: range.from, to: range.from, insert, cursor: range.from + insert.length };
    if (!backward) return { from: range.from, to: range.from, insert: "", cursor: range.from };
    const line = doc.lineAt(range.from);
    const start = line.from + findClusterBreak(line.text, range.from - line.from, false);
    return { from: start, to: range.from, insert: "", cursor: start };
  }
  return null;
}

interface CommentState {
  ranges: readonly HiddenRange[];
}

/**
 * CodeMirror 6 extension for Obsidian's `registerEditorExtension`. `isLivePreview` tells whether the
 * editor currently shows Live Preview (`editorLivePreviewField`); in Source mode the raw text stays.
 */
export function livePreviewCommentsExtension(isLivePreview: (state: EditorState) => boolean): Extension {
  const commentField = StateField.define<CommentState>({
    create: (state) => ({ ranges: hiddenCommentRanges(state.doc) }),
    update: (value, transaction) => (transaction.docChanged ? { ranges: hiddenCommentRanges(transaction.state.doc) } : value),
  });

  const hider = ViewPlugin.fromClass(
    class implements PluginValue {
      decorations: DecorationSet = Decoration.none;
      private source: readonly HiddenRange[] | null = null;
      private active = false;

      constructor(view: EditorView) {
        this.sync(view.state);
      }

      update(update: ViewUpdate) {
        this.sync(update.state);
      }

      private sync(state: EditorState) {
        const active = isLivePreview(state);
        const { ranges } = state.field(commentField);
        if (active === this.active && ranges === this.source) return;
        this.active = active;
        this.source = ranges;
        this.decorations = active ? Decoration.set(ranges.map((range) => Decoration.replace({}).range(range.from, range.to))) : Decoration.none;
      }
    },
    {
      decorations: (value) => value.decorations,
      // The cursor skips hidden ranges instead of stopping inside them.
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    },
  );

  const protectComments = EditorState.transactionFilter.of((transaction): Transaction | TransactionSpec => {
    // Only direct user edits; undo/redo and programmatic changes pass through untouched.
    if (!transaction.docChanged || !(transaction.isUserEvent("input") || transaction.isUserEvent("delete"))) return transaction;
    if (transaction.isUserEvent("input.type.compose") || !isLivePreview(transaction.startState)) return transaction;
    const { ranges } = transaction.startState.field(commentField);
    if (ranges.length === 0) return transaction;
    const changes: Array<{ from: number; to: number; insert: string }> = [];
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ from, to, insert: inserted.toString() });
    });
    if (changes.length !== 1) return transaction;
    const redirected = redirectChange(transaction.startState.doc, ranges, changes[0]!, transaction.isUserEvent("delete.backward"));
    if (!redirected) return transaction;
    const spec: TransactionSpec = {
      changes: { from: redirected.from, to: redirected.to, insert: redirected.insert },
      selection: EditorSelection.cursor(redirected.cursor),
      effects: transaction.effects,
      scrollIntoView: true,
      annotations: [Transaction.userEvent.of(userEventOf(transaction))],
    };
    return spec;
  });

  return [commentField, hider, protectComments];
}

function userEventOf(transaction: Transaction): string {
  return transaction.annotation(Transaction.userEvent) ?? "input";
}
