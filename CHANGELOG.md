# Changelog

## 0.5.0

- Read Setext headings (`Title` over `===` or `---`) so notes written in that style no longer show an
  empty or truncated mind map.
- Ignore headings inside HTML blocks. BloomMD no longer writes node IDs into a note's raw HTML.
- Treat unterminated frontmatter as ordinary content instead of hiding the whole note.
- Drop the optional ATX closing sequence from titles (`## Title ##`) while keeping a trailing hash
  that has no preceding space (`## Title#`).
- Keep empty ATX headings visible as nodes.
- Replace an existing node id instead of appending a second one. A heading duplicated in the editor
  used to gain one more `bloommd:id` comment on every single open, growing the line without bound.
- Treat tab-indented lines as indented code, matching CommonMark, so `\t## text` is no longer read
  as a heading and no longer receives an id comment.
- Fix a branch move landing outside the target section. When the target's section ended exactly
  where the moved branch began, the splice index was not corrected and the branch was inserted
  after the section, breaking the heading hierarchy.
- Remove the last hard desktop dependency: the optional file handoff is now guarded by
  `Platform.isDesktop` and falls back to the web target everywhere else. The manifest stays
  `isDesktopOnly` until the mobile device test matrix has been executed.

## 0.4.0

- Add Shift multi-select and group dragging on the React Flow canvas.
- Add local branch copy and paste with fresh stable IDs and preserved BloomMD type metadata.
- Add a working setting to show or hide node content previews.
- Package deterministic release assets and validate versions before publishing.
- Declare desktop-only support until mobile Obsidian has completed its own interaction test matrix.

## 0.3.0

- Replace the static map renderer with an interactive React Flow canvas.
- Add free node positioning with local per-note persistence.
- Separate visual dragging from hierarchy changes through connection handles.
- Add cursor zoom, canvas pan, Fit View, focus, minimap, search, and auto layout.
- Add collapse and expand with persisted branch state.
- Add inline title editing and an autosaving Markdown content inspector.
- Add child and sibling creation, keyboard controls, and conflict-safe undo and redo.
- Add external links, Obsidian wiki links, linked mentions, and note switching.
- Add stable BloomMD node IDs while preserving frontmatter and fenced code blocks.
- Keep current-folder visualization available on the shared canvas.

## 0.2.0

- Add grab-to-pan canvas navigation.
- Add node title and Markdown content editing.
- Add child-node creation and confirmed branch deletion.
- Add branch drag-and-drop with automatic heading-level updates.
- Write changes directly to the active local Obsidian note.
- Refresh the mind map when the source note changes in Obsidian.
- Add conflict-protected undo for the latest BloomMD change.
- Preserve frontmatter, fenced code blocks, and unrelated Markdown sections.

## 0.1.0

- Add read-only current note visualization.
- Add current folder visualization.
- Add `Open current note in BloomMD` command without sending Markdown contents.
- Add ribbon button and command palette actions.
- Add privacy-first default settings.
- Add BloomMD-style mind map rendering with positioned nodes, curved edges, focus, and zoom controls.
