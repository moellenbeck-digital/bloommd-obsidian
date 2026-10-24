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
