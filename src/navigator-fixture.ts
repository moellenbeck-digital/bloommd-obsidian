/** A small vault snapshot for the navigator tests: nested folders, equal file names in different folders and a very long name. */
import { buildFolderNode, type SourceEntry } from "./navigator-model";

const file = (path: string): SourceEntry => ({ path, name: path.split("/").pop()!, extension: path.split(".").pop()! });
const folder = (path: string, children: SourceEntry[]): SourceEntry => ({ path, name: path.split("/").pop() || "Vault", children });

export const LONG_NAME = "A very long note title that keeps going to describe the quarterly planning of the whole organisation.md";

/** Nested folders, the same file names in different folders, a long name, a dot folder and a non-Markdown file. */
export const vault: SourceEntry = folder("/", [
  file("Home.md"),
  file("image.png"),
  folder(".trash", [file(".trash/old.md")]),
  folder("Projects", [
    file("Projects/Notes.md"),
    folder("Projects/Alpha", [file("Projects/Alpha/Notes.md"), file("Projects/Alpha/Plan 10.md"), file("Projects/Alpha/Plan 2.md"), folder("Projects/Alpha/Deep", [file(`Projects/Alpha/Deep/${LONG_NAME}`)])]),
    folder("Projects/Beta", [file("Projects/Beta/Notes.md")]),
  ]),
  folder("Archive", []),
]);

export const root = buildFolderNode(vault, "My vault");
