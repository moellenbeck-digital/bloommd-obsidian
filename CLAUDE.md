# Obsidian Plugin Instructions

The canonical source is `plugins/obsidian` in `moellenbeck-digital/BloomMD`. The public repository
`moellenbeck-digital/bloommd-obsidian` is a read-only release mirror.

Use `@bloommd/core/browser` for shared Markdown/structure behavior and keep Obsidian-specific
Vault/View/settings/UI code in the plugin. The current synchronized release is `0.5.7`; use the
mirror sync/check scripts and `MIRROR.json` for the version, Git-SHA, and Core-hash contract.

See [AGENTS.md](AGENTS.md) and [RELEASE.md](RELEASE.md) for the complete workflow.
