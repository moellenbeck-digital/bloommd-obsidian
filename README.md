# BloomMD

**Turn any note into an editable mind map — without a second file format.**

Most mind map plugins render your note into a separate view, or store the map in their own file. BloomMD edits the note itself. Drag a branch and the heading hierarchy in your Markdown changes. Close the plugin and you are left with a normal `.md` file that still works in Obsidian, Git, and any text editor.

BloomMD is a public desktop beta for Obsidian. It turns the note you already have into an editable visual map while keeping Markdown portable.

## What it does

**Your headings are the map.** `#` becomes the root, `##` its children, and the text under each heading stays as that node's content. Nothing is duplicated and nothing is generated on the side.

**Structure edits go back into the note.** Reparent a branch, add a sibling, rename a node, delete a subtree — each confirmed action rewrites the same file through the Obsidian Vault API. Frontmatter, unrelated sections, and the rest of your formatting stay exactly as they were.

**Whole folders, not just one note.** `Visualize current folder` maps a folder and its notes as one canvas, so you can see how a project hangs together instead of opening files one at a time.

**Your links become edges.** External links, `[[wiki links]]`, and linked mentions are visible on the canvas and openable from the inspector.

**Layout stays out of your Markdown.** Node positions, viewport, and collapsed branches live in `.obsidian/plugins/bloommd/data.json`. Your note never accumulates layout noise.

## Editing

| Action | How |
|---|---|
| Pan / zoom | Drag empty canvas · wheel or trackpad zooms at the cursor |
| Move a node visually | Drag the node body (does not change hierarchy) |
| Reparent a branch | Drag the orange handle from a parent onto another node |
| Rename | Double-click or `F2` |
| Add child / sibling | Node toolbar, or `Tab` / `Enter` |
| Multi-select | Hold `Shift`, then drag the selection together |
| Copy / paste a branch | `Cmd/Ctrl+C` → select destination → `Cmd/Ctrl+V` |
| Undo / redo | `Cmd/Ctrl+Z` · `Cmd/Ctrl+Shift+Z` (conflict-protected) |
| Edit content | Open the inspector — autosaves, detects external edits |

## What BloomMD does to your files

This is the part worth reading before you install anything into a real vault.

- **It writes to the note you are viewing.** That is the point of the plugin, but it means it is not read-only. Try it on a copy first if your vault is precious.
- **It adds one HTML comment per heading** — `## Goal <!-- bloommd:id=a1b2c3 -->`. These are valid Markdown comments, invisible in preview, and give nodes a stable identity so links and layouts survive edits. Delete them and nothing breaks; BloomMD just generates new ones.
- **It leaves everything else alone.** Frontmatter, code blocks, HTML blocks, and text outside headings are untouched. Headings inside fenced code and HTML blocks are correctly ignored — they are not turned into nodes and never receive an ID comment.
- **It never uploads anything.** No telemetry, no vault contents, no file names, no Markdown in URL parameters. Everything runs locally against the Vault API.

## Install

### Beta via BRAT (recommended)

1. Install the **Obsidian42 - BRAT** community plugin.
2. In BRAT: *Add Beta Plugin* → `moellenbeck-digital/bloommd-obsidian`
3. Enable **BloomMD** under Community Plugins.

BRAT keeps the plugin updated as new beta releases are tagged.

### Manual

1. Download `manifest.json`, `main.js`, and `styles.css` from the [latest release](https://github.com/moellenbeck-digital/bloommd-obsidian/releases/latest).
2. Copy them into `<vault>/.obsidian/plugins/bloommd/`.
3. Enable Community Plugins, then enable BloomMD.

> **Desktop only for now.** The plugin has no hard desktop dependency left, but mobile is not enabled until the iOS and Android touch matrix has been tested on real devices. Supported: macOS, Windows, Linux.

## Commands

- `BloomMD: Visualize current note` — also on the ribbon
- `BloomMD: Visualize current folder`
- `BloomMD: Open current note in BloomMD`

## Feedback

This is a public beta. [Open an issue](https://github.com/moellenbeck-digital/bloommd-obsidian/issues) for bugs, missing shortcuts, or a note that rendered incorrectly. Include your Obsidian version and a minimal Markdown example when possible. Do not attach private vault content.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run release:verify
```

The Markdown engine is covered by unit tests, including CommonMark edge cases: Setext headings, fenced and indented code, HTML blocks, unterminated frontmatter, ATX closing sequences, and heading-depth limits. See [RELEASE.md](RELEASE.md) for the release process.

## Roadmap

The active roadmap and backlog live in the [BloomMD GitHub Project Board](https://github.com/orgs/moellenbeck-digital/projects/3). Local TODO files should not be used as a parallel source of truth.

## Links

- Web app: https://bloommd.app
- Website and demo: https://bloommd.io
- Try it without installing: https://bloommd.io/demo
- [Changelog](CHANGELOG.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md)

## License

MIT
