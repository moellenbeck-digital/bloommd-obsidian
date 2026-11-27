/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ui/src/export/map-export-core.ts by the BloomMD mirror sync.
 * Source SHA-256: 0fa83761d517f2cc1fd1beaa5a88a555063ea77c828ad1515e1118a2cbb37a57
 */
/**
 * Minimal single-page PDF around one JPEG image. A full PDF library would cost far more of the
 * plugin's bundle budget than this one page needs.
 */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | Array<string | Uint8Array>) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const piece of Array.isArray(body) ? body : [body]) push(piece);
    push("\nendobj\n");
  };
  // Page size in points follows the image size (at 72 dpi one image pixel becomes one point).
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;

  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);

  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const pdf = new Uint8Array(length);
  let position = 0;
  for (const part of parts) {
    pdf.set(part, position);
    position += part.length;
  }
  return pdf;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The exported area: all nodes plus handwriting on the map, which may reach beyond them. */
export function exportBounds(
  nodes: { x: number; y: number; width: number; height: number },
  ink: { minX: number; minY: number; maxX: number; maxY: number } | null,
  hasNodes = true,
): { x: number; y: number; width: number; height: number } {
  if (!ink) return nodes;
  if (!hasNodes) return { x: ink.minX, y: ink.minY, width: ink.maxX - ink.minX, height: ink.maxY - ink.minY };
  const minX = Math.min(nodes.x, ink.minX);
  const minY = Math.min(nodes.y, ink.minY);
  const maxX = Math.max(nodes.x + nodes.width, ink.maxX);
  const maxY = Math.max(nodes.y + nodes.height, ink.maxY);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Export size in pixels: the whole map at a readable scale, capped for memory on iPad. */
export function exportSize(bounds: { width: number; height: number }, padding = 48, maxSide = 4096): { width: number; height: number; scale: number } {
  const contentWidth = Math.max(1, bounds.width + padding * 2);
  const contentHeight = Math.max(1, bounds.height + padding * 2);
  const scale = Math.min(2, maxSide / Math.max(contentWidth, contentHeight));
  return { width: Math.round(contentWidth * scale), height: Math.round(contentHeight * scale), scale };
}

export interface MapExportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding box of node rectangles in flow coordinates; `null` for an empty map. */
export function boundsOfRects(rects: readonly MapExportRect[]): MapExportRect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Reads `translate(Xpx, Ypx)` from the inline transform React Flow puts on every node. */
export function parseNodeTranslate(transform: string): { x: number; y: number } | null {
  const match = /translate\(\s*(-?[\d.]+(?:e-?\d+)?)px\s*,\s*(-?[\d.]+(?:e-?\d+)?)px\s*\)/i.exec(transform);
  if (!match) return null;
  const x = Number.parseFloat(match[1] ?? "");
  const y = Number.parseFloat(match[2] ?? "");
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export interface MapExportEdge {
  d: string;
  stroke: string;
  strokeWidth: number;
  dashArray?: number[];
  lineCap?: string;
}

/** A filled path painted above the nodes, such as handwriting on the map. */
export interface MapExportOverlayPath {
  d: string;
  fill: string;
  opacity?: number;
}

export interface MapExportView {
  /** Pixel offset and scale that move flow coordinates into the exported image. */
  x: number;
  y: number;
  scale: number;
}

/** Places `bounds` (plus padding) in an image of `size`, at the scale `exportSize` chose. */
export function exportView(bounds: MapExportRect, size: { scale: number }, padding = 48): MapExportView {
  return { x: (padding - bounds.x) * size.scale, y: (padding - bounds.y) * size.scale, scale: size.scale };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function numberAttribute(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "0";
}

/**
 * Assembles the SVG export. The background and the edges are plain vector elements; the nodes come
 * from html-to-image as a `foreignObject` (live text and boxes, not a bitmap) and are copied over
 * from the SVG it renders. The result is one standalone file that browsers open directly.
 */
export function composeMapSvg(options: {
  width: number;
  height: number;
  background: string;
  view: MapExportView;
  edges: readonly MapExportEdge[];
  /** SVG markup produced by html-to-image `toSvg` for the nodes layer. */
  nodesSvg: string;
  overlay?: readonly MapExportOverlayPath[];
}): string {
  const { width, height, background, view, edges, nodesSvg } = options;
  const start = nodesSvg.indexOf("<foreignObject");
  const end = nodesSvg.lastIndexOf("</foreignObject>");
  if (start === -1 || end === -1) throw new Error("The rendered nodes layer has no content.");
  const nodes = nodesSvg.slice(start, end + "</foreignObject>".length);
  const w = numberAttribute(width);
  const h = numberAttribute(height);
  const paths = edges
    .map((edge) => {
      const dash = edge.dashArray && edge.dashArray.length > 0 ? ` stroke-dasharray="${edge.dashArray.map(numberAttribute).join(" ")}"` : "";
      const cap = edge.lineCap ? ` stroke-linecap="${escapeAttribute(edge.lineCap)}"` : "";
      return `<path d="${escapeAttribute(edge.d)}" stroke="${escapeAttribute(edge.stroke)}" stroke-width="${numberAttribute(edge.strokeWidth)}"${dash}${cap}/>`;
    })
    .join("");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="100%" height="100%" fill="${escapeAttribute(background)}"/>`,
    `<g transform="translate(${numberAttribute(view.x)} ${numberAttribute(view.y)}) scale(${numberAttribute(view.scale)})" fill="none">${paths}</g>`,
    nodes,
    ...(options.overlay && options.overlay.length > 0
      ? [`<g transform="translate(${numberAttribute(view.x)} ${numberAttribute(view.y)}) scale(${numberAttribute(view.scale)})">${options.overlay
          .map((path) => `<path d="${escapeAttribute(path.d)}" fill="${escapeAttribute(path.fill)}"${path.opacity !== undefined && path.opacity !== 1 ? ` fill-opacity="${numberAttribute(path.opacity)}"` : ""}/>`)
          .join("")}</g>`]
      : []),
    `</svg>`,
    ``,
  ].join("\n");
}
