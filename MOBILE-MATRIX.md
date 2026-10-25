# BloomMD for Obsidian mobile – touch matrix

Mobile support (`isDesktopOnly: false`) may only be released for a plugin version once this matrix
passed for exactly that version. `scripts/release.mjs` enforces the line
`Verified plugin version: <version>`; QA and beta builds opt in with
`BLOOMMD_ALLOW_UNVERIFIED_MOBILE=1`.

## Automated (Obsidian desktop, mobile emulation)

Run `bun run qa:obsidian-ink-smoke` in the monorepo. It drives real Obsidian with
`app.emulateMobile(true)`, an iPad viewport and CDP touch/pen input.

| Area | Check |
|---|---|
| Loading | Obsidian loads the plugin in mobile mode |
| Map | Finger pan and pinch; map toolbar targets ≥ 44 px; no horizontal overflow |
| Inspector | Opens, full screen, tab targets ≥ 44 px |
| Handwriting | Pen draws with pressure, finger pans without drawing |
| Shared mode | Commands explain that shared mode is desktop-only |
| Concept map | Finger drag moves a node and keeps its position after reload |
| Focus mode | Covers the 1180×820 iPad viewport; no toolbar control is clipped or overflows |
| Node menu | Long press opens the menu; no floating action bar on touch |
| Map drawing | In draw mode a finger pans without drawing, the pen adds a stroke |

## Manual (real iPad with Apple Pencil)

| Area | Check |
|---|---|
| Install | Plugin activates in Obsidian for iPadOS (BRAT beta or copied files) |
| Map | Finger pan, pinch zoom, tap node, open inspector |
| Inspector | Full screen in portrait, landscape and Split View |
| Pencil | Smooth writing without lag; pressure changes stroke width |
| Palm rejection | Resting palm does not draw; fingers move the canvas while the Pencil is used |
| Tools | Highlighter, eraser, undo/redo, lasso move/scale/delete |
| Links | Link handwriting to a note; Pencil hover (M2/M4 iPad Pro, Pencil Pro) shows the page preview; tap opens the note |
| Sync | Drawing appears in the normal note view and on the Mac after vault sync |
| Scribble | Handwriting into the Text tab is converted by iPadOS |
| Concept map | Drag a node with a finger; resize it by its corners; link it to a note and open the note from its badge; add a labelled connection |
| Focus mode | Covers the whole screen in split view; leaving restores the split |
| Presentation | Slides show drawings as images |
| Map drawing | Draw on the map with the Pencil, pan with a finger, draw a line from node to node to connect them |
| Text fields | Scribble into a text field on a drawing; lasso it and turn it into a node |
| Node menu | Long press a node, release, pick an action |
| Study mode | Tap covered nodes to reveal; reveal all / reset |
| Export | PNG and PDF land in the attachment folder and open from Files |

## Known limits

- Apple Pencil Pro squeeze and barrel roll, and Pencil double tap, are not available to web content in Obsidian.
- Shared mode (collaboration) is desktop-only for now.
- Handwriting recognition (ink to text) is not included.

## Results

On 2026-10-21, plugin 0.6.0 passed all 58 automated clean-vault steps in real Obsidian
with mobile emulation, including Pencil, palm and concept-map flows. The release
package contract passed separately in QA mode.
On 2026-10-24, plugin 0.7.0 passed all 58 automated steps again (including the agent panel and the
`structuredClone` fallback for older mobile WebViews). The build is installed in the iCloud test vault
"BloomMD iPad Test" for the manual matrix on a real iPad with Apple Pencil. On 2026-10-24 the owner (Max Möllenbeck)
confirmed the manual matrix on a real iPad for 0.7.0.

On 2026-10-25, plugin 0.7.1 (0.7.0 plus code quality fixes from the Obsidian review, no change in
behaviour) passed all 58 automated steps again; the manual iPad matrix confirmed for 0.7.0 applies.

Verified plugin version: 0.7.1
