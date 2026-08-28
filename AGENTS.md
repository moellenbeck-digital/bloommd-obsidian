# BloomMD Obsidian Plugin

## Source and repository contract

- Canonical development source: `moellenbeck-digital/BloomMD/plugins/obsidian`.
- Public distribution mirror: `moellenbeck-digital/bloommd-obsidian`.
- The public repository is a generated distribution mirror. Do not add implementation changes or
  pull requests there; user-facing bug reports may be filed as GitHub issues and are implemented in
  the private monorepo.
- Current synchronized plugin version: `0.5.7`.

## Architecture

- Shared Markdown and structural operations live in `@bloommd/core/browser`.
- `packages/core/src/obsidian-markdown.ts` is the canonical Core implementation.
- Obsidian Vault, View, settings, and UI behavior stays in this package.
- The monorepo uses React 19. The public standalone release is packaged with React 18.3 to retain
  the reviewed Obsidian release behavior.

## Mirror and release

```bash
scripts/sync-obsidian-repo.sh <path-to-bloommd-obsidian>
scripts/sync-obsidian-repo.sh --check <path-to-bloommd-obsidian>
```

The sync creates the standalone `src/markdown-document.ts` and `src/core-types.ts` snapshots and
`MIRROR.json`. The latter records the plugin version, canonical Git-SHA, and Core SHA-256 hashes.
The public checkout generates `bun.lock`, `main.js`, `styles.css`, and `release/<version>/` during
release; these generated artifacts are not part of the monorepo source.

Run `bun run typecheck`, `bun run test`, `bun run build`, and `bun run release:verify` before a
public release. Tags use the exact numeric version without a `v` prefix.
