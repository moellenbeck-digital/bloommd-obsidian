export interface LocalPathEntry {
  localPath: string;
}

export interface PersistedPathState<TLayout, TEntry extends LocalPathEntry> {
  layouts: Record<string, TLayout>;
  bindings: TEntry[];
}

export interface VaultPathRename {
  oldPath: string;
  newPath: string;
  isFolder: boolean;
}

export interface MigratedPathState<TLayout, TEntry extends LocalPathEntry> extends PersistedPathState<TLayout, TEntry> {
  changed: boolean;
  movedLocalPaths: Array<{ oldPath: string; newPath: string }>;
}

function replacePath(path: string, rename: VaultPathRename): string | null {
  if (path === rename.oldPath) return rename.newPath;
  if (rename.isFolder && path.startsWith(`${rename.oldPath}/`)) return `${rename.newPath}${path.slice(rename.oldPath.length)}`;
  return null;
}

/** Moves only client-local references. Markdown, cloud IDs, tokens, and permissions stay untouched. */
export function migratePersistedPathState<TLayout, TEntry extends LocalPathEntry>(
  state: PersistedPathState<TLayout, TEntry>,
  rename: VaultPathRename,
): MigratedPathState<TLayout, TEntry> {
  const layouts: Record<string, TLayout> = { ...state.layouts };
  let changed = false;

  for (const [key, layout] of Object.entries(state.layouts)) {
    const separator = key.indexOf(":");
    if (separator < 0) continue;
    const kind = key.slice(0, separator);
    const localPath = key.slice(separator + 1);
    if (kind !== "file" && kind !== "folder") continue;
    const nextPath = replacePath(localPath, rename);
    if (!nextPath) continue;
    const nextKey = `${kind}:${nextPath}`;
    delete layouts[key];
    if (!(nextKey in layouts)) layouts[nextKey] = layout;
    changed = true;
  }

  const sourcePaths = new Set<string>();
  const movedLocalPaths: Array<{ oldPath: string; newPath: string }> = [];
  for (const entry of state.bindings) {
    const nextPath = replacePath(entry.localPath, rename);
    if (!nextPath) continue;
    sourcePaths.add(entry.localPath);
    movedLocalPaths.push({ oldPath: entry.localPath, newPath: nextPath });
  }
  const occupiedPaths = new Set(state.bindings.filter((entry) => !sourcePaths.has(entry.localPath)).map((entry) => entry.localPath));
  const bindings = state.bindings.flatMap((entry) => {
    const nextPath = replacePath(entry.localPath, rename);
    if (!nextPath) return [entry];
    changed = true;
    if (occupiedPaths.has(nextPath)) return [];
    occupiedPaths.add(nextPath);
    return [{ ...entry, localPath: nextPath }];
  });

  return { layouts, bindings, changed, movedLocalPaths };
}
