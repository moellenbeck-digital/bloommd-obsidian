# Privacy

BloomMD for Obsidian is local-first.

The plugin reads and edits the active Markdown note or current folder through Obsidian's local Vault API. It does not upload vault contents, file names, folder names, node text, Markdown contents, or local layout data.

BloomMD adds HTML comments such as `<!-- bloommd:id=... -->` to Markdown headings so nodes remain stable across edits. Canvas positions, viewport state, and collapsed branches are stored locally in `.obsidian/plugins/bloommd/data.json`. These values are not transmitted.

When `Open current note in BloomMD` is used, the plugin may try to open the BloomMD desktop protocol with the vault-relative path. It does not put Markdown content into URL parameters. If the web demo is opened, the user must choose a local file manually.

The plugin does not contain telemetry. If telemetry is added later, it must remain opt-in and must not include note contents, file names, folder names, local layout data, or personal text.
