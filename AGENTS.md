# BloomMD Obsidian Plugin

## Source and repository contract

- Canonical development source: `moellenbeck-digital/BloomMD/plugins/obsidian`.
- Public distribution mirror: `moellenbeck-digital/bloommd-obsidian`.
- The public repository is a generated distribution mirror. Do not add implementation changes or
  pull requests there; user-facing bug reports may be filed as GitHub issues and are implemented in
  the canonical monorepo.
- Current synchronized plugin version: `0.5.12`.

## Architecture

- Shared Markdown and structural operations live in `@bloommd/core/browser`.
- `packages/core/src/obsidian-markdown.ts` is the canonical Core implementation.
- Obsidian Vault, View, settings, and UI behavior stays in this package.
- The monorepo uses React 19. The public standalone release is packaged with React 18.3 to retain
  the reviewed Obsidian release behavior.
- `main.js` does not bundle React at all: the `build` script aliases `react` and `react-dom` (and
  their `jsx-runtime`/`client` subpaths) to `preact/compat`, which saves ~180 KB of the 600 KiB
  release budget. The code is still written and typechecked against `@types/react`; the plugin
  tests preload `scripts/test-preact.ts` so rendering tests use the same renderer that ships. Avoid
  React-19-only APIs that preact/compat 10 lacks (`use`, `useActionState`, `useOptimistic`, `ref`
  as a plain prop on function components, ref callbacks returning a cleanup, `<Context>` as a
  provider). preact attaches event handlers to the element itself rather than delegating to the
  root, so `stopPropagation()` in a JSX handler also hides the event from native listeners on
  ancestors (d3-zoom/d3-drag, Obsidian) — use `nodrag`/`nopan` or capture listeners deliberately.
- `src/bundle-size.test.ts` builds the exact release bundle, prints its size and largest inputs,
  and fails above the budget or if React sneaks back in.

## Mirror and release

```bash
scripts/sync-obsidian-repo.sh <path-to-bloommd-obsidian>
scripts/sync-obsidian-repo.sh --check <path-to-bloommd-obsidian>
```

The sync creates the standalone `src/markdown-document.ts` and `src/core-types.ts` snapshots and
`MIRROR.json`. The latter records the plugin version, canonical Git-SHA, Core SHA-256 hashes, and a
hash of the exact static public release snapshot verified before publication.
The public checkout generates `bun.lock`, `main.js`, `shared-runtime.js`, `styles.css`, and `release/<version>/` during
release; these generated artifacts are not part of the monorepo source.

Run `bun run typecheck`, `bun run test`, `bun run build`, and `bun run release:verify` before a
public release. Tags use the exact numeric version without a `v` prefix.
