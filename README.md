# BloomMD for Obsidian

> [!IMPORTANT]
> **Public release mirror — implementation changes are maintained in the monorepo.**
>
> The authoritative source code and development work live in the [BloomMD monorepo](https://github.com/moellenbeck-digital/BloomMD). This repository exists for public Obsidian release artifacts and distribution through BRAT. Use [Issues](https://github.com/moellenbeck-digital/bloommd-obsidian/issues) for user-facing plugin bugs and compatibility reports; implementation pull requests belong in the monorepo.

**See an Obsidian note as an editable Markdown map, without moving your files into a new format.**

BloomMD turns Markdown structure into a visual workspace. In Obsidian, this plugin maps the note or folder you already have, lets you work with headings as nodes, and writes structural edits back to normal `.md` files.

The wider BloomMD product is evolving as a local-first Markdown workspace: browser demo, macOS-first desktop beta, Obsidian compatibility, templates, and optional sync/team workflows later. This repository contains the Obsidian companion plugin.

## Current Status

- **Plugin:** public desktop beta for Obsidian.
- **Supported Obsidian runtime:** desktop and mobile (beta). Mobile releases require a passed touch matrix for the exact version, see [MOBILE-MATRIX.md](MOBILE-MATRIX.md); shared mode stays desktop-only for now.
- **Source of truth:** your Markdown files remain the source. BloomMD adds a visual layer; it does not create a proprietary workspace format.
- **Product beta:** the BloomMD web/cloud and native desktop app are distributed separately through the closed beta at <https://bloommd.io>.

## What It Does

**Your headings become the map.** `#` becomes the root, `##` its children, and the text under each heading stays as that node's content.

**Structure edits go back into the note.** Rename a node, add a sibling or child, delete a subtree, copy/paste a branch, or reparent a branch; confirmed changes rewrite the same file through Obsidian's Vault API.

**Whole folders can be mapped.** `Visualize current folder` puts notes from the current folder onto one canvas so project structure is visible across files.

**Markdown links become relationships.** External links, `[[wiki links]]`, and linked mentions appear as edges and can be opened from the inspector.

**Layout stays local.** Node positions, viewport, and collapsed branches live in `.obsidian/plugins/bloommd/data.json`. Your Markdown does not accumulate layout metadata.

**Renaming stays coherent.** Renaming a note or folder in Obsidian carries its local map layout and any explicit sharing binding to the new vault-relative path. Markdown, cloud document identity, tokens, and workspace rights are unchanged.

**Sharing is explicit.** A note remains entirely local until you choose to share that individual note with a BloomMD workspace. Shared changes are synchronized as Markdown/Yjs updates; the local vault path and layout data stay local.

## File Behavior

Read this before using the plugin in an important vault.

- BloomMD writes to the note you are viewing. Try it on a copy first if the vault is sensitive.
- BloomMD adds one HTML comment per heading, for example `## Goal <!-- bloommd:id=a1b2c3 -->`. These comments give nodes stable IDs and are invisible in Obsidian preview.
- Deleting a BloomMD ID does not break the note. BloomMD will generate a new one when needed.
- Frontmatter, code blocks, HTML blocks, unrelated sections, and text outside headings are preserved.
- Headings inside fenced code, indented code, and HTML blocks are ignored.
- The plugin does not upload vault contents, file names, folder names, node text, Markdown, or layout data by default.
- If you explicitly share a note, its Markdown and a cloud-safe document name are synchronized with the selected BloomMD workspace. Its local vault path, folder structure, and layout data are never sent.

## Optional Collaboration

Collaboration is opt-in for each note. It is useful when a local Obsidian note should be edited with
the same people who use a BloomMD workspace; it does not turn the complete vault into a cloud vault.

1. In **Settings → BloomMD**, set the BloomMD app URL if you do not use `https://bloommd.app`.
2. Add a BloomMD collaboration access token using **Collaboration access token**. Obsidian stores it
   in its native secret storage, not in `data.json`. Leave the workspace ID empty to use your default
   workspace, or enter the workspace ID explicitly.
3. Open the Markdown note and run **BloomMD: Share current note with BloomMD workspace** from the
   command palette.
4. The BloomMD view shows **Shared · connected**, **offline**, **conflict needs attention**, or
   **access revoked**. Only the note you explicitly shared is synchronized.
5. Run **BloomMD: Stop sharing current note with BloomMD workspace** to remove the local binding.
   The local Markdown file remains untouched; the existing cloud document is retained so that its
   workspace history is not silently destroyed.

While offline, edits remain local and are offered to the shared mirror after the connection returns.
If access is revoked, the plugin stops writing remote updates and requires a new explicit share.

## Agent Panel

If an AI agent such as OpenClaw files notes into this vault through `bloommd-wiki agent mcp`, the
**BloomMD agent** panel (robot icon in the ribbon, or **Open agent panel**) is where you stay in
charge. Everything lives in the vault's `.bloommd/` folder, works on desktop and iPad, and follows
the same rules as the `bloommd-wiki agent` commands.

- **Proposals:** what the agent wants to change, with agent, time, note, reason and source, plus an
  outline of added (+), changed (~) and removed (-) headings and the full text. **Approve** writes
  it through Obsidian; if the note changed since the proposal, the panel shows the difference and you
  choose **Apply anyway** or **Reject**. Rejecting takes an optional reason for the agent. The ribbon
  icon counts open proposals and a notice appears when a new one arrives.
- **Requests:** **Ask agent…** in a node's menu on the map (or **Ask agent about current note**)
  leaves a question or instruction in `.bloommd/requests/`. The agent picks it up with
  `bloommd_requests`, answers with `bloommd_answer_request`, and its answer appears here; changes it
  makes for the request follow its rights (direct or as proposal).
- **History:** the change log with who, what and when. **Undo** restores a note as it was before an
  agent change or an approved proposal (after a confirmation, and only if nobody edited it since).
- **Map marker:** nodes the agent changed since you last opened a map on this device carry a small
  purple dot.
- **Rights:** the default and one rule per top-level folder: *read*, *propose* (changes wait for
  you) or *write* (direct, with log and undo). Without a rule file the agent may only propose.

Only a person can approve: the agent has no tool for it. Nothing is sent anywhere by the plugin; the
agent reads and writes the vault folder itself.

## Install

### Beta via BRAT

1. Install the **Obsidian42 - BRAT** community plugin.
2. In BRAT, choose **Add Beta Plugin**.
3. Enter `moellenbeck-digital/bloommd-obsidian`.
4. Enable **BloomMD** under Community Plugins.

BRAT keeps the plugin updated as beta releases are tagged.

### Manual

1. Download `manifest.json`, `main.js`, `shared-runtime.js`, `styles.css`, and `icon.png` from the [latest release](https://github.com/moellenbeck-digital/bloommd-obsidian/releases/latest).
2. Copy them into `<vault>/.obsidian/plugins/bloommd/`.
3. Enable Community Plugins, then enable BloomMD.

## Commands

- `BloomMD: Visualize current note` - also available from the ribbon.
- `BloomMD: Visualize current folder`.
- `BloomMD: Open current note in BloomMD` - opens the note in BloomMD Desktop at the selected node (also the **Open app** toolbar button). A running app takes the note on every platform; macOS and Linux (installed package) also start the app when needed, on Windows start BloomMD Desktop first.
- `BloomMD: Share current note with BloomMD workspace`.
- `BloomMD: Stop sharing current note with BloomMD workspace`.
- `BloomMD: Open agent panel` - also available from the ribbon.
- `BloomMD: Ask agent about current note`.

## Editing

| Action | How |
|---|---|
| Pan / zoom | Drag empty canvas; use wheel or trackpad to zoom at the cursor |
| Move a node visually | Drag the node body |
| Reparent a branch | Drag the orange handle from a parent onto another node |
| Rename | Double-click or press `F2` |
| Add child / sibling | Node toolbar, or `Tab` / `Enter` |
| Multi-select | Hold `Shift`, then drag the selection |
| Copy / paste a branch | `Cmd/Ctrl+C`, select destination, then `Cmd/Ctrl+V` |
| Undo / redo | `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` |
| Edit content | Open the inspector; edits autosave and detect external changes |
| Pen on the map (draw mode) | Tap selects, double tap opens, hold opens the menu, hold and drag moves; a line from a node into free space adds a child, node to node connects, a zigzag scratches ink out |

## Learning Progress

Study mode (hat icon) covers node contents until you reveal them. With **Learning progress** on
(Settings → BloomMD → Learning, on by default), every revealed node offers rating buttons — by
default **New**, **Unsure** and **Got it**, or five levels with your own names. Tap them with Apple
Pencil or a finger, click them, or press `Space` to reveal the selected node and `1`–`5` to rate it
(the keyboard then moves on to the next node of the session).

- **On the map:** nodes show their level as a colored border, a fill tint or a badge (or nothing);
  colors are configurable per level. Due nodes get a **Due** marker; optional branch progress shows
  mastered/total on every node with children.
- **Study bar:** `12/30 mastered · 5 due`, the study order (**Due first**, **Map order**, **Only due**,
  **Only unsure**), **Next**, and an optional exam date with days left and how many not-yet-mastered
  nodes to cover per day.
- **Spaced repetition** (optional, on by default): every level has an interval in days (defaults
  New 0, Unsure 1, Got it 4). A rated node is due again on the rating day plus its interval. Each
  further top rating in a row multiplies the top interval by the growth factor (default 2.5:
  4 → 10 → 25 → 63 days, at most 180); any lower rating resets that streak.
- **Storage:** progress is personal and never changes the note. It is stored in the vault at
  `.bloommd/learning/<key>.json`, so it syncs with the vault (for example iCloud) between Mac and
  iPad. The key is the note's frontmatter `id` when it has one, otherwise a hash of its path; a
  path-keyed file moves along when the note is renamed in Obsidian. Inside, ratings are keyed by
  the nodes' `bloommd:id`, so renaming or moving a node keeps its progress. Every save merges node by
  node with the file on disk (the newer rating wins), so sessions on two devices do not overwrite
  each other. **Obsidian Sync** does not sync hidden folders; progress then stays per device.
- **Reset progress for the current map** in the settings clears its ratings and exam date on all
  devices after a confirmation.

## Feedback And Issues

Use [GitHub Issues](https://github.com/moellenbeck-digital/bloommd-obsidian/issues) for plugin bugs and compatibility reports. Use the beta and contact channels linked from <https://bloommd.io> for product feedback, feature requests, and private reports.

- Include your Obsidian version, BloomMD plugin version, operating system, and a minimal Markdown example when reporting rendering or editing problems.
- Do not attach private vault content.
- Use [SECURITY.md](SECURITY.md) for vulnerability reports.

## Roadmap

The public product direction is documented on <https://bloommd.io>: local-first Markdown maps, bidirectional editing, templates, Obsidian compatibility, desktop workflows, optional sync, and team/cloud features after the core workflow is stable.

This plugin follows that roadmap as the Obsidian companion layer. Local `TODO` files are not used as a separate source of truth, and this README intentionally avoids linking to private or restricted GitHub project boards.

## Release verification

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run release:verify
```

This checkout is a public release mirror. Development changes belong in the [BloomMD monorepo](https://github.com/moellenbeck-digital/BloomMD); the commands above verify a generated public snapshot. The Markdown engine is covered by unit tests for CommonMark edge cases, including Setext headings, fenced and indented code, HTML blocks, unterminated frontmatter, ATX closing sequences, and heading-depth limits. See [RELEASE.md](RELEASE.md) for the release process.

## Links

- Website and browser demo: <https://bloommd.io>
- Web app: <https://bloommd.app>
- Demo: <https://bloommd.io/demo>
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Privacy: [PRIVACY.md](PRIVACY.md)
- Security: [SECURITY.md](SECURITY.md)

## License

BloomMD for Obsidian is licensed under the [MIT License](LICENSE), including the
shared BloomMD Core snapshots (`src/markdown-document.ts`, `src/core-types.ts`) that the
public mirror carries for each release. The rest of BloomMD (apps, sync server and the
monorepo) is licensed under the Elastic License 2.0; see https://bloommd.io/lizenz.
