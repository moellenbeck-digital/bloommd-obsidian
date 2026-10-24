/**
 * Fallback for `structuredClone`, which the shared Core code uses for metadata, frontmatter and
 * sync state. Obsidian mobile runs in the system WebView: iOS/iPadOS before 15.4 and old Android
 * System WebViews lack the global. The fallback deep-copies the data shapes BloomMD clones (plain
 * objects, arrays, Date, Map, Set and primitives); everywhere else the native function is used.
 */
type Cloneable = unknown;

export function cloneFallback<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value as object);
  if (existing !== undefined) return existing as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Map) {
    const copy = new Map<Cloneable, Cloneable>();
    seen.set(value, copy);
    for (const [key, entry] of value) copy.set(cloneFallback(key, seen), cloneFallback(entry, seen));
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new Set<Cloneable>();
    seen.set(value, copy);
    for (const entry of value) copy.add(cloneFallback(entry, seen));
    return copy as T;
  }
  if (Array.isArray(value)) {
    const copy: Cloneable[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(cloneFallback(entry, seen));
    return copy as T;
  }
  const copy: Record<string, Cloneable> = {};
  seen.set(value as object, copy);
  for (const key of Object.keys(value as object)) copy[key] = cloneFallback((value as Record<string, Cloneable>)[key], seen);
  return copy as T;
}

const scope = globalThis as { structuredClone?: <T>(value: T) => T };
if (typeof scope.structuredClone !== "function") scope.structuredClone = (value) => cloneFallback(value);
