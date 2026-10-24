/** Where people get the desktop app when "Open app" finds none installed. */
export const BLOOMMD_DOWNLOAD_URL = "https://bloommd.io/download";

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The deep link that opens a local note in BloomMD Desktop, optionally at a node. Only ids that
 * are persisted in the file (`<!-- bloommd:id=… -->`) mean the same node in both apps; the
 * `heading-<line>` fallback of an unsaved note is left out.
 */
export function desktopOpenUrl(absolutePath: string, nodeId?: string | null): string {
  const node = desktopNodeId(nodeId);
  return `bloommd://open?path=${encodeURIComponent(absolutePath)}${node ? `&node=${encodeURIComponent(node)}` : ""}`;
}

/** The link that opens a vault note in the BloomMD iPad/iPhone app (vault-relative path). */
export function mobileOpenUrl(vaultPath: string, nodeId?: string | null): string {
  const node = desktopNodeId(nodeId);
  return `bloommd://open?path=${encodeURIComponent(vaultPath)}${node ? `&node=${encodeURIComponent(node)}` : ""}`;
}

/** The node id to hand over, or null when it would not mean the same node in BloomMD Desktop. */
export function desktopNodeId(nodeId?: string | null): string | null {
  return nodeId && NODE_ID_RE.test(nodeId) && !nodeId.startsWith("heading-") ? nodeId : null;
}
