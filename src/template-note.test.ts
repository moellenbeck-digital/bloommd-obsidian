import { describe, expect, test } from "bun:test";
import { builtInNoteTemplates } from "./note-templates";
import {
  loadVaultTemplates,
  noteNameProblem,
  planNoteFromTemplate,
  templateChoices,
  templateLocale,
  type TemplateVault,
} from "./template-note";

function vault(files: Record<string, string>): TemplateVault & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    markdownPaths: () => Object.keys(files),
    read: async (path) => {
      reads.push(path);
      return files[path]!;
    },
  };
}

describe("templateLocale", () => {
  test("German Obsidian gets German templates, every other language English", () => {
    expect(templateLocale("de")).toBe("de");
    expect(templateLocale("de-AT")).toBe("de");
    expect(templateLocale("en")).toBe("en");
    expect(templateLocale("fr")).toBe("en");
    expect(templateLocale("")).toBe("en");
  });
});

describe("own templates", () => {
  const files = {
    "Vorlagen/Wochenplan.md": "# {{title}}\n{{date}}\n",
    "Vorlagen/Brief.md": "# {{title}}\n",
    "Vorlagen/Archiv/Alt.md": "# old",
    "Uni/Vorlagen/Falsch.md": "# wrong",
    "Normal.md": "# Normal",
  };

  test("only the .md files directly inside the template folder are read", async () => {
    const source = vault(files);
    expect(await loadVaultTemplates(source, "Vorlagen")).toEqual([
      { path: "Vorlagen/Brief.md", content: "# {{title}}\n" },
      { path: "Vorlagen/Wochenplan.md", content: "# {{title}}\n{{date}}\n" },
    ]);
    expect(source.reads).toEqual(["Vorlagen/Brief.md", "Vorlagen/Wochenplan.md"]);
  });

  test("the folder name is a setting; an empty setting falls back to Vorlagen", async () => {
    const source = vault({ "Templates/A.md": "# A", "Vorlagen/B.md": "# B" });
    expect((await loadVaultTemplates(source, "Templates")).map((template) => template.path)).toEqual(["Templates/A.md"]);
    expect((await loadVaultTemplates(source, "")).map((template) => template.path)).toEqual(["Vorlagen/B.md"]);
    expect((await loadVaultTemplates(source, " /Templates/ ")).map((template) => template.path)).toEqual(["Templates/A.md"]);
  });

  test("a vault without the folder offers just the built-in templates, without an error", async () => {
    const choices = await templateChoices(vault({ "Normal.md": "# N" }), "Vorlagen", "en");
    expect(choices).toEqual(builtInNoteTemplates("en"));
  });

  test("built-in templates follow the Obsidian language and come before the vault templates", async () => {
    const choices = await templateChoices(vault(files), "Vorlagen", "de");
    expect(choices.map((template) => template.title)).toEqual([
      "Vorlesung",
      "Cornell",
      "Literaturnotiz",
      "Prüfungsvorbereitung",
      "Projekt",
      "Brief",
      "Wochenplan",
    ]);
  });
});

describe("noteNameProblem", () => {
  test("accepts ordinary names and sub-folder paths", () => {
    expect(noteNameProblem("Physik 1")).toBeNull();
    expect(noteNameProblem("Uni/Physik/Woche 3")).toBeNull();
    expect(noteNameProblem("Notiz.md")).toBeNull();
  });

  test("refuses empty names, escapes and characters Obsidian does not allow", () => {
    for (const name of ["", "   ", "/abs", "a//b", "../x", "a/../b", "./a", "a:b", "a|b", "a?b", "a#b", "a^b", "a[b", "a\\b", "a\u0001b"]) {
      expect(noteNameProblem(name)).not.toBeNull();
    }
  });
});

describe("planNoteFromTemplate", () => {
  const lecture = builtInNoteTemplates("en")[0]!;

  test("puts the note in the folder, appends .md and fills in title and date", () => {
    const plan = planNoteFromTemplate({ folder: "Uni", name: "Physik 1", template: lecture, date: "2026-10-29" });
    expect(plan.path).toBe("Uni/Physik 1.md");
    expect(plan.folder).toBe("Uni");
    expect(plan.content.startsWith("# Physik 1\n")).toBe(true);
    expect(plan.content).toContain("## Date\n\n2026-10-29\n");
    expect(plan.content).not.toContain("{{");
  });

  test("the vault root is written as / or empty", () => {
    expect(planNoteFromTemplate({ folder: "/", name: "Notiz", template: lecture }).path).toBe("Notiz.md");
    expect(planNoteFromTemplate({ folder: "", name: "Notiz", template: lecture }).folder).toBe("");
  });

  test("a name with a slash goes into a sub-folder of the chosen folder", () => {
    const plan = planNoteFromTemplate({ folder: "Uni", name: "Physik/Woche 3.md", template: lecture });
    expect(plan.path).toBe("Uni/Physik/Woche 3.md");
    expect(plan.folder).toBe("Uni/Physik");
    expect(plan.content.startsWith("# Woche 3\n")).toBe(true);
  });

  test("own templates get the same two placeholders and keep other braces", () => {
    const plan = planNoteFromTemplate({
      folder: "",
      name: "Brief",
      template: { id: "custom:Vorlagen/Brief.md", title: "Brief", content: "# {{title}}\n{{date}} {{name}}\n", builtIn: false },
      date: "2026-01-02",
    });
    expect(plan.content).toBe("# Brief\n2026-01-02 {{name}}\n");
  });

  test("refuses a bad name", () => {
    expect(() => planNoteFromTemplate({ folder: "", name: "../x", template: lecture })).toThrow();
  });
});
