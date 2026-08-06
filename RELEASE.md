# Obsidian Release Process

Obsidian expects `manifest.json`, `README.md`, and the license at the root of a public plugin repository. Release tags must exactly match the version, without a `v` prefix, and each GitHub release must attach `manifest.json`, `main.js`, and `styles.css`.

## Repository topology

Publish `plugins/obsidian` as the root of a dedicated public repository such as `bloommd-obsidian`. The nested `.github/workflows/release.yml` becomes active when this directory is used as that repository root.

From the BloomMD monorepo, a deterministic branch can be prepared with:

```bash
git subtree split --prefix plugins/obsidian -b obsidian-release
```

Review the branch before pushing it to the public plugin repository. Never copy test vaults or private Markdown files.

## Release checklist

1. Update `manifest.json`, `package.json`, `versions.json`, and `CHANGELOG.md` to the same version.
2. Run `bun install --frozen-lockfile`.
3. Run `bun run typecheck`, `bun run test`, and `bun run release:package`.
4. Test the generated files from `release/<version>/` in clean Obsidian installations on macOS, Windows, and Linux.
5. Push the dedicated repository and create an exact version tag such as `0.4.0`.
6. Verify the GitHub release contains `manifest.json`, `main.js`, and `styles.css`.
7. After beta sign-off, submit the public repository through the official `obsidian-releases` process.

Creating the public repository, publishing the release, and submitting it to Obsidian are external release actions and cannot be represented by local files alone.
