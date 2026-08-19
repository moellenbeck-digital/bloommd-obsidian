# Obsidian Release Process

Obsidian expects `manifest.json`, `README.md`, and the license at the root of a public plugin repository. Release tags must exactly match the version, without a `v` prefix, and each GitHub release must attach `manifest.json`, `main.js`, and `styles.css`.

## Repository topology

The plugin ships from the public repository `moellenbeck-digital/bloommd-obsidian`, whose root is a mirror of `plugins/obsidian` in the private BloomMD monorepo. The nested `.github/workflows/release.yml` is active there.

From the BloomMD monorepo, mirror the plugin into a checkout of the public repository:

```bash
scripts/sync-obsidian-repo.sh ../bloommd-obsidian
```

The script excludes `node_modules/`, `release/` and build scratch, and never copies test vaults or
private Markdown. Review the diff in the public checkout before committing and tagging.

## Release checklist

1. Update `manifest.json`, `package.json`, `versions.json`, and `CHANGELOG.md` to the same version.
2. Run `bun install --frozen-lockfile`.
3. Run `bun run typecheck`, `bun run test`, and `bun run release:package`.
4. Run the clean-vault smoke test and test the generated files from `release/<version>/` in a desktop Obsidian installation.
5. Push the dedicated repository and create an exact version tag such as `0.5.0`.
6. Verify the GitHub release contains `manifest.json`, `main.js`, and `styles.css`.
7. After beta sign-off, submit the public repository through the official `obsidian-releases` process.

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

Creating the public repository, publishing the release, and submitting it to Obsidian are external release actions and cannot be represented by local files alone.
