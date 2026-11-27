# Changelog

## 0.8.0

### Navigation / Navigation

- Die Suche findet geladene Knoten über Titel und Dateipfad, klappt Vorfahren auf und zentriert den Treffer. Sie bleibt auch in schmalen Touch-Ansichten erreichbar. Große Ordnerübersichten starten eingeklappt.
- Fehler einer Inhaltsvorschau lassen den Dateiknoten sichtbar; Ladehinweise können ausgeblendet und die Vorschau erneut geladen werden. Noch nicht geladene Inhalte werden nicht durchsucht.
- Search finds loaded nodes by title and file path, expands ancestors and centers the result, including narrow touch panes. Large folder overviews start collapsed.
- Failed content previews retain their file node with dismissible guidance and retry. Contents that have not been loaded are not searched.


### Map

- New optional **Backlink edges** mode (header button and command **Toggle backlink edges**, off by default, saved per map or folder): a dashed arrow runs from a node to every node it links to (`[[#Heading]]`, `[[Note#Heading]]`, a BloomMD node id as the fragment; in folder maps from file to file). It is display only and never writes to the note. Broken or ambiguous links are not guessed: the node shows a warning badge with the link and the reason. Image and map exports are unchanged.

### Fixes

- The map view no longer stays blank after **Visualize current note**: the map is fitted once the view has a size (a freshly split or hidden pane is not laid out yet), and a map restored with the workspace is reused instead of opening a second one.
- If opening, loading or rendering a map fails, the view shows what went wrong with **Back to Markdown** (and **Try again**) instead of an empty pane. An empty view and a note without headings now offer **Back to Markdown** too, and the button also works in folder mode.
- Renaming a node (or typing the title of a new node) no longer loses the first characters when typing starts right after the double click: the title field re-selected its text 50 ms after opening, so the next character replaced what had just been typed. It now only does that while nothing has been typed yet.

### Live Preview

- The `<!-- bloommd:id=… -->` and `<!-- bloommd:meta=… -->` comments BloomMD writes behind headings are now hidden in Live Preview, so notes no longer look cluttered. The file is not changed: the comments stay exactly as they are, and Source mode still shows them. Other HTML comments in your notes stay visible. The cursor skips the hidden part, and typing or deleting at the end of a heading never removes the comment.

### Templates

- New command **New note from template**: pick one of five built-in templates (Lecture, Cornell, Literature note, Exam prep, Project; German when Obsidian is set to German, English otherwise) or one of your own, enter a name, and the note is created in the folder Obsidian uses for new notes next to the active file (a name with `/` goes into a sub-folder) and opened. Only `{{title}}` and `{{date}}` (`YYYY-MM-DD`) are replaced; other `{{…}}` stay as written.
- Your own templates are the Markdown files directly inside the vault folder **Template folder** (Settings, default `Vorlagen`); sub-folders are not searched, and without the folder only the built-in templates appear.

### Navigator

- New **BloomMD navigator** side view (ribbon icon, command **Open navigator**): the vault as a folder tree with open/close folders and the Markdown notes of the selected folder in a separate list. Click or `Enter` opens a note; the map is one step away (**Map of the selected note / folder**, or `M`) and is never loaded for the whole vault.
- **Show active file in navigator** (`Cmd/Ctrl+Shift+R`) opens the folders on the way, scrolls to the note, selects and focuses it. The navigator also follows the active note while you work.
- Keyboard model with explicit focus areas (tree, list, map): `↑`/`↓`, `←`/`→`, `Enter`, `Tab`, `Esc`; back and forward through the navigation history with `Cmd/Ctrl+[` and `Cmd/Ctrl+]` or the buttons in the header. The header shows where you are browsing and which map is open as two separate lines; a built-in help lists all shortcuts. New command **Focus navigator** brings focus back from the map.
- Folder tree and note list only render the rows in view, so large vaults stay responsive.
- `Esc` in the map now returns focus to the list or tree the map was opened from (with `M` or the header buttons), as the help says, instead of landing in the editor. The existing `Esc` chain list → tree → editor is unchanged.
- At the end of the navigation history the focus no longer falls onto the page: when **Back** or **Forward** (click, `Cmd/Ctrl+[` or `Cmd/Ctrl+]`) reaches the end and the button is disabled, focus moves to the other button if it is usable, otherwise to the list or tree.
- Opening a map of a note (`M` or **Open map of the selected note**, **Visualize current note**) no longer writes to the note. The `<!-- bloommd:id=… -->` comments are written with the first edit made in the map; until then the map shows the same ids it will write, so layout, learning progress and undo behave as before. Notes shared with a workspace still get them when sharing starts.

## 0.7.1

Code quality fixes from the Obsidian community plugin review; no change in behaviour.

- Styles of the map pen toolbar are set with `setCssStyles`, animation frames use `window.requestAnimationFrame` (popout windows), DOM elements are created with Obsidian's `createEl`/`createDiv`, cross-window `instanceOf` checks, `instanceof TFile` instead of a cast.
- The settings tab refreshes with `update()` (Obsidian 1.13 declarative settings) instead of the deprecated `display()`.
- Stricter type checking (`noUncheckedIndexedAccess`, as in the rest of BloomMD); unnecessary type assertions removed.

## 0.7.0

BloomMD 0.7.0 is the first public release since 0.5.12 and includes everything from 0.6.0, which was not published separately. It is the first version for Obsidian on iPad, iPhone and Android as well as desktop.

### Devices and compatibility

- Runs on Obsidian 1.13 or later on macOS, Windows, Linux, iPadOS, iOS and Android. `isDesktopOnly` is off; desktop-only parts (shared mode, **Open app**) are hidden or explained on mobile.
- No Node or Electron APIs in the plugin; older mobile WebViews without `structuredClone` (iOS/iPadOS before 15.4, old Android System WebView) get a built-in fallback.

### Learning progress

- Learning progress in study mode: rate revealed nodes with Apple Pencil, finger, mouse or keys `1`–`5` (3 or 5 levels with your own names); nodes show their level as border, fill tint or badge, the study bar shows mastered and due counts, a study order (due first, only due, only unsure) and an optional exam date with a daily plan. Optional spaced repetition with per-level intervals and a growing interval for repeated top ratings. Progress lives in `.bloommd/learning/` in the vault, never in the note, merges node by node across devices and follows note renames. Configure everything under Settings → Learning, including a reset for the current map.

### Agent panel

- New **BloomMD agent** side view (ribbon icon with a count of open proposals, command **Open agent panel**) for agents such as OpenClaw that file notes through `bloommd-wiki agent mcp`.
- Review the agent's proposals with an outline diff and the full text; approve them (applied through the Vault API, refused or offered as **Apply anyway** when the note changed since) or reject them with an optional reason. A notice announces new proposals.
- **Ask agent…** in the node menu and **Ask agent about current note** leave requests in `.bloommd/requests/`; the agent's answers and resulting proposals show in the panel.
- The history lists the agent's changes and approvals; **Undo** restores the previous state after a confirmation and a conflict check.
- Agent rights per top-level folder (read, propose, write) can be edited in the panel.
- Map nodes the agent wrote or a person approved since the map was last opened on this device carry a small purple dot.
- Proposals, history, log and rights follow the same shared rules as the `bloommd-wiki agent` commands; agent state is read through the vault adapter, so the panel works on iPad too.

## 0.6.0 (included in 0.7.0, not published separately)

BloomMD 0.6.0 brings handwriting to the node inspector and opens the plugin for Obsidian on iPad (beta).

- The plugin stays under the MIT license (the rest of BloomMD uses the Elastic License 2.0).

- Write and sketch with Apple Pencil, mouse or finger in a new **Handwriting** tab of the node inspector. The pen draws with pressure, fingers pan and pinch, and a resting palm is ignored while the pen is down.
- Pen, highlighter, stroke eraser, five colors, three widths, undo/redo and fit-to-drawing; a lasso moves, scales, recolors and deletes handwriting.
- Drawings are ordinary SVG files in the vault's attachment folder, embedded into the node as `![[… ink.svg]]`. Obsidian shows them everywhere, also without the plugin; the plugin reopens them losslessly for editing. Saving only replaces a drawing that did not change on another device.
- Link handwriting to a note: the link is stored in the drawing and added once as `[[note]]` to the node. Hovering linked handwriting with a mouse or Apple Pencil shows Obsidian's page preview; clicking opens the note. Renaming a linked note updates drawings too.
- Map nodes preview their first drawing; the inspector can switch to full screen and does so automatically for drawing in a narrow panel.
- Obsidian mobile: `isDesktopOnly` is lifted for touch-verified builds. Touch targets are at least 44 px and icons keep their size in Obsidian's tablet theme. Shared mode stays desktop-only and says so on mobile.
- Concept map: link a node to a note (badge on the node opens it; hover shows Obsidian's page preview), connect any two nodes with optional labels beyond the heading structure, and resize nodes. Positions and sizes are kept per note; links and connections are stored in the node Markdown and survive editing in the BloomMD apps.
- Focus mode covers the whole Obsidian window, including split view on iPad; the toolbar wraps instead of clipping tools in narrow panes.
- Presentation mode renders node content like Obsidian, so drawings show as images and links work.
- Draw directly on the map with Apple Pencil or mouse; fingers keep panning. A stroke from one node to another creates a connection.
- The pen operates the whole map in draw mode: tap selects a node, double tap opens it, hold opens its menu, hold and drag moves it, a straight line from a node into free space adds a child there, a zigzag scratches ink out, and lassoed map ink becomes a node.
- Writing never moves the page: Apple Pencil's touch events no longer pan the map or drag the node under the pen, and a hand that rests on the glass (even a moment before the pen tip) is ignored until it lifts.
- Escape that closes an Obsidian menu no longer also leaves focus or draw mode.
- **Open app** opens the note in BloomMD Desktop at the selected node: a running app takes it over its local handoff channel and comes to the front, otherwise the app starts with the note (macOS, and Linux with the installed package; on Windows start BloomMD Desktop first). Notices say honestly what happened and link to the download when the app cannot be found. The button is hidden on iPad and iPhone until a BloomMD app exists there.
- Text fields on drawings: write into them with Apple Pencil and iPadOS Scribble turns it into typed text. Lassoed handwriting can become a new child node.
- Drawings choose paper, dark or transparent backgrounds and follow the Obsidian theme.
- Long press (iPad) or right click opens a node menu; the floating action bar no longer covers neighbouring nodes.
- Study mode covers node contents until tapped; export the whole map as PNG or PDF.
- The automatic layout is a lightweight tree layout that respects real node sizes; new nodes never cover nodes placed by hand.
- Image embeds no longer count as wikilinks or appear as text in node previews.
- The plugin imports only the Obsidian Markdown module from BloomMD Core, which keeps `main.js` within the 600 KiB budget.

## 0.5.12

BloomMD 0.5.12 fixes shared-document auditing for local Obsidian notes.

- Use the server-issued workspace document UUID for sharing audits instead of the Markdown frontmatter ID.
- Keep local Markdown IDs independent from workspace records, so ordinary notes can be shared and bound without an avoidable audit failure.
- Cover both a newly shared note and an existing shared-document binding where the two IDs intentionally differ.
- Run the standalone mirror's Node tests with a real DOM so the browser-safe Markdown runtime is verified before publication.

## 0.5.11

BloomMD 0.5.11 removes the remaining Obsidian Community review warnings from the 0.5.10 release.

- Load the optional collaboration runtime through a native dynamic import instead of `require()`.
- Keep Obsidian command names concise and remove the redundant plugin name from sharing commands.
- Use callback function properties and remove unnecessary parser assertions for safer type checking.
- Keep the local choice modal on Obsidian's `createEl` helpers and add release checks to prevent these regressions.

## 0.5.10

BloomMD 0.5.10 is a release-contract patch for the shared-document binding release.

- Publish an immutable release tag whose mirror manifest consistently identifies the reviewed canonical source snapshot.
- Keep the 0.5.9 shared-document binding and local layout persistence behavior unchanged.

## 0.5.9

BloomMD 0.5.9 completes a safe handoff for shared notes and keeps local map state durable.

- Choose explicitly whether Obsidian should create a new shared document or bind the current note to an existing one in the selected workspace.
- Prevent an already shared note from being uploaded as a same-named duplicate cloud document.
- Keep the local Markdown file private to the vault: only the selected workspace document identity is bound, and existing remote content is still handled through the normal conflict flow.
- Persist canvas layout changes after moving nodes, changing views, collapsing branches, or updating the viewport.
- Keep the layout persistence path compatible with the existing file/folder rename migration.

## 0.5.8

BloomMD 0.5.8 makes the collaboration-ready Obsidian beta safer to install and maintain.

- Preserve the local canvas layout and explicit sharing binding when a Markdown file or folder is renamed.
- Reconnect an active shared note with its new vault-local path without changing its cloud document, token, or workspace rights.
- Build the clean-vault QA plugin release from the canonical source, including the optional collaboration runtime.
- Keep the public release mirror from treating generated runtime bundles as hand-maintained source files.

## 0.5.7

BloomMD 0.5.7 aligns keyboard navigation and focus handling across the Obsidian, Web, and Desktop experiences.

- Start inline renaming immediately after creating a child or sibling node.
- Keep focus on the same node after confirming or cancelling a rename.
- Focus the parent after deleting a branch with `Delete` or `Backspace`.
- Keep focus useful after undo/redo, including when undo removes a newly-created node.
- Add `R` as a rename shortcut alongside `F2` and document the focus behavior in the shortcut help.
- Add accessible node identity and treeitem semantics to map and outline nodes.

## 0.5.6

BloomMD 0.5.6 hardens the public beta against Obsidian Community review findings.

- Limit Markdown and resource listings to the active note's folder tree instead of enumerating the entire vault.
- Remove the two unnecessary type assertions reported by the review.
- Add GitHub artifact provenance attestations for the supported release assets.
- Keep `icon.png` in the repository root for branding without attaching it as an unsupported release asset.

## 0.5.5

BloomMD 0.5.5 is a maintenance release that aligns the plugin with the canonical BloomMD Markdown contract.

- Use the shared, browser-safe Markdown parser and structural operations from `@bloommd/core/browser`.
- Keep CommonMark- and Obsidian-compatible round-tripping for frontmatter, Setext headings, fenced and indented code, HTML blocks, CRLF files, links, stable IDs, and node metadata.
- Keep branch moves, copies, renames, sibling/child creation, deletion, and content edits on the same lossless Markdown operations used by the BloomMD workspace.
- Publish the plugin from the reproducible monorepo-to-mirror release path with source and Core hash evidence.
- Keep the plugin local-only, desktop-only, and free of telemetry or vault uploads.

## 0.5.4

BloomMD 0.5.4 is a small public beta patch for the Obsidian Community Directory.

- Add a dedicated BloomMD plugin icon based on a Markdown note branching into map relationships.
- Include the icon in packaged and GitHub release assets.

## 0.5.3

BloomMD 0.5.3 is a maintenance release for the public desktop beta.

- Fix Obsidian review blockers by keeping workspace leaves in their user-selected locations during unload.
- Replace the browser confirmation with Obsidian's native branch-delete confirmation dialog.
- Use Obsidian's supported command naming and declarative settings APIs.
- Raise the minimum Obsidian version to 1.13.0 for the APIs used by the plugin.
- Bundle React 18 to avoid dynamic script resource injection in the plugin bundle.
- Keep node editing, Markdown round-tripping, and local-only processing unchanged.

## 0.5.2

- Add a visible Node title field to the inspector so newly created nodes can be named directly.
- Focus and select the title field automatically for new `New node` placeholders.
- Persist title edits through the same conflict-safe Markdown roundtrip as other node changes.

## 0.5.1

- Fix duplicate child creation when pressing `Tab` on a heading node.
- Stop keyboard-event bubbling, ignore held-key repeats, and prevent concurrent child mutations for the same source node.

## 0.5.0

BloomMD 0.5.0 is the first public desktop beta. It turns an existing Markdown note or folder into an editable map and writes structural changes back to the same Markdown files.

Included:

- Current-note and current-folder visualization.
- Editable mind maps with rename, add sibling/child, branch moves, branch deletion, copy/paste, and undo/redo.
- Round-trip Markdown editing with frontmatter, code blocks, unrelated sections, and stable node IDs preserved.
- External Markdown links, Obsidian wiki links, linked mentions, and relationship previews.
- Local-only processing with no telemetry, vault upload, or Markdown content in URL parameters.
- Separate local layout and viewport state stored in Obsidian plugin data.
- BRAT-ready public beta distribution for desktop Obsidian.

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
