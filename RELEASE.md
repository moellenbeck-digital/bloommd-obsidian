# Obsidian Release Process

Obsidian expects `manifest.json`, `README.md`, the license, and the optional `icon.png` at the root of a public plugin repository. Release tags must exactly match the version, without a `v` prefix, and each GitHub release must attach `manifest.json`, `main.js`, `styles.css`, and `icon.png`.

## Repository topology

The BloomMD monorepo is the only development source. The plugin imports the shared Markdown
contract from `@bloommd/core/browser`; Obsidian-specific Vault, View, settings, and UI code stays in
`plugins/obsidian`.

The plugin ships from the public repository `moellenbeck-digital/bloommd-obsidian`. That repository
is a release/distribution mirror, not a second development home. Its source tree is deliberately
self-contained because the public repository is built independently by GitHub Actions. During a
mirror sync, these generated files are created from the canonical Core sources:

- `src/markdown-document.ts` — standalone snapshot of `packages/core/src/obsidian-markdown.ts`;
- `src/core-types.ts` — standalone snapshot of `packages/core/src/types.ts`;
- `MIRROR.json` — source commit, version, and SHA-256 evidence for both snapshots.

The public package removes the monorepo-only `@bloommd/core: workspace:*` dependency. It must never
be edited by hand. `bun.lock`, `main.js`, `styles.css`, and `release/<version>/` in the public
checkout are release/build artifacts; the root `bun.lock` remains authoritative for monorepo work.
The nested plugin lockfile and generated bundles are intentionally not tracked in the monorepo.

From the BloomMD monorepo, mirror the plugin into a checkout of the public repository:

```bash
scripts/sync-obsidian-repo.sh ../bloommd-obsidian
```

The script copies the canonical source/docs/assets, generates the standalone Core snapshots,
reinstalls the public lockfile, builds the release bundle, and runs the release contract. It
excludes `node_modules/`, `release/` and build scratch, and never copies test vaults or private
Markdown. Review the diff in the public checkout before committing and tagging.

To detect drift without changing the public checkout:

```bash
scripts/sync-obsidian-repo.sh --check ../bloommd-obsidian
```

The check compares the canonical plugin inputs, generated Core snapshots, package normalization,
and `MIRROR.json`, then runs the public release contract. A release must be synchronized from a
clean monorepo commit; the GitHub workflow rejects a mirror generated from a dirty checkout.

## Future release flow

1. Implement and review plugin/Core changes in `moellenbeck-digital/BloomMD` only.
2. Keep the plugin package version, `manifest.json`, `versions.json`, and `CHANGELOG.md` aligned.
3. Run the Core and plugin tests/typechecks in the monorepo and commit the complete source change.
4. Run `scripts/sync-obsidian-repo.sh ../bloommd-obsidian` from that commit.
5. Review the generated public diff, including `MIRROR.json` and the generated bundle.
6. Commit the public mirror, create the exact version tag without a `v` prefix, and let the public
   workflow run audit, typecheck, tests, build, hash validation, and release publication.
7. Verify the GitHub release assets and perform the clean-vault/BRAT smoke test.

The public release then has an unambiguous chain: plugin SemVer → public mirror commit/tag →
`MIRROR.json` source Git-SHA and Core SHA-256 → generated release assets. A change made only in the
public repository is intentionally not part of the development workflow and is detected by the
next mirror check.

## Deliberate release differences

- The canonical monorepo uses React 19. The standalone public package is normalized to React 18.3,
  matching the reviewed 0.5.4 release line and avoiding the dynamic script resources previously
  detected in Obsidian's plugin review. This is a packaging constraint, not a second implementation.
- The public package has no `@bloommd/core: workspace:*` dependency. Its generated files are the
  exact Core snapshot recorded by `MIRROR.json`.
- The plugin remains desktop-only and keeps its Obsidian-specific Vault/View/settings boundary;
  mobile support and platform-specific behavior are not inferred from the shared Core.

## Release checklist

1. Update `manifest.json`, `package.json`, `versions.json`, and `CHANGELOG.md` to the same version in the monorepo.
2. Run the monorepo Core/plugin tests and typechecks from the committed source.
3. Run the mirror sync and review the generated public diff.
4. Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, and `bun run release:package` in the public checkout.
5. Run the clean-vault smoke test and test the generated files from `release/<version>/` in a desktop Obsidian installation.
6. Push the dedicated repository and create an exact version tag such as `0.5.0`.
7. Verify the GitHub release contains `manifest.json`, `main.js`, `styles.css`, and `icon.png`.
8. After beta sign-off, submit the public repository through the official `obsidian-releases` process.

## 0.5.0 public beta evidence

- Version is synchronized across `manifest.json`, `package.json`, `versions.json`, and `CHANGELOG.md`.
- The release workflow runs audit, typecheck, tests, build, and the release contract before publishing assets.
- The clean-vault preparation script installs the generated `manifest.json`, `main.js`, and `styles.css` without copying private vault data.
- BRAT installation remains a manual verification step because it requires the Obsidian desktop application.

## 0.5.1 patch evidence

- Fixes Issue #169: one `Tab` press can no longer start duplicate child mutations for the same node.
- The patch release keeps the `0.5.0` tag immutable and uses the exact tag `0.5.1`.

## 0.5.2 patch evidence

- Fixes Issue #192: newly created nodes can be named directly in the inspector.
- The title field focuses and selects the default `New node` title automatically.
- Title changes use the existing conflict-safe Markdown roundtrip and preserve node content and metadata.
- The exact `0.5.2` tag is used; earlier release tags remain immutable.

## 0.5.3 patch evidence

- Fixes Issue #193: Obsidian community-directory review blockers are addressed.
- Leaves are no longer detached from their user-selected workspace locations during plugin unload.
- Uses Obsidian's native `ConfirmationModal`, command naming rules, declarative settings API, and `await`ed workspace navigation.
- Raises `minAppVersion` to `1.13.0`, which is the minimum for the APIs used by this release.
- React 18 removes the three dynamic script creations previously detected in the bundled `main.js`.
- The exact `0.5.3` tag must be used; earlier release tags remain immutable.

## 0.5.4 patch evidence

- Adds the dedicated `icon.png` used by the Obsidian Community Directory.
- The icon is packaged and attached to the GitHub release together with the standard plugin assets.
- The exact `0.5.4` tag must be used; earlier release tags remain immutable.

## 0.5.5 maintenance release evidence

- Version is synchronized across `manifest.json`, `package.json`, `versions.json`, and `CHANGELOG.md`.
- The plugin uses the canonical `@bloommd/core/browser` Markdown contract through the monorepo source and generated public mirror snapshot.
- The public mirror records the source commit and Core snapshot hashes in `MIRROR.json`.
- Core/plugin typechecks, tests, build, release verification, clean-vault QA, and the BRAT smoke test must pass before publication.
- The exact `0.5.5` tag must be used; earlier release tags remain immutable.

Creating the public repository, publishing the release, and submitting it to Obsidian are external release actions and cannot be represented by local files alone.
