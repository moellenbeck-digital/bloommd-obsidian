/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/ink/src/ink-preview.tsx by the BloomMD mirror sync.
 * Source SHA-256: 10f72dc4edf7459b44ddf90622c75a49cc503e441f0c1c6734d0be576178be7b
 */
import { memo, useMemo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { INK_TEXT_FONT, inkBackgroundFill, inkViewBox, type InkDocument } from "./ink-document";
import { HIGHLIGHTER_OPACITY, INK_TEXT_LINE_HEIGHT, strokeOutlinePath, textLines, type InkStroke, type InkText } from "./ink-geometry";
import { linkBounds } from "./ink-state";

export const StrokePath = memo(function StrokePath({ stroke, dimmed }: { stroke: InkStroke; dimmed: boolean }) {
  const path = useMemo(() => strokeOutlinePath(stroke), [stroke]);
  const opacity = (stroke.tool === "highlighter" ? HIGHLIGHTER_OPACITY : 1) * (dimmed ? 0.25 : 1);
  return <path data-stroke-id={stroke.id} d={path} fill={stroke.color} fillOpacity={opacity} />;
});

export const InkTextElement = memo(function InkTextElement({ text, dimmed }: { text: InkText; dimmed: boolean }) {
  return (
    <text data-text-id={text.id} x={text.x} y={text.y} fontSize={text.size} fontFamily={INK_TEXT_FONT} fill={text.color} fillOpacity={dimmed ? 0.25 : 1}>
      {textLines(text).map((line, index) => (
        <tspan key={index} x={text.x} dy={index === 0 ? text.size : text.size * INK_TEXT_LINE_HEIGHT}>{line}</tspan>
      ))}
    </text>
  );
});

export interface InkLinkHandlers {
  /** Mouse or Apple Pencil hover over linked handwriting: show Obsidian's page preview. */
  onHoverLink: (event: MouseEvent, target: string, targetEl: HTMLElement) => void;
  onOpenLink: (target: string) => void;
}

const LINK_PADDING = 6;

/** Linked handwriting gets a hit area plus a dashed underline so readers can tell it is a link. */
export function InkLinkHotspots({ document, handlers }: { document: InkDocument; handlers: InkLinkHandlers }) {
  return (
    <g className="bloommd-ink-links">
      {document.links.map((link) => {
        const bounds = linkBounds(document, link);
        if (!bounds) return null;
        const x = bounds.minX - LINK_PADDING;
        const y = bounds.minY - LINK_PADDING;
        const width = bounds.maxX - bounds.minX + LINK_PADDING * 2;
        const height = bounds.maxY - bounds.minY + LINK_PADDING * 2;
        const hover = (event: ReactPointerEvent<SVGGElement>) => {
          // Touch has no hover; a finger tap opens the note instead.
          if (event.pointerType === "touch") return;
          handlers.onHoverLink(event.nativeEvent, link.target, event.currentTarget as unknown as HTMLElement);
        };
        const open = (event: ReactMouseEvent<SVGGElement>) => {
          event.stopPropagation();
          handlers.onOpenLink(link.target);
        };
        return (
          <g key={link.id} className="bloommd-ink-link" data-link-target={link.target} role="link" aria-label={`Open ${link.target}`} tabIndex={0} onPointerEnter={hover} onClick={open}>
            <title>{link.target}</title>
            <rect x={x} y={y} width={width} height={height} rx={6} />
            <line x1={x + 2} y1={y + height} x2={x + width - 2} y2={y + height} />
          </g>
        );
      })}
    </g>
  );
}

/** Read-only, interactive rendering of a drawing; used where Obsidian would only show an image. */
export function InkPreview({ document, handlers, label }: { document: InkDocument; handlers: InkLinkHandlers; label: string }) {
  const box = inkViewBox(document);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  return (
    <svg className="bloommd-ink-preview" viewBox={`${box.minX} ${box.minY} ${width} ${height}`} role="img" aria-label={label}>
      {inkBackgroundFill(document.background) && <rect x={box.minX} y={box.minY} width={width} height={height} fill={inkBackgroundFill(document.background)!} />}
      {document.strokes.map((stroke) => <StrokePath key={stroke.id} stroke={stroke} dimmed={false} />)}
      {(document.texts ?? []).map((text) => <InkTextElement key={text.id} text={text} dimmed={false} />)}
      <InkLinkHotspots document={document} handlers={handlers} />
    </svg>
  );
}
