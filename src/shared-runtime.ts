/**
 * Optional collaboration runtime for the Obsidian plugin.
 *
 * It is emitted as `shared-runtime.js` and loaded only when a user explicitly shares a note or
 * restores an existing shared binding. Keeping Yjs and its WebSocket protocol out of `main.js`
 * preserves the normal local-only plugin's release-size budget.
 */
export { ObsidianSharedDocumentSession } from "./shared-document";
export { WorkspaceSyncClient } from "./shared-dependencies";
