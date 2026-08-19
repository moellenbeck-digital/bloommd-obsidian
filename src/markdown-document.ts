export interface MarkdownHeadingNode {
  id: string;
  level: number;
  title: string;
  content: string;
  children: MarkdownHeadingNode[];
  kind: "heading";
  metadata?: MarkdownNodeMetadata;
  startLine: number;
  /** Last line the heading syntax itself occupies. Differs from `startLine` for Setext headings. */
  headingEndLine: number;
  style: "atx" | "setext";
  contentEndLine: number;
  sectionEndLine: number;
  indent: string;
}

export type MarkdownNodeKind =
  | "topic"
  | "portal"
  | "web"
  | "file"
  | "pdf"
  | "source"
  | "task"
  | "decision";

export interface MarkdownNodeMetadata {
  kind: MarkdownNodeKind;
  url?: string;
  previewTitle?: string;
  previewDescription?: string;
  previewImage?: string;
  file?: string;
  targetNodeId?: string;
  citation?: string;
  status?: "open" | "in_progress" | "done";
  decision?: "proposed" | "accepted" | "rejected";
}

interface ParsedLine {
  line: number;
  /** Last line the heading itself occupies. Equals `line` for ATX, `line + 1` for Setext. */
  endLine: number;
  style: "atx" | "setext";
  level: number;
  title: string;
  indent: string;
  persistedId: string | null;
  metadata?: MarkdownNodeMetadata;
}

/** CommonMark HTML block type 6 tag names. A heading inside such a block is not a heading. */
const HTML_BLOCK_TAGS = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center",
  "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head",
  "header", "hr", "html", "iframe", "legend", "li", "link", "main", "menu", "menuitem", "nav",
  "noframes", "ol", "optgroup", "option", "p", "param", "section", "source", "summary", "table",
  "tbody", "td", "tfoot", "th", "thead", "title", "tr", "track", "ul",
]);

const HTML_RAW_TAGS = new Set(["script", "pre", "style", "textarea"]);

/**
 * Removes an optional ATX closing sequence (`# Title ###`). Per CommonMark the closing run of
 * hashes only counts when it is preceded by whitespace, so `# Title#` keeps its trailing hash.
 */
function stripClosingSequence(title: string): string {
  const closed = /^(.*?)\s+#+\s*$/.exec(title);
  if (closed) return closed[1]!;
  return /^#+$/.test(title.trim()) ? "" : title;
}

interface MarkdownLines {
  lines: string[];
  eol: string;
}

function stripBloomMetadata(title: string): string {
  return title.replace(/\s*<!--\s*bloommd:(?:id|meta)=[\s\S]*?-->\s*/gi, " ").trim();
}

function extractBloomId(title: string): string | null {
  return title.match(/<!--\s*bloommd:id=([A-Za-z0-9_-]+)\s*-->/i)?.[1] ?? null;
}

const NODE_KINDS = new Set<MarkdownNodeKind>(["topic", "portal", "web", "file", "pdf", "source", "task", "decision"]);

function parseNodeMetadata(title: string): MarkdownNodeMetadata | undefined {
  const value = title.match(/<!--\s*bloommd:meta=(\{.*\})\s*-->/i)?.[1];
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind !== "string" || !NODE_KINDS.has(kind as MarkdownNodeKind)) return undefined;
    return {
      kind: kind as MarkdownNodeKind,
      ...(typeof record.url === "string" ? { url: record.url } : {}),
      ...(typeof record.previewTitle === "string" ? { previewTitle: record.previewTitle } : {}),
      ...(typeof record.previewDescription === "string" ? { previewDescription: record.previewDescription } : {}),
      ...(typeof record.previewImage === "string" ? { previewImage: record.previewImage } : {}),
      ...(typeof record.file === "string" ? { file: record.file } : {}),
      ...(typeof record.targetNodeId === "string" ? { targetNodeId: record.targetNodeId } : {}),
      ...(typeof record.citation === "string" ? { citation: record.citation } : {}),
      ...(record.status === "open" || record.status === "in_progress" || record.status === "done" ? { status: record.status } : {}),
      ...(record.decision === "proposed" || record.decision === "accepted" || record.decision === "rejected" ? { decision: record.decision } : {}),
    };
  } catch (error) {
    console.warn("BloomMD: ignored malformed node metadata", error);
    return undefined;
  }
}

function generateNodeId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function splitMarkdown(markdown: string): MarkdownLines {
  return {
    lines: markdown.split(/\r?\n/),
    eol: markdown.includes("\r\n") ? "\r\n" : "\n",
  };
}

/**
 * Frontmatter only exists when the opening `---` has a matching terminator. An unterminated block
 * is ordinary content, so headings below it must stay visible instead of swallowing the note.
 */
function frontmatterEndLine(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let index = 1; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    if (trimmed === "---" || trimmed === "...") return index;
  }
  return -1;
}

function parseHeadingLines(lines: string[]): ParsedLine[] {
  const headings: ParsedLine[] = [];
  const frontmatterEnd = frontmatterEndLine(lines);
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;
  let htmlBlock: "raw" | "comment" | "block" | null = null;
  // Index of the previous line when it can act as a Setext heading title.
  let setextCandidate: number | null = null;

  lines.forEach((line, index) => {
    if (index <= frontmatterEnd) return;

    const trimmed = line.trim();

    if (htmlBlock) {
      if (htmlBlock === "raw" && /<\/(script|pre|style|textarea)>/i.test(line)) htmlBlock = null;
      else if (htmlBlock === "comment" && line.includes("-->")) htmlBlock = null;
      else if (htmlBlock === "block" && trimmed === "") htmlBlock = null;
      setextCandidate = null;
      return;
    }

    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence?.[1]) {
      const character = fence[1][0] as "`" | "~";
      if (!fenceCharacter) {
        fenceCharacter = character;
        fenceLength = fence[1].length;
      } else if (character === fenceCharacter && fence[1].length >= fenceLength) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      setextCandidate = null;
      return;
    }

    if (fenceCharacter) {
      setextCandidate = null;
      return;
    }

    const htmlStart = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(line);
    if (/^ {0,3}<!--/.test(line)) {
      if (!line.includes("-->")) htmlBlock = "comment";
      setextCandidate = null;
      return;
    }
    if (htmlStart?.[1]) {
      const tag = htmlStart[1].toLowerCase();
      if (HTML_RAW_TAGS.has(tag)) {
        if (!new RegExp(`</${tag}>`, "i").test(line)) htmlBlock = "raw";
        setextCandidate = null;
        return;
      }
      if (HTML_BLOCK_TAGS.has(tag)) {
        htmlBlock = "block";
        setextCandidate = null;
        return;
      }
    }

    const atx = /^( {0,3})(#{1,6})(?:[\t ]+(.*?))?\s*$/.exec(line);
    if (atx) {
      const rawTitle = stripClosingSequence(atx[3] ?? "");
      headings.push({
        line: index,
        endLine: index,
        style: "atx",
        level: atx[2]!.length,
        title: stripBloomMetadata(rawTitle),
        indent: atx[1]!,
        persistedId: extractBloomId(rawTitle),
        metadata: parseNodeMetadata(rawTitle),
      });
      setextCandidate = null;
      return;
    }

    // A Setext underline turns the preceding paragraph line into a heading.
    const underline = /^ {0,3}(=+|-+)\s*$/.exec(line);
    if (underline && setextCandidate !== null) {
      const titleLine = lines[setextCandidate]!;
      const rawTitle = titleLine.trim();
      headings.push({
        line: setextCandidate,
        endLine: index,
        style: "setext",
        level: underline[1]!.startsWith("=") ? 1 : 2,
        title: stripBloomMetadata(rawTitle),
        indent: /^( {0,3})/.exec(titleLine)![1]!,
        persistedId: extractBloomId(rawTitle),
        metadata: parseNodeMetadata(rawTitle),
      });
      setextCandidate = null;
      return;
    }

    // Blank lines, block quotes and list markers cannot become a Setext title.
    setextCandidate = trimmed === "" || /^ {0,3}(>|[-*+]\s|\d+[.)]\s)/.test(line) ? null : index;
  });

  return headings;
}

export function parseHeadingTree(markdown: string): MarkdownHeadingNode[] {
  const { lines } = splitMarkdown(markdown);
  const parsed = parseHeadingLines(lines);
  const roots: MarkdownHeadingNode[] = [];
  const stack: MarkdownHeadingNode[] = [];

  const seenIds = new Set<string>();
  parsed.forEach((heading, index) => {
    const nextHeading = parsed[index + 1];
    const nextPeer = parsed.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const node: MarkdownHeadingNode = {
      id: heading.persistedId && !seenIds.has(heading.persistedId)
        ? heading.persistedId
        : `heading-${heading.line}`,
      level: heading.level,
      title: heading.title,
      content: lines.slice(heading.endLine + 1, nextHeading?.line ?? lines.length).join("\n").trim(),
      children: [],
      kind: "heading",
      startLine: heading.line,
      headingEndLine: heading.endLine,
      style: heading.style,
      contentEndLine: nextHeading?.line ?? lines.length,
      sectionEndLine: nextPeer?.line ?? lines.length,
      indent: heading.indent,
      ...(heading.metadata ? { metadata: heading.metadata } : {}),
    };
    seenIds.add(node.id);

    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });

  return roots;
}

export function ensureHeadingIds(markdown: string): { markdown: string; changed: boolean } {
  const { lines, eol } = splitMarkdown(markdown);
  const headings = parseHeadingLines(lines);
  const seen = new Set<string>();
  let changed = false;

  headings.forEach((heading) => {
    if (heading.persistedId && !seen.has(heading.persistedId)) {
      seen.add(heading.persistedId);
      return;
    }

    let id = generateNodeId();
    while (seen.has(id)) id = generateNodeId();
    seen.add(id);
    // Existing id comments are replaced rather than appended. A heading duplicated in the editor
    // carries a stale id, and appending would grow the line by one comment on every single open.
    const withoutIds = lines[heading.line]!.replace(/\s*<!--\s*bloommd:id=[\s\S]*?-->/gi, "");
    lines[heading.line] = `${withoutIds.trimEnd()} <!-- bloommd:id=${id} -->`;
    changed = true;
  });

  return { markdown: lines.join(eol), changed };
}

export function flattenHeadings(nodes: MarkdownHeadingNode[]): MarkdownHeadingNode[] {
  return nodes.flatMap((node) => [node, ...flattenHeadings(node.children)]);
}

export function findHeading(nodes: MarkdownHeadingNode[], id: string): MarkdownHeadingNode | null {
  return flattenHeadings(nodes).find((node) => node.id === id) ?? null;
}

export function findHeadingParent(nodes: MarkdownHeadingNode[], childId: string): MarkdownHeadingNode | null {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === childId)) return node;
    const nested = findHeadingParent(node.children, childId);
    if (nested) return nested;
  }
  return null;
}

function requireHeading(markdown: string, id: string): MarkdownHeadingNode {
  const node = findHeading(parseHeadingTree(markdown), id);
  if (!node) throw new Error("The note changed. Refresh the mind map and try again.");
  return node;
}

function persistedMetadataSuffix(line: string): string {
  return [...line.matchAll(/<!--\s*bloommd:(?:id|meta)=[\s\S]*?-->/gi)].map((match) => match[0]).join(" ");
}

function persistedTypeMetadataSuffix(line: string): string {
  return [...line.matchAll(/<!--\s*bloommd:meta=[\s\S]*?-->/gi)].map((match) => match[0]).join(" ");
}

function serializeNodeMetadata(metadata: MarkdownNodeMetadata): string {
  return `<!-- bloommd:meta=${JSON.stringify(metadata).replace(/-->/g, "--\\u003e")} -->`;
}

function sameMetadata(left: MarkdownNodeMetadata | undefined, right: MarkdownNodeMetadata | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function renameHeading(markdown: string, id: string, title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle || /[\r\n]/.test(trimmedTitle)) throw new Error("A node title must be one non-empty line.");
  const node = requireHeading(markdown, id);
  const { lines, eol } = splitMarkdown(markdown);
  const suffix = persistedMetadataSuffix(lines[node.startLine] ?? "");
  // Setext headings keep their underline, so only the title line is rewritten.
  lines[node.startLine] = node.style === "setext"
    ? `${node.indent}${trimmedTitle}${suffix ? ` ${suffix}` : ""}`
    : `${node.indent}${"#".repeat(node.level)} ${trimmedTitle}${suffix ? ` ${suffix}` : ""}`;
  return lines.join(eol);
}

export function updateHeadingContent(markdown: string, id: string, content: string): string {
  const node = requireHeading(markdown, id);
  const { lines, eol } = splitMarkdown(markdown);
  const body = content.replace(/\r\n/g, "\n").split("\n");
  while (body[0]?.trim() === "") body.shift();
  while (body[body.length - 1]?.trim() === "") body.pop();
  const replacement = body.length > 0 ? ["", ...body, ""] : [""];
  lines.splice(node.headingEndLine + 1, node.contentEndLine - node.headingEndLine - 1, ...replacement);
  return lines.join(eol);
}

export function updateHeadingMetadata(markdown: string, id: string, metadata: MarkdownNodeMetadata | undefined): string {
  const node = requireHeading(markdown, id);
  if (metadata?.kind === "topic") metadata = undefined;
  const { lines, eol } = splitMarkdown(markdown);
  const source = lines[node.startLine] ?? "";
  const withoutMetadata = source.replace(/\s*<!--\s*bloommd:meta=[\s\S]*?-->/gi, "").trimEnd();
  const suffix = metadata ? ` ${serializeNodeMetadata(metadata)}` : "";
  lines[node.startLine] = `${withoutMetadata}${suffix}`;
  return lines.join(eol);
}

export function metadataEquals(left: MarkdownNodeMetadata | undefined, right: MarkdownNodeMetadata | undefined): boolean {
  return sameMetadata(left, right);
}

export function editHeading(markdown: string, id: string, title: string, content: string): string {
  return updateHeadingContent(renameHeading(markdown, id, title), id, content);
}

export function addChildHeading(markdown: string, parentId: string, title = "New node"): string {
  const parent = requireHeading(markdown, parentId);
  if (parent.level >= 6) throw new Error("Markdown supports at most six heading levels.");

  const { lines, eol } = splitMarkdown(markdown);
  const block = [`${"#".repeat(parent.level + 1)} ${title.trim() || "New node"} <!-- bloommd:id=${generateNodeId()} -->`, ""];
  if (parent.sectionEndLine > 0 && lines[parent.sectionEndLine - 1]?.trim() !== "") block.unshift("");
  lines.splice(parent.sectionEndLine, 0, ...block);
  return lines.join(eol);
}

export function addSiblingHeading(markdown: string, siblingId: string, title = "New node"): string {
  const sibling = requireHeading(markdown, siblingId);
  const roots = parseHeadingTree(markdown);
  if (roots[0]?.id === siblingId) throw new Error("A sibling cannot be added next to the root node.");

  const { lines, eol } = splitMarkdown(markdown);
  const block = [`${"#".repeat(sibling.level)} ${title.trim() || "New node"} <!-- bloommd:id=${generateNodeId()} -->`, ""];
  if (sibling.sectionEndLine > 0 && lines[sibling.sectionEndLine - 1]?.trim() !== "") block.unshift("");
  lines.splice(sibling.sectionEndLine, 0, ...block);
  return lines.join(eol);
}

export function deleteHeadingBranch(markdown: string, id: string): string {
  const roots = parseHeadingTree(markdown);
  const node = findHeading(roots, id);
  if (!node) throw new Error("The note changed. Refresh the mind map and try again.");
  if (roots[0]?.id === id) throw new Error("The root node cannot be deleted.");

  const { lines, eol } = splitMarkdown(markdown);
  lines.splice(node.startLine, node.sectionEndLine - node.startLine);
  while (node.startLine > 0 && lines[node.startLine - 1]?.trim() === "" && lines[node.startLine]?.trim() === "") {
    lines.splice(node.startLine, 1);
  }
  return lines.join(eol);
}

function containsNode(node: MarkdownHeadingNode, candidateId: string): boolean {
  return node.children.some((child) => child.id === candidateId || containsNode(child, candidateId));
}

/**
 * Rewrites every heading inside a copied or moved branch to its new level. Setext headings stay
 * Setext while the target level still has an underline form and are converted to ATX otherwise,
 * which is why the underline line may have to disappear from the branch.
 */
function rewriteBranchLevels(
  branch: string[],
  sourceNodes: MarkdownHeadingNode[],
  sourceStartLine: number,
  levelDelta: number,
  suffixFor: (line: string) => string,
): string[] {
  const dropped = new Set<number>();

  sourceNodes.forEach((node) => {
    const relativeLine = node.startLine - sourceStartLine;
    const suffix = suffixFor(branch[relativeLine] ?? "");
    const newLevel = node.level + levelDelta;

    if (node.style === "setext" && newLevel <= 2) {
      const underlineRelative = node.headingEndLine - sourceStartLine;
      branch[relativeLine] = `${node.indent}${node.title}${suffix ? ` ${suffix}` : ""}`;
      branch[underlineRelative] = (newLevel === 1 ? "=" : "-").repeat(
        Math.max(3, (branch[underlineRelative] ?? "").trim().length),
      );
      return;
    }

    if (node.style === "setext") dropped.add(node.headingEndLine - sourceStartLine);
    branch[relativeLine] = `${node.indent}${"#".repeat(newLevel)} ${node.title}${suffix ? ` ${suffix}` : ""}`;
  });

  return branch.filter((_, index) => !dropped.has(index));
}

export function moveHeadingBranch(markdown: string, sourceId: string, targetParentId: string): string {
  const roots = parseHeadingTree(markdown);
  const source = findHeading(roots, sourceId);
  const target = findHeading(roots, targetParentId);
  if (!source || !target) throw new Error("The note changed. Refresh the mind map and try again.");
  if (roots[0]?.id === sourceId) throw new Error("The root node cannot be moved.");
  if (source.id === target.id || containsNode(source, target.id)) {
    throw new Error("A branch cannot be moved into itself.");
  }

  const sourceNodes = flattenHeadings([source]);
  const deepestRelativeLevel = Math.max(...sourceNodes.map((node) => node.level - source.level));
  const newLevel = target.level + 1;
  if (newLevel + deepestRelativeLevel > 6) {
    throw new Error("This move would exceed Markdown heading level 6.");
  }

  const { lines, eol } = splitMarkdown(markdown);
  const branchLength = source.sectionEndLine - source.startLine;
  const branch = rewriteBranchLevels(
    lines.slice(source.startLine, source.sectionEndLine),
    sourceNodes,
    source.startLine,
    newLevel - source.level,
    persistedMetadataSuffix,
  );

  lines.splice(source.startLine, branchLength);
  // The branch was spliced out first, so every original index at or after its end shifts left.
  // Using a strict `>` missed the case where the target section ends exactly where the branch did —
  // moving a node onto its own parent then inserted it past the section and broke the hierarchy.
  const insertionLine = target.sectionEndLine >= source.sectionEndLine
    ? target.sectionEndLine - branchLength
    : target.sectionEndLine;
  if (insertionLine > 0 && lines[insertionLine - 1]?.trim() !== "" && branch[0]?.trim() !== "") {
    branch.unshift("");
  }
  lines.splice(insertionLine, 0, ...branch);
  return lines.join(eol);
}

export function copyHeadingBranch(markdown: string, sourceId: string, targetParentId: string): string {
  const roots = parseHeadingTree(markdown);
  const source = findHeading(roots, sourceId);
  const target = findHeading(roots, targetParentId);
  if (!source || !target) throw new Error("The note changed. Refresh the mind map and try again.");
  if (source.id === target.id || containsNode(source, target.id)) {
    throw new Error("Select a destination outside the copied branch.");
  }

  const sourceNodes = flattenHeadings([source]);
  const deepestRelativeLevel = Math.max(...sourceNodes.map((node) => node.level - source.level));
  const newLevel = target.level + 1;
  if (newLevel + deepestRelativeLevel > 6) {
    throw new Error("This copy would exceed Markdown heading level 6.");
  }

  const { lines, eol } = splitMarkdown(markdown);
  // A copy must not reuse node identities, so every heading receives a fresh id.
  const branch = rewriteBranchLevels(
    lines.slice(source.startLine, source.sectionEndLine),
    sourceNodes,
    source.startLine,
    newLevel - source.level,
    (line) => {
      const metadata = persistedTypeMetadataSuffix(line);
      return `<!-- bloommd:id=${generateNodeId()} -->${metadata ? ` ${metadata}` : ""}`;
    },
  );

  if (target.sectionEndLine > 0 && lines[target.sectionEndLine - 1]?.trim() !== "" && branch[0]?.trim() !== "") {
    branch.unshift("");
  }
  lines.splice(target.sectionEndLine, 0, ...branch);
  return lines.join(eol);
}
