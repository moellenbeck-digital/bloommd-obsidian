import { exportOpmlOutline, importOpml, type OpmlOutlineNode } from "./opml";
import { noteNameProblem } from "./template-note";

export interface HeadingForOpml {
  id: string;
  title: string;
  content: string;
  children: string[];
}

/** OPML 2.0 of the map as the canvas shows it: headings become nested outlines, content the `_note`. */
export function headingsToOpml(title: string, headings: readonly HeadingForOpml[]): string {
  const byId = new Map(headings.map((heading) => [heading.id, heading]));
  const referenced = new Set(headings.flatMap((heading) => heading.children));
  const seen = new Set<string>();
  const toOutline = (heading: HeadingForOpml): OpmlOutlineNode => {
    seen.add(heading.id);
    const children = heading.children
      .map((id) => byId.get(id))
      .filter((child): child is HeadingForOpml => Boolean(child) && !seen.has(child!.id))
      .map(toOutline);
    return { text: heading.title, note: heading.content, children };
  };
  const roots = headings.filter((heading) => !referenced.has(heading.id) && !seen.has(heading.id)).map(toOutline);
  return exportOpmlOutline(title, roots);
}

export interface PlannedOpmlNote {
  path: string;
  /** Markdown with the heading hierarchy of the OPML file. */
  content: string;
}

/**
 * The note an OPML import creates: named after the file (like any imported `.md`), placed in
 * `folder`, with a number appended when the name is taken. Throws `OpmlError` for unusable OPML.
 */
export function planOpmlNote(input: { folder: string; fileName: string; xml: string; exists: (path: string) => boolean }): PlannedOpmlNote {
  const imported = importOpml(input.xml);
  const fromFile = input.fileName.replace(/^.*[\\/]/, "").replace(/\.(opml|xml)$/i, "").trim();
  let name = fromFile || imported.title;
  // eslint-disable-next-line no-control-regex
  const unsafe = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;
  name = name.replace(unsafe, "-").replace(/^\.+/, "").trim();
  if (noteNameProblem(name)) name = "Imported OPML";
  const base = input.folder.replace(/^\/+|\/+$/g, "");
  const prefix = base ? `${base}/` : "";
  let path = `${prefix}${name}.md`;
  for (let counter = 1; input.exists(path); counter += 1) path = `${prefix}${name} ${counter}.md`;
  return { path, content: imported.markdown };
}
