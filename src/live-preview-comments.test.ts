import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { hiddenCommentRangesInText, livePreviewCommentsExtension, trailingCommentRange } from "./live-preview-comments";

const ID = "<!-- bloommd:id=node_1 -->";
const META = '<!-- bloommd:meta={"status":"done","tags":["a","b"]} -->';

/** The text a reader sees in Live Preview: the document without the hidden ranges. */
function visible(text: string): string {
  const ranges = hiddenCommentRangesInText(text);
  let result = "";
  let position = 0;
  for (const range of ranges) {
    result += text.slice(position, range.from);
    position = range.to;
  }
  return result + text.slice(position);
}

describe("trailingCommentRange", () => {
  test("hides a bloommd:id comment together with the space in front of it", () => {
    const line = `## Plan ${ID}`;
    expect(trailingCommentRange(line)).toEqual({ from: "## Plan".length, to: line.length });
  });

  test("hides a bloommd:meta comment", () => {
    const line = `## Plan ${META}`;
    expect(trailingCommentRange(line)).toEqual({ from: "## Plan".length, to: line.length });
  });

  test("hides id and meta together, also several meta comments", () => {
    const line = `## Plan ${ID} ${META} ${META}`;
    expect(trailingCommentRange(line)).toEqual({ from: "## Plan".length, to: line.length });
    expect(trailingCommentRange(`## Plan ${META} ${ID}`)).toEqual({ from: "## Plan".length, to: `## Plan ${META} ${ID}`.length });
  });

  test("keeps title text, links and special characters untouched", () => {
    const title = "## Über [[Wiki Link|Alias]] und [Doku](https://example.com/a?b=1#c) — **fett** `code` #tag";
    const line = `${title} ${ID}`;
    const range = trailingCommentRange(line)!;
    expect(line.slice(0, range.from)).toBe(title);
    expect(line.slice(range.to)).toBe("");
  });

  test("tolerates the spacing variants Core accepts and trailing whitespace", () => {
    const line = "# A <!--bloommd:id=x-->  ";
    const range = trailingCommentRange(line)!;
    expect(line.slice(range.from, range.to)).toBe(" <!--bloommd:id=x-->");
    expect(trailingCommentRange("# A <!--   BLOOMMD:ID=x   -->")).not.toBeNull();
  });

  test("a title without comment is left alone", () => {
    expect(trailingCommentRange("## Plain title")).toBeNull();
    expect(trailingCommentRange("## Plain title <!-- ")).toBeNull();
  });

  test("other HTML comments stay visible", () => {
    expect(trailingCommentRange("## Title <!-- TODO later -->")).toBeNull();
    expect(trailingCommentRange("## Title <!-- bloommd:other=1 -->")).toBeNull();
    // Only the BloomMD comment behind a foreign one is hidden.
    const line = `## Title <!-- note --> ${ID}`;
    const range = trailingCommentRange(line)!;
    expect(line.slice(0, range.from)).toBe("## Title <!-- note -->");
  });

  test("only trailing comments count, not ones inside the title or in running text", () => {
    expect(trailingCommentRange(`## Title ${ID} more title`)).toBeNull();
    expect(trailingCommentRange("## Title `<!-- bloommd:id=x -->`")).toBeNull();
    expect(trailingCommentRange(`Running text ${ID}`)).toBeNull();
    expect(trailingCommentRange(`    ## indented code ${ID}`)).toBeNull();
    expect(trailingCommentRange(`#hashtag ${ID}`)).toBeNull();
  });

  test("an empty title keeps the space behind the heading marker", () => {
    const line = `# ${ID}`;
    expect(trailingCommentRange(line)).toEqual({ from: 2, to: line.length });
  });
});

describe("hiddenCommentRangesInText", () => {
  test("hides the comments of every heading and nothing else", () => {
    const text = ["# One " + ID, "", "Body text " + ID, "## Two " + ID + " " + META, "Plain"].join("\n");
    expect(visible(text)).toBe(["# One", "", "Body text " + ID, "## Two", "Plain"].join("\n"));
  });

  test("fenced code blocks keep their comments (backticks and tildes, longer closing fence)", () => {
    const text = ["```md", "## Code " + ID, "```", "~~~~", "## Tilde " + ID, "~~~", "still code " + ID, "~~~~", "## Real " + ID].join("\n");
    expect(visible(text)).toBe(["```md", "## Code " + ID, "```", "~~~~", "## Tilde " + ID, "~~~", "still code " + ID, "~~~~", "## Real"].join("\n"));
  });

  test("a backtick fence with a backtick in the info string is no fence", () => {
    expect(visible("``` a`b\n## T " + ID)).toBe("``` a`b\n## T");
  });

  test("an unclosed fence keeps everything below it", () => {
    expect(visible("```\n## T " + ID)).toBe("```\n## T " + ID);
  });

  test("front matter keeps its comments, the note body after it does not", () => {
    const text = ["---", "title: x # " + ID, "note: " + ID, "---", "# Heading " + ID].join("\n");
    expect(visible(text)).toBe(["---", "title: x # " + ID, "note: " + ID, "---", "# Heading"].join("\n"));
  });

  test("a horizontal rule later in the note is no front matter", () => {
    expect(visible(["# A " + ID, "---", "# B " + ID].join("\n"))).toBe("# A\n---\n# B");
  });

  test("inline code in prose keeps its comment", () => {
    expect(visible("Use `<!-- bloommd:id=x -->` in notes")).toBe("Use `<!-- bloommd:id=x -->` in notes");
  });

  test("a file without BloomMD ids has nothing to hide", () => {
    expect(hiddenCommentRangesInText("# One\n\nText\n\n## Two\n- item\n")).toEqual([]);
    expect(hiddenCommentRangesInText("")).toEqual([]);
  });

  test("CRLF line endings are handled", () => {
    const ranges = hiddenCommentRangesInText(`# One ${ID}\r\n## Two ${ID}\r\n`);
    expect(ranges).toHaveLength(2);
  });

  test("offsets address the document, so they work on later lines", () => {
    const text = `Intro\n\n## Later ${ID}\n`;
    const [range] = hiddenCommentRangesInText(text);
    expect(text.slice(range!.from, range!.to)).toBe(` ${ID}`);
  });
});

// EditorView observes its DOM; the shared test preload only provides window/document.
const domWindow = (globalThis.window ?? {}) as unknown as Record<string, unknown>;
const domGlobals = globalThis as unknown as Record<string, unknown>;
for (const name of ["MutationObserver", "ResizeObserver", "IntersectionObserver"]) {
  if (domGlobals[name] === undefined && domWindow[name] !== undefined) domGlobals[name] = domWindow[name];
}

function editorState(doc: string, livePreview = true, cursor?: number) {
  return EditorState.create({
    doc,
    selection: cursor === undefined ? undefined : EditorSelection.cursor(cursor),
    extensions: [livePreviewCommentsExtension(() => livePreview)],
  });
}

function apply(state: EditorState, spec: Parameters<EditorState["update"]>[0]): Transaction {
  return state.update(spec);
}

describe("decoration layer", () => {
  test("hiding is a pure display change: no transaction touches the document", () => {
    const doc = `# Title ${ID} ${META}\n\nBody\n`;
    const view = new EditorView({ state: editorState(doc) });
    try {
      const atomic = view.state.facet(EditorView.atomicRanges).flatMap((source) => {
        const ranges: Array<{ from: number; to: number }> = [];
        source(view).between(0, doc.length, (from, to) => void ranges.push({ from, to }));
        return ranges;
      });
      expect(atomic).toEqual([{ from: "# Title".length, to: `# Title ${ID} ${META}`.length }]);
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
    }
  });

  test("Source mode shows the raw text: nothing is hidden or atomic", () => {
    const doc = `# Title ${ID}\n`;
    const view = new EditorView({ state: editorState(doc, false) });
    try {
      const atomic = view.state.facet(EditorView.atomicRanges).flatMap((source) => {
        let count = 0;
        source(view).between(0, doc.length, () => void (count += 1));
        return [count];
      });
      expect(atomic.every((count) => count === 0)).toBe(true);
    } finally {
      view.destroy();
    }
  });

  test("a document without BloomMD ids has no atomic ranges", () => {
    const doc = "# Plain\n\n## Also plain <!-- user comment -->\n";
    const view = new EditorView({ state: editorState(doc) });
    try {
      for (const source of view.state.facet(EditorView.atomicRanges)) {
        let count = 0;
        source(view).between(0, doc.length, () => void (count += 1));
        expect(count).toBe(0);
      }
    } finally {
      view.destroy();
    }
  });
});

describe("editing next to a hidden comment keeps the comment", () => {
  const title = "# Title";
  const doc = `${title} ${ID}\n\nBody\n`;
  const end = `${title} ${ID}`.length;

  test("typing at the end of the line inserts into the title, before the comment", () => {
    const state = editorState(doc, true, end);
    const next = apply(state, { changes: { from: end, insert: "x" }, selection: EditorSelection.cursor(end + 1), userEvent: "input.type" }).state;
    expect(next.doc.toString()).toBe(`${title}x ${ID}\n\nBody\n`);
    expect(next.selection.main.head).toBe(title.length + 1);
  });

  test("Backspace at the end of the line deletes the last title character, not the comment", () => {
    const from = title.length;
    const state = editorState(doc, true, end);
    // The atomic range makes the editor delete the whole hidden range.
    const next = apply(state, { changes: { from, to: end }, selection: EditorSelection.cursor(from), userEvent: "delete.backward" }).state;
    expect(next.doc.toString()).toBe(`# Titl ${ID}\n\nBody\n`);
    expect(next.selection.main.head).toBe(title.length - 1);
  });

  test("Delete in front of the comment does not remove it", () => {
    const from = title.length;
    const state = editorState(doc, true, from);
    const next = apply(state, { changes: { from, to: end }, userEvent: "delete.forward" }).state;
    expect(next.doc.toString()).toBe(doc);
  });

  test("Enter at the end of the line still opens a new line behind the comment", () => {
    const state = editorState(doc, true, end);
    const next = apply(state, { changes: { from: end, insert: "\n" }, selection: EditorSelection.cursor(end + 1), userEvent: "input" }).state;
    expect(next.doc.toString()).toBe(`${title} ${ID}\n\n\nBody\n`);
  });

  test("typing inside the title and edits on other lines are not redirected", () => {
    const state = editorState(doc, true, 2);
    const next = apply(state, { changes: { from: 2, insert: "z" }, userEvent: "input.type" }).state;
    expect(next.doc.toString()).toBe(`# zTitle ${ID}\n\nBody\n`);
    const body = apply(next, { changes: { from: next.doc.length - 1, insert: "!" }, userEvent: "input.type" }).state;
    expect(body.doc.toString()).toBe(`# zTitle ${ID}\n\nBody!\n`);
  });

  test("selecting and deleting a whole heading line is a normal edit", () => {
    const state = editorState(doc, true, 0);
    const next = apply(state, { changes: { from: 0, to: end + 1 }, userEvent: "delete.selection" }).state;
    expect(next.doc.toString()).toBe("\nBody\n");
  });

  test("undo, redo and programmatic changes are never redirected", () => {
    const state = editorState(doc, true, end);
    const programmatic = apply(state, { changes: { from: end, insert: " tail" } }).state;
    expect(programmatic.doc.toString()).toBe(`${doc.slice(0, end)} tail${doc.slice(end)}`);
    const undone = apply(state, { changes: { from: end, insert: "x" }, userEvent: "undo" }).state;
    expect(undone.doc.toString()).toBe(`${doc.slice(0, end)}x${doc.slice(end)}`);
  });

  test("in Source mode edits are not redirected", () => {
    const state = editorState(doc, false, end);
    const next = apply(state, { changes: { from: end, insert: "x" }, userEvent: "input.type" }).state;
    expect(next.doc.toString()).toBe(`${doc.slice(0, end)}x${doc.slice(end)}`);
  });
});

describe("round trip", () => {
  test("the document keeps exactly the same comments after display and edits elsewhere", () => {
    const doc = [`# One ${ID}`, "", `## Two ${ID.replace("node_1", "node_2")} ${META}`, "", "Text", ""].join("\n");
    const comments = (text: string) => text.match(/<!--[\s\S]*?-->/g);
    const view = new EditorView({ state: editorState(doc) });
    try {
      view.dispatch({ changes: { from: doc.indexOf("Text"), insert: "More " }, userEvent: "input.type" });
      expect(comments(view.state.doc.toString())).toEqual(comments(doc));
    } finally {
      view.destroy();
    }
  });
});
