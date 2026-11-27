/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/core/src/note-templates.ts by the BloomMD mirror sync.
 * Source SHA-256: d49bb1348659db65c3d5c671fa2677eb8486871c70020c8c2b8bc48a2b510412
 */
/**
 * Built-in note templates: plain Markdown that a new file can start from.
 *
 * Templates are ordinary `.md` text, so a template is also something a user can write, copy and share
 * as a file. The built-in ones are bundled as strings (nothing is loaded from disk at runtime); the
 * user's own templates are the `.md` files directly inside a template folder of the workspace.
 *
 * Only two placeholders are substituted — `{{title}}` and `{{date}}` — and any other `{{…}}` is left
 * exactly as written, so a template may still contain text that merely looks like a placeholder.
 *
 * This module has no imports on purpose: the Obsidian plugin carries it as a snapshot in the public
 * release mirror (see `scripts/sync-obsidian-mirror.mjs`).
 */

export type NoteTemplateLocale = "de" | "en";

/** Folder (at the workspace/vault root) that holds the user's own templates. */
export const DEFAULT_TEMPLATE_FOLDER = "Vorlagen";

export type BuiltInNoteTemplateId = "lecture" | "cornell" | "literature" | "exam" | "project";

export interface NoteTemplate {
  /** Stable id: the built-in id, or `custom:<path>` for a template file. */
  id: string;
  /** Name shown in the picker. Built-in titles follow the requested locale; custom ones are the file name. */
  title: string;
  /** Markdown with `{{title}}` / `{{date}}` still in place; pass it to {@link renderNoteTemplate}. */
  content: string;
  builtIn: boolean;
}

/** A user's template as read from the template folder. */
export interface CustomNoteTemplate {
  /** Path of the template file, relative to the workspace root (used for the id). */
  path: string;
  /** Markdown of the file. */
  content: string;
}

interface BuiltInDefinition {
  id: BuiltInNoteTemplateId;
  title: Record<NoteTemplateLocale, string>;
  content: Record<NoteTemplateLocale, string>;
}

const BUILT_IN: readonly BuiltInDefinition[] = [
  {
    id: "lecture",
    title: { de: "Vorlesung", en: "Lecture" },
    content: {
      de: `# {{title}}

## Datum

{{date}}

## Thema

Worum geht es in dieser Vorlesung?

## Leitfragen

- Was will ich nach der Vorlesung erklären können?

## Kernaussagen

- Zentrale Aussage in einem Satz

## Beispiele

- Beispiel oder Fall, der die Aussage greifbar macht

## Offene Fragen

- Was ist noch unklar?

## Aufgaben

- [ ] Nachbereiten
`,
      en: `# {{title}}

## Date

{{date}}

## Topic

What is this lecture about?

## Guiding questions

- What should I be able to explain afterwards?

## Key points

- Central statement in one sentence

## Examples

- Example or case that makes the point tangible

## Open questions

- What is still unclear?

## Tasks

- [ ] Review the material
`,
    },
  },
  {
    id: "cornell",
    title: { de: "Cornell", en: "Cornell" },
    content: {
      de: `# {{title}}

## Stichwörter

- Stichwort oder Frage, die später zum Abfragen dient

## Notizen

Hier kommen die Notizen aus Vorlesung oder Text hin.

## Zusammenfassung

Die Kernaussage in zwei bis drei Sätzen, in eigenen Worten.
`,
      en: `# {{title}}

## Cues

- Keyword or question to use for review later

## Notes

Write the notes from the lecture or text here.

## Summary

The main point in two or three sentences, in your own words.
`,
    },
  },
  {
    id: "literature",
    title: { de: "Literaturnotiz", en: "Literature note" },
    content: {
      de: `# {{title}}

## Quelle

Autor, Titel, Jahr, Fundstelle

## Kernthese

Die zentrale These in einem Satz.

## Argumente

- Argument und wie es begründet wird

## Zitate

> Wörtliches Zitat (Seite)

## Eigene Gedanken

- Was überzeugt, was nicht? Wozu passt das?

## Verknüpfungen

- [[Verwandte Notiz]]
`,
      en: `# {{title}}

## Source

Author, title, year, location

## Main claim

The central claim in one sentence.

## Arguments

- Argument and how it is supported

## Quotes

> Verbatim quote (page)

## Own thoughts

- What convinces, what does not? What does it connect to?

## Links

- [[Related note]]
`,
    },
  },
  {
    id: "exam",
    title: { de: "Prüfungsvorbereitung", en: "Exam prep" },
    content: {
      de: `# {{title}}

## Prüfung & Termin

Fach, Form der Prüfung, Datum und Ort

## Themenliste

- Thema 1
- Thema 2

## Lernplan

- [ ] Stoff sichten
- [ ] Zusammenfassungen schreiben
- [ ] Übungsfragen durchgehen

## Übungsfragen

- Frage, die in der Prüfung vorkommen könnte

## Lücken

- Was kann ich noch nicht sicher?
`,
      en: `# {{title}}

## Exam & date

Subject, exam format, date and place

## Topic list

- Topic 1
- Topic 2

## Study plan

- [ ] Go through the material
- [ ] Write summaries
- [ ] Work through practice questions

## Practice questions

- A question that could come up in the exam

## Gaps

- What do I still not know well?
`,
    },
  },
  {
    id: "project",
    title: { de: "Projekt", en: "Project" },
    content: {
      de: `# {{title}}

## Ziel

Was soll am Ende erreicht sein?

## Umfang

- Was gehört dazu, was ausdrücklich nicht?

## Meilensteine

- Meilenstein und Termin

## Aufgaben

- [ ] Erste Aufgabe

## Risiken

- Was kann schiefgehen und was tun wir dagegen?

## Entscheidungen

- Entscheidung, Datum und Begründung
`,
      en: `# {{title}}

## Goal

What should be achieved in the end?

## Scope

- What is included, and what is explicitly not?

## Milestones

- Milestone and date

## Tasks

- [ ] First task

## Risks

- What could go wrong and what do we do about it?

## Decisions

- Decision, date and reasoning
`,
    },
  },
];

/** The built-in templates in the given language, in a fixed order. */
export function builtInNoteTemplates(locale: NoteTemplateLocale): NoteTemplate[] {
  return BUILT_IN.map((definition) => ({
    id: definition.id,
    title: definition.title[locale],
    content: definition.content[locale],
    builtIn: true,
  }));
}

/** Title of a template file: its file name without the `.md` extension. */
export function customTemplateTitle(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

/**
 * Picks the template files out of a list of workspace paths: the `.md` files directly inside
 * `folder` at the workspace root. Sub-folders are not searched. Paths are sorted by title so the
 * picker order does not depend on how a platform lists files.
 */
export function selectTemplatePaths(paths: readonly string[], folder: string = DEFAULT_TEMPLATE_FOLDER): string[] {
  const prefix = `${normalizeTemplateFolder(folder)}/`;
  return paths
    .filter((path) => {
      if (!path.startsWith(prefix)) return false;
      const rest = path.slice(prefix.length);
      return !rest.includes("/") && /.\.md$/i.test(rest);
    })
    .sort((a, b) => customTemplateTitle(a).localeCompare(customTemplateTitle(b)) || a.localeCompare(b));
}

/** Folder name without surrounding slashes or whitespace; an empty name falls back to the default. */
export function normalizeTemplateFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_TEMPLATE_FOLDER;
}

/**
 * All templates for the picker: the built-in ones in `locale`, followed by the user's own, whose
 * title is the file name. An empty or missing custom list yields just the built-in templates.
 */
export function listNoteTemplates(
  locale: NoteTemplateLocale,
  custom: readonly CustomNoteTemplate[] = [],
): NoteTemplate[] {
  return [
    ...builtInNoteTemplates(locale),
    ...custom.map((template) => ({
      id: `custom:${template.path}`,
      title: customTemplateTitle(template.path),
      content: template.content,
      builtIn: false,
    })),
  ];
}

/** Today as `YYYY-MM-DD` in local time. */
export function isoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

/** Name of a new file without folder and `.md`, which is what `{{title}}` stands for. */
export function titleFromPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
}

/**
 * File content for a new note: the template with `{{title}}` and `{{date}}` filled in. Anything else
 * between double braces stays as it is. Substitution is a single pass, so a title that itself contains
 * `{{date}}` is kept literally.
 */
export function renderNoteTemplate(content: string, values: { title: string; date?: string }): string {
  const date = values.date ?? isoDate();
  return content.replace(/\{\{(title|date)\}\}/g, (_match, name: string) => (name === "title" ? values.title : date));
}
