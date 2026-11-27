import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAVIGATOR_FOCUS_AREAS, NAVIGATOR_SHORTCUTS } from "./navigator-help";

const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");

/** README writes the shortcuts with backticks and "Cmd/Ctrl" for Mod. */
const readmeKeys = (keys: string) => keys.replace(/Mod/g, "Cmd/Ctrl").replace(/ \/ /g, "` / `");

describe("navigator help", () => {
  test("every shortcut of the in-view help is documented in the README", () => {
    for (const shortcut of NAVIGATOR_SHORTCUTS) expect(readme).toContain(`\`${readmeKeys(shortcut.keys)}\``);
  });

  test("the README names every focus area", () => {
    for (const area of ["Tree", "List", "Map", "Search"]) expect(readme).toContain(`| ${area} |`);
    expect(NAVIGATOR_FOCUS_AREAS).toHaveLength(4);
  });

  test("the shortcuts the model implements are all listed", () => {
    const keys = NAVIGATOR_SHORTCUTS.map((shortcut) => shortcut.keys).join(" ");
    for (const key of ["↑", "←", "→", "Enter", "M", "Tab", "Esc", "Mod+[", "Mod+]", "Mod+Shift+R"]) expect(keys).toContain(key);
  });
});
