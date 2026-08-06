# BloomMD for Obsidian

Visualize your Markdown notes as interactive mind maps while keeping Markdown as the source of truth.

BloomMD for Obsidian is a lightweight local companion plugin. It visualizes and edits the active note while the Markdown file in the vault remains the source of truth.

## Mind Map View

The plugin uses the same React Flow canvas engine as BloomMD surfaces. It supports cursor-centered zoom, free canvas panning, a minimap, Fit View, search, focus controls, branch collapsing, and persisted local layouts.

## Editing

- Drag the empty canvas to pan and use the wheel or trackpad to zoom around the cursor.
- Drag a node body to position it freely without changing Markdown hierarchy.
- Hold `Shift` to select multiple nodes and drag the selection together.
- Copy selected branches with `Cmd/Ctrl+C`, select a destination, and paste them as children with `Cmd/Ctrl+V`.
- Drag the orange connection handle from a parent to another node to reparent that branch.
- Double-click a node or press `F2` to rename it inline.
- Open the inspector to edit Markdown content with local autosave and conflict detection.
- Add child or sibling nodes from the node toolbar or with `Tab` and `Enter`.
- Delete a complete branch after confirmation.
- Use `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` for conflict-protected undo and redo.
- Open external links, Obsidian wiki links, and linked mentions from the inspector.
- Switch quickly between Markdown notes from the canvas toolbar.

Every confirmed action updates the same local Markdown file through the Obsidian Vault API. Frontmatter and unrelated sections remain untouched, and headings inside fenced code blocks are ignored. BloomMD adds standard HTML comments to headings as stable local node IDs; visual positions, viewport, and collapsed branches are stored only in the plugin's local data file.

## Commands

- `BloomMD: Visualize current note`
- `BloomMD: Open current note in BloomMD`
- `BloomMD: Visualize current folder`

The ribbon button runs `Visualize current note`.

## Privacy

- Works locally by default.
- Does not upload vault contents.
- Does not send file names to analytics.
- Does not put Markdown contents into URL parameters.
- The plugin contains no telemetry and does not upload vault contents.
- External opening is explicit and explained to the user.
- Editing uses local Vault operations and does not upload note contents.
- Node positions and viewport state remain in `.obsidian/plugins/bloommd/data.json`.

## Manual Beta Installation

1. Build the plugin:

   ```bash
   cd plugins/obsidian
   bun install
   bun run build
   ```

2. Copy these files into `<vault>/.obsidian/plugins/bloommd/`:

   ```text
   manifest.json
   main.js
   styles.css
   ```

3. Open Obsidian settings, enable Community Plugins, then enable BloomMD.

BloomMD for Obsidian `0.5.0` is intentionally marked desktop-only until the iOS and Android interaction matrix has passed. The supported beta platforms are macOS, Windows, and Linux.

## Development

Run from the repository root (in the BloomMD monorepo: `cd plugins/obsidian` first).

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run release:verify
bun run release:package
```

See [RELEASE.md](RELEASE.md) for the dedicated public repository and Obsidian Community Plugin release process.

## Roadmap

- Safer Desktop handoff with local file permission flow.
- Optional backlink edges on the canvas.
- Mobile Obsidian validation and touch-specific interaction hardening.
- Official Obsidian Community Plugin submission after beta testing.

## Links

- Web app: https://bloommd.app
- Public demo: https://bloommd.app/demo
- Report an issue: https://github.com/bloommd-app/bloommd-obsidian/issues
