import { describe, expect, test } from "bun:test";
import { dataUrlToBytes, exportBounds, exportSize, jpegToPdf } from "./map-export";

describe("jpegToPdf", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = jpegToPdf(jpeg, 800.4, 600);
  const text = new TextDecoder("latin1").decode(pdf);

  test("writes a one-page PDF sized to the image with the JPEG embedded", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 800 600]");
    expect(text).toContain("/Filter /DCTDecode /Length 9");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const start = text.indexOf("stream\n") + "stream\n".length;
    expect([...pdf.slice(start, start + jpeg.length)]).toEqual([...jpeg]);
  });

  test("has a cross-reference table pointing at every object", () => {
    const xrefOffset = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe("xref");
    const offsets = [...text.slice(xrefOffset).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => expect(text.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`));
  });
});

describe("export helpers", () => {
  test("decodes data URLs", () => {
    expect([...dataUrlToBytes("data:image/png;base64,iVBORw==")]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("renders small maps at 2x and caps large ones", () => {
    expect(exportSize({ width: 404, height: 204 })).toEqual({ width: 1000, height: 600, scale: 2 });
    const large = exportSize({ width: 9904, height: 1904 });
    expect(large.width).toBe(4096);
    expect(large.scale).toBeCloseTo(4096 / 10000);
  });
});

describe("exportBounds", () => {
  const nodes = { x: 0, y: 0, width: 200, height: 100 };

  test("includes handwriting drawn beyond the nodes", () => {
    expect(exportBounds(nodes, { minX: -50, minY: 20, maxX: 120, maxY: 300 })).toEqual({ x: -50, y: 0, width: 250, height: 300 });
  });

  test("keeps the node bounds without handwriting and uses only the ink without nodes", () => {
    expect(exportBounds(nodes, null)).toEqual(nodes);
    expect(exportBounds({ x: 0, y: 0, width: 0, height: 0 }, { minX: 10, minY: 10, maxX: 30, maxY: 50 }, false)).toEqual({ x: 10, y: 10, width: 20, height: 40 });
  });
});
