# BloomMD for Obsidian

**See an Obsidian note as an editable Markdown map, without moving your files into a new format.**

BloomMD turns Markdown structure into a visual workspace. In Obsidian, this plugin maps the note or folder you already have, lets you work with headings as nodes, and writes structural edits back to normal `.md` files.

The wider BloomMD product is evolving as a local-first Markdown workspace: browser demo, macOS-first desktop beta, Obsidian compatibility, templates, and optional sync/team workflows later. This repository contains the Obsidian companion plugin.

## Current Status

- **Plugin:** public desktop beta for Obsidian.
- **Supported Obsidian runtime:** desktop only for now; mobile is not enabled until touch behavior has been tested on real iOS and Android devices.
- **Source of truth:** your Markdown files remain the source. BloomMD adds a visual layer; it does not create a proprietary workspace format.
- **Product beta:** the BloomMD web/cloud and native desktop app are distributed separately through the closed beta at <https://bloommd.io>.

## What It Does

**Your headings become the map.** `#` becomes the root, `##` its children, and the text under each heading stays as that node's content.

**Structure edits go back into the note.** Rename a node, add a sibling or child, delete a subtree, copy/paste a branch, or reparent a branch; confirmed changes rewrite the same file through Obsidian's Vault API.

**Whole folders can be mapped.** `Visualize current folder` puts notes from the current folder onto one canvas so project structure is visible across files.

**Markdown links become relationships.** External links, `[[wiki links]]`, and linked mentions appear as edges and can be opened from the inspector.

**Layout stays local.** Node positions, viewport, and collapsed branches live in `.obsidian/plugins/bloommd/data.json`. Your Markdown does not accumulate layout metadata.

## File Behavior

Read this before using the plugin in an important vault.

- BloomMD writes to the note you are viewing. Try it on a copy first if the vault is sensitive.
- BloomMD adds one HTML comment per heading, for example `## Goal <!-- bloommd:id=a1b2c3 -->`. These comments give nodes stable IDs and are invisible in Obsidian preview.
- Deleting a BloomMD ID does not break the note. BloomMD will generate a new one when needed.
- Frontmatter, code blocks, HTML blocks, unrelated sections, and text outside headings are preserved.
- Headings inside fenced code, indented code, and HTML blocks are ignored.
- The plugin does not upload vault contents, file names, folder names, node text, Markdown, or layout data.

## Install

### Beta via BRAT

1. Install the **Obsidian42 - BRAT** community plugin.
2. In BRAT, choose **Add Beta Plugin**.
3. Enter `moellenbeck-digital/bloommd-obsidian`.
4. Enable **BloomMD** under Community Plugins.

BRAT keeps the plugin updated as beta releases are tagged.

### Manual

1. Download `manifest.json`, `main.js`, `styles.css`, and `icon.png` from the [latest release](https://github.com/moellenbeck-digital/bloommd-obsidian/releases/latest).
2. Copy them into `<vault>/.obsidian/plugins/bloommd/`.
3. Enable Community Plugins, then enable BloomMD.

## Commands

- `BloomMD: Visualize current note` - also available from the ribbon.
- `BloomMD: Visualize current folder`.
- `BloomMD: Open current note in BloomMD`.

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

## Feedback And Issues

GitHub issue creation may be restricted while the plugin is in beta review and while the public repository mirrors the internal BloomMD development workspace.

For now:

- Use the beta and contact channels linked from <https://bloommd.io> for bugs, feedback, and feature requests.
- Include your Obsidian version, BloomMD plugin version, operating system, and a minimal Markdown example when reporting rendering or editing problems.
- Do not attach private vault content.
- Use [SECURITY.md](SECURITY.md) for vulnerability reports.

## Roadmap

The public product direction is documented on <https://bloommd.io>: local-first Markdown maps, bidirectional editing, templates, Obsidian compatibility, desktop workflows, optional sync, and team/cloud features after the core workflow is stable.

This plugin follows that roadmap as the Obsidian companion layer. Local `TODO` files are not used as a separate source of truth, and this README intentionally avoids linking to private or restricted GitHub project boards.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run release:verify
```

The Markdown engine is covered by unit tests for CommonMark edge cases, including Setext headings, fenced and indented code, HTML blocks, unterminated frontmatter, ATX closing sequences, and heading-depth limits. See [RELEASE.md](RELEASE.md) for the release process.

## Links

- Website and browser demo: <https://bloommd.io>
- Web app: <https://bloommd.app>
- Demo: <https://bloommd.io/demo>
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Privacy: [PRIVACY.md](PRIVACY.md)
- Security: [SECURITY.md](SECURITY.md)

## License

MIT
