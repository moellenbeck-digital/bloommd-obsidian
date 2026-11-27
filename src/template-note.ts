import {
  DEFAULT_TEMPLATE_FOLDER,
  listNoteTemplates,
  normalizeTemplateFolder,
  renderNoteTemplate,
  selectTemplatePaths,
  titleFromPath,
  type CustomNoteTemplate,
  type NoteTemplate,
  type NoteTemplateLocale,
} from "./note-templates";

export { DEFAULT_TEMPLATE_FOLDER };

/** Built-in templates exist in German and English; any Obsidian language other than German gets English. */
export function templateLocale(language: string): NoteTemplateLocale {
  return language.toLowerCase().startsWith("de") ? "de" : "en";
}

/** The vault as far as templates need it, so the logic runs without Obsidian. */
export interface TemplateVault {
  /** Paths of all Markdown files in the vault. */
  markdownPaths(): string[];
  read(path: string): Promise<string>;
}

/**
 * The user's own templates: the `.md` files directly inside the template folder at the vault root.
 * A vault without that folder has none.
 */
export async function loadVaultTemplates(vault: TemplateVault, folder: string): Promise<CustomNoteTemplate[]> {
  const paths = selectTemplatePaths(vault.markdownPaths(), normalizeTemplateFolder(folder));
  return Promise.all(paths.map(async (path) => ({ path, content: await vault.read(path) })));
}

/** Built-in templates in the Obsidian language, then the vault's own. */
export async function templateChoices(vault: TemplateVault, folder: string, language: string): Promise<NoteTemplate[]> {
  return listNoteTemplates(templateLocale(language), await loadVaultTemplates(vault, folder));
}

/**
 * Why `name` cannot be the name of a new note, or null when it can. A name may contain `/` to put the
 * note in a sub-folder of the chosen folder; it must stay inside the vault and use only characters
 * Obsidian allows in file names.
 */
export function noteNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name for the note.";
  if (trimmed.startsWith("/")) return "The name must be relative to the folder.";
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment.trim() === "")) return "The name must not contain empty folder names.";
  if (segments.some((segment) => segment === "." || segment === "..")) return "The name must stay inside the folder.";
  // eslint-disable-next-line no-control-regex
  if (/[\\:*?"<>|#^[\]\u0000-\u001f]/.test(trimmed)) return 'These characters are not allowed in a note name: \\ : * ? " < > | # ^ [ ]';
  return null;
}

export interface PlannedNote {
  /** Vault path of the note to create, with `.md`. */
  path: string;
  /** Folder that has to exist first; empty for the vault root. */
  folder: string;
  content: string;
}

/**
 * The file a "new note from template" creates: `name` below `folder` (empty for the vault root), with
 * `.md` appended when missing, and the template's `{{title}}` / `{{date}}` filled in.
 */
export function planNoteFromTemplate(input: {
  folder: string;
  name: string;
  template: NoteTemplate;
  date?: string;
}): PlannedNote {
  const problem = noteNameProblem(input.name);
  if (problem) throw new Error(problem);
  const relative = input.name.trim().replace(/\.md$/i, "");
  const base = input.folder.replace(/^\/+|\/+$/g, "");
  const path = `${base ? `${base}/` : ""}${relative}.md`;
  return {
    path,
    folder: path.slice(0, Math.max(0, path.lastIndexOf("/"))),
    content: renderNoteTemplate(input.template.content, { title: titleFromPath(path), date: input.date }),
  };
}
