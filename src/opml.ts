/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/core/src/opml.ts by the BloomMD mirror sync.
 * Source SHA-256: 169f72cf2ca156a21af89224bd0878e66b410345ff9ce554e91a798bfb37d76f
 */
import type { MindMapDocument, MindMapNode } from "./core-types";
import { MAX_HEADING_LEVEL } from "./core-types";

/**
 * OPML 2.0 export and import for mind maps.
 *
 * Pure functions with no dependencies: the XML reader below is deliberately small and never
 * resolves DOCTYPE declarations or entities, so an imported file cannot pull in external content
 * (XXE) or expand entities into a memory bomb. It also works in every runtime (Bun, browsers,
 * the Obsidian bundle) without a DOM.
 */

export type OpmlErrorCode =
  | "empty"
  | "malformed"
  | "forbidden"
  | "not-opml"
  | "no-outlines"
  | "missing-text"
  | "too-large";

export class OpmlError extends Error {
  readonly code: OpmlErrorCode;

  constructor(code: OpmlErrorCode, message: string) {
    super(message);
    this.name = "OpmlError";
    this.code = code;
  }
}

export interface OpmlImportResult {
  /** Title from `<head><title>`, else the text of the root outline. */
  title: string;
  /** Markdown without frontmatter: the heading hierarchy with notes as content. */
  markdown: string;
  nodeCount: number;
}

const MAX_XML_DEPTH = 200;
const MAX_OUTLINES = 100_000;

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

// XML 1.0 forbids most control characters even as references; they would make the file unreadable.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function escapeXml(value: string, attribute: boolean): string {
  let escaped = value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (attribute) {
    // Attribute values are whitespace-normalized by XML readers unless the characters are written
    // as references, so notes only survive with explicit line breaks.
    escaped = escaped
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      .replace(/\r\n?/g, "\n")
      .replace(/\n/g, "&#10;")
      .replace(/\t/g, "&#9;");
  }
  return escaped;
}

/** One outline of an OPML export: a heading with its note and nested outlines. */
export interface OpmlOutlineNode {
  text: string;
  /** Markdown content of the node; written to `_note`. */
  note?: string;
  children?: readonly OpmlOutlineNode[];
}

/**
 * Serializes outlines as OPML 2.0 under the given map title. Used directly by hosts that have the
 * heading tree but no {@link MindMapDocument} (the Obsidian plugin).
 */
export function exportOpmlOutline(title: string, roots: readonly OpmlOutlineNode[]): string {
  const lines: string[] = [];

  const writeNode = (node: OpmlOutlineNode, indent: string) => {
    const attributes = [`text="${escapeXml(node.text, true)}"`];
    if (node.note?.trim()) attributes.push(`_note="${escapeXml(node.note, true)}"`);
    const children = node.children ?? [];
    if (children.length === 0) {
      lines.push(`${indent}<outline ${attributes.join(" ")}/>`);
      return;
    }
    lines.push(`${indent}<outline ${attributes.join(" ")}>`);
    for (const child of children) writeNode(child, `${indent}  `);
    lines.push(`${indent}</outline>`);
  };

  for (const root of roots) writeNode(root, "    ");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>${escapeXml(title || roots[0]?.text || "Untitled", false)}</title>`,
    `  </head>`,
    `  <body>`,
    ...lines,
    `  </body>`,
    `</opml>`,
    ``,
  ].join("\n");
}

/**
 * Serializes a map as OPML 2.0. Every top-level heading becomes an `<outline text=…>`, nested
 * headings become nested outlines, and the node's Markdown content goes into `_note` (the attribute
 * MindNode and Xmind read). The map title is the `<head><title>`.
 */
export function exportOpml(doc: MindMapDocument): string {
  const visited = new Set<string>();
  const toOutline = (node: MindMapNode): OpmlOutlineNode => {
    visited.add(node.id);
    const children = node.children
      .map((id) => doc.nodes.get(id))
      .filter((child): child is MindMapNode => Boolean(child) && !visited.has(child!.id))
      .map(toOutline);
    return { text: node.title, note: node.content, children };
  };
  const roots = Array.from(doc.nodes.values()).filter((node) => node.parentId === null && !visited.has(node.id)).map(toOutline);
  return exportOpmlOutline(doc.frontmatter.title, roots);
}

// ---------------------------------------------------------------------------------------------
// XML reading
// ---------------------------------------------------------------------------------------------

interface XmlElement {
  name: string;
  attributes: Map<string, string>;
  children: XmlElement[];
  text: string;
}

const NAME_RE = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;

function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

const PREDEFINED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(value: string, position: number): string {
  if (!value.includes("&")) return value;
  return value.replace(/&([^&;\s]*);?/g, (match, body: string) => {
    if (!match.endsWith(";")) throw malformed(`Unescaped "&" near position ${position}.`);
    const predefined = PREDEFINED_ENTITIES[body];
    if (predefined !== undefined) return predefined;
    const numeric = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
    if (numeric) {
      const codePoint = numeric[1] ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2] ?? "", 10);
      if (!Number.isFinite(codePoint) || !isXmlChar(codePoint)) throw malformed(`Invalid character reference "&${body};" near position ${position}.`);
      return String.fromCodePoint(codePoint);
    }
    // Entities other than the five predefined ones would need a DTD, which is never read.
    throw new OpmlError("forbidden", `Entity "&${body};" is not allowed; OPML files must not define or use custom entities.`);
  });
}

function malformed(message: string): OpmlError {
  return new OpmlError("malformed", `The OPML file is not valid XML: ${message}`);
}

function parseXml(source: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let index = 0;
  let elementCount = 0;

  const isWhitespace = (char: string | undefined) => char === " " || char === "\n" || char === "\t" || char === "\r";
  const skipWhitespace = () => {
    while (index < source.length && isWhitespace(source[index])) index += 1;
  };
  const appendText = (text: string, raw: boolean) => {
    const top = stack[stack.length - 1];
    if (top) {
      top.text += raw ? text : decodeEntities(text, index);
      return;
    }
    if (text.trim()) throw malformed(`Text outside the root element near position ${index}.`);
  };

  while (index < source.length) {
    if (source.charCodeAt(index) !== 0x3c) {
      const next = source.indexOf("<", index);
      const end = next === -1 ? source.length : next;
      appendText(source.slice(index, end), false);
      index = end;
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end === -1) throw malformed("Unterminated comment.");
      index = end + 3;
    } else if (source.startsWith("<![CDATA[", index)) {
      const end = source.indexOf("]]>", index + 9);
      if (end === -1) throw malformed("Unterminated CDATA section.");
      if (!stack.length) throw malformed("CDATA outside the root element.");
      appendText(source.slice(index + 9, end), true);
      index = end + 3;
    } else if (source.startsWith("<?", index)) {
      const end = source.indexOf("?>", index + 2);
      if (end === -1) throw malformed("Unterminated processing instruction.");
      index = end + 2;
    } else if (source.startsWith("<!", index)) {
      throw new OpmlError("forbidden", "DOCTYPE and entity declarations are not allowed in OPML files.");
    } else if (source.startsWith("</", index)) {
      const end = source.indexOf(">", index);
      if (end === -1) throw malformed("Unterminated closing tag.");
      const name = source.slice(index + 2, end).trim();
      const top = stack.pop();
      if (!top) throw malformed(`Unexpected closing tag </${name}>.`);
      if (top.name !== name) throw malformed(`Closing tag </${name}> does not match <${top.name}>.`);
      index = end + 1;
    } else {
      index += 1;
      const nameStart = index;
      while (index < source.length && !isWhitespace(source[index]) && source[index] !== "/" && source[index] !== ">") index += 1;
      const name = source.slice(nameStart, index);
      if (!NAME_RE.test(name)) throw malformed(`Invalid element name near position ${nameStart}.`);
      const element: XmlElement = { name, attributes: new Map(), children: [], text: "" };
      let selfClosing = false;
      for (;;) {
        skipWhitespace();
        if (index >= source.length) throw malformed(`Unterminated tag <${name}>.`);
        const char = source[index];
        if (char === ">") {
          index += 1;
          break;
        }
        if (char === "/") {
          if (source[index + 1] !== ">") throw malformed(`Unexpected "/" in tag <${name}>.`);
          selfClosing = true;
          index += 2;
          break;
        }
        const attributeStart = index;
        while (index < source.length && !isWhitespace(source[index]) && source[index] !== "=" && source[index] !== "/" && source[index] !== ">") index += 1;
        const attributeName = source.slice(attributeStart, index);
        if (!NAME_RE.test(attributeName)) throw malformed(`Invalid attribute name in <${name}> near position ${attributeStart}.`);
        skipWhitespace();
        if (source[index] !== "=") throw malformed(`Attribute "${attributeName}" in <${name}> has no value.`);
        index += 1;
        skipWhitespace();
        const quote = source[index];
        if (quote !== '"' && quote !== "'") throw malformed(`Attribute "${attributeName}" in <${name}> is not quoted.`);
        const valueEnd = source.indexOf(quote, index + 1);
        if (valueEnd === -1) throw malformed(`Unterminated value of attribute "${attributeName}" in <${name}>.`);
        const rawValue = source.slice(index + 1, valueEnd);
        if (rawValue.includes("<")) throw malformed(`Attribute "${attributeName}" in <${name}> contains "<".`);
        if (element.attributes.has(attributeName)) throw malformed(`Attribute "${attributeName}" is repeated in <${name}>.`);
        element.attributes.set(attributeName, decodeEntities(rawValue.replace(/\r\n?/g, "\n"), index));
        index = valueEnd + 1;
      }
      elementCount += 1;
      if (elementCount > MAX_OUTLINES * 2) throw new OpmlError("too-large", "The OPML file has too many elements.");
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else if (root) throw malformed("More than one root element.");
      else root = element;
      if (!selfClosing) {
        if (stack.length >= MAX_XML_DEPTH) throw new OpmlError("too-large", `The OPML file is nested deeper than ${MAX_XML_DEPTH} levels.`);
        stack.push(element);
      }
    }
  }

  if (stack.length > 0) throw malformed(`Element <${stack[stack.length - 1]?.name}> is not closed.`);
  if (!root) throw new OpmlError("empty", "The OPML file is empty.");
  return root;
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

/** `<!--` in imported text could forge `bloommd:id`/`bloommd:meta` comments, so it is neutralized. */
function neutralizeComments(value: string): string {
  return value.replace(/<!--/g, "&lt;!--");
}

function singleLine(value: string): string {
  return neutralizeComments(value.replace(/\s+/g, " ").trim());
}

/** Keeps a note from turning into headings: `#` lines outside code fences are escaped. */
function noteToMarkdown(note: string): string {
  const lines = neutralizeComments(note.replace(/\r\n?/g, "\n")).trim().split("\n");
  let fence: string | null = null;
  return lines
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (fence === null) fence = marker[0] ?? null;
        else if (marker[0] === fence) fence = null;
        return line;
      }
      if (fence === null && /^ {0,3}#{1,6}(?:\s|$)/.test(line)) return line.replace("#", "\\#");
      return line;
    })
    .join("\n");
}

interface Outline {
  text: string;
  note: string;
  children: Outline[];
}

function readOutlines(parent: XmlElement, counter: { count: number }): Outline[] {
  const outlines: Outline[] = [];
  for (const element of parent.children) {
    if (element.name !== "outline") continue;
    counter.count += 1;
    if (counter.count > MAX_OUTLINES) throw new OpmlError("too-large", `The OPML file has more than ${MAX_OUTLINES} outlines.`);
    const text = element.attributes.get("text") ?? element.attributes.get("title");
    if (text === undefined) {
      throw new OpmlError("missing-text", `Outline ${counter.count} has no "text" attribute, so it has no title.`);
    }
    outlines.push({
      text: singleLine(text) || "Untitled",
      note: element.attributes.get("_note") ?? "",
      children: readOutlines(element, counter),
    });
  }
  return outlines;
}

/**
 * Converts OPML into a Markdown document with a heading hierarchy. `text` becomes the heading,
 * `_note` the content below it. A single top-level outline is the map root; several are placed
 * under a root named after `<head><title>`. Outlines deeper than six levels become a bullet list
 * in their level-six ancestor, because Markdown has no seventh heading level.
 *
 * Throws {@link OpmlError} with a readable message for empty or broken XML, DOCTYPE/entity
 * declarations, files without outlines, and outlines without `text`.
 */
export function importOpml(xml: string): OpmlImportResult {
  const source = xml.replace(/^﻿/, "");
  if (!source.trim()) throw new OpmlError("empty", "The OPML file is empty.");
  const document = parseXml(source);
  if (document.name.toLowerCase() !== "opml") {
    throw new OpmlError("not-opml", `The file is not OPML: the root element is <${document.name}>, expected <opml>.`);
  }
  const body = document.children.find((child) => child.name === "body");
  if (!body) throw new OpmlError("not-opml", "The OPML file has no <body> element.");
  const counter = { count: 0 };
  const outlines = readOutlines(body, counter);
  if (outlines.length === 0) throw new OpmlError("no-outlines", "The OPML file contains no outlines.");

  const headTitle = singleLine(document.children.find((child) => child.name === "head")?.children.find((child) => child.name === "title")?.text ?? "");
  const blocks: string[] = [];

  const writeOutline = (outline: Outline, level: number) => {
    blocks.push(`${"#".repeat(level)} ${outline.text}`);
    const note = noteToMarkdown(outline.note);
    if (note) blocks.push(note);
    if (level < MAX_HEADING_LEVEL) {
      for (const child of outline.children) writeOutline(child, level + 1);
      return;
    }
    const bullets: string[] = [];
    const writeBullet = (entry: Outline, depth: number) => {
      const indent = "  ".repeat(depth);
      bullets.push(`${indent}- ${entry.text}`);
      const entryNote = noteToMarkdown(entry.note);
      if (entryNote) bullets.push(...entryNote.split("\n").map((line) => (line ? `${indent}  ${line}` : line)));
      for (const child of entry.children) writeBullet(child, depth + 1);
    };
    for (const child of outline.children) writeBullet(child, 0);
    if (bullets.length > 0) blocks.push(bullets.join("\n"));
  };

  let title: string;
  if (outlines.length === 1 && outlines[0]) {
    title = headTitle || outlines[0].text;
    writeOutline(outlines[0], 1);
  } else {
    title = headTitle || "Untitled";
    blocks.push(`# ${title}`);
    for (const outline of outlines) writeOutline(outline, 2);
  }

  return { title, markdown: `${blocks.join("\n\n")}\n`, nodeCount: counter.count };
}
