/** Shortcuts and focus areas of the navigator; the in-view help and the README describe the same list. */

export interface ShortcutHelp {
  /** Key combination; `Mod` stands for Cmd on macOS and Ctrl on Windows and Linux. */
  keys: string;
  area: string;
  action: string;
}

export const NAVIGATOR_SHORTCUTS: readonly ShortcutHelp[] = [
  { keys: "↑ / ↓", area: "Tree, list", action: "Previous / next entry" },
  { keys: "←", area: "Tree", action: "Close the folder, or go to the parent folder" },
  { keys: "→", area: "Tree", action: "Open the folder, or focus the list" },
  { keys: "←", area: "List", action: "Back to the tree" },
  { keys: "Enter", area: "Tree", action: "Open the folder and focus its notes" },
  { keys: "Enter", area: "List", action: "Open the note" },
  { keys: "M", area: "Tree, list", action: "Open the map of the selected note or folder" },
  { keys: "Tab / Shift+Tab", area: "Navigator", action: "Next / previous area (tree, list, map)" },
  { keys: "Esc", area: "Navigator", action: "List → tree → editor; from the map back to where you came from" },
  { keys: "Mod+[ / Mod+]", area: "Navigator", action: "Back / forward in the navigation history" },
  { keys: "Mod+Shift+R", area: "Anywhere", action: "Show the active note in the navigator" },
];

export const NAVIGATOR_FOCUS_AREAS: readonly string[] = [
  "Tree: the vault's folders.",
  "List: the Markdown notes of the selected folder.",
  "Map: the BloomMD map (focus it with Tab or Open map, return with Esc or the command Focus navigator).",
  "Search: reserved, not available yet.",
];
