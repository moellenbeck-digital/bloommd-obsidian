import { useCallback, useEffect, useRef, useState } from "react";
import { PenLine, Plus } from "lucide-react";
import { createInkDocument, parseInkSvg, serializeInkSvg, type InkDocument } from "./ink-document";
import { svgEmbeds } from "./ink-embeds";
import { InkPreview, type InkLinkHandlers } from "./ink-preview";

/** Vault access for drawings of one node, provided by the Obsidian view. */
export interface InkVaultActions extends InkLinkHandlers {
  pickNote: () => Promise<string | null>;
  /** Adds a child node below the current one that holds this drawing. */
  createNodeFromInk: (svg: string, title: string) => Promise<boolean>;
  readInk: (path: string) => Promise<string | null>;
  /**
   * Replaces the drawing at `path` while it still equals `expectedSvg`, or creates a new drawing (and
   * embeds it into the node) when `path` is null. `conflictOf` names the drawing a new file replaces
   * after its save failed, so the copy can be named after it. Resolves to the vault path, or null.
   */
  saveInk: (path: string | null, svg: string, expectedSvg: string | null, conflictOf?: string) => Promise<string | null>;
  resolveEmbed: (link: string) => string | null;
  resourceUrl: (path: string) => string;
}

export interface InkSession {
  key: number;
  path: string | null;
  document: InkDocument;
  readOnly: boolean;
}

export interface NodeDrawing {
  link: string;
  path: string | null;
}

export function nodeDrawings(markdown: string, resolveEmbed: (link: string) => string | null): NodeDrawing[] {
  return svgEmbeds(markdown).map((embed) => ({ link: embed.link, path: resolveEmbed(embed.link) }));
}

const AUTOSAVE_DELAY = 700;

interface InkTarget {
  path: string | null;
  baseline: string | null;
  /** Captured when the drawing opens, so later saves go to that note and node even after the view moved on. */
  save: InkVaultActions["saveInk"];
}

/**
 * Owns one open drawing: debounced autosave, strictly sequential writes (the first save creates the
 * file, later saves must target it) and conflict detection against the last content we saw on disk.
 * Each drawing keeps the save action it was opened with, so edits still pending when the view moves
 * on to another note are written to the drawing (and note) they were made in.
 *
 * When the file changed elsewhere (another device, a rename) or vanished, the other version is kept
 * and the drawing continues in a copy. If even that fails, autosave pauses and the strokes stay in
 * memory; `close` and unmounting retry, and `close` keeps the drawing open until it is saved.
 * `refresh` picks up versions synced from elsewhere; `reload` is the explicit way to drop unsaved
 * strokes in favour of the version on disk.
 */
export function useInkSession(actions: Pick<InkVaultActions, "readInk" | "saveInk">, initialBackground?: InkDocument["background"]) {
  const [session, setSession] = useState<InkSession | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "conflict">("saved");
  const [error, setError] = useState<string | null>(null);
  /** Path of the copy the drawing continues in after a conflict. */
  const [conflictCopy, setConflictCopy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const target = useRef<InkTarget | null>(null);
  const pending = useRef<InkDocument | null>(null);
  /** The last write was refused; the editor holds strokes that are not on disk. */
  const failed = useRef(false);
  const timer = useRef<number | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const keyCounter = useRef(0);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const flush = useCallback((): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const document = pending.current;
    if (!document) return queue.current;
    pending.current = null;
    queue.current = queue.current.then(async () => {
      const current = target.current;
      if (!current) return;
      // Drawing and undoing everything before the first save leaves nothing worth a new file.
      if (current.path === null && document.strokes.length === 0 && document.links.length === 0 && !document.texts?.length) {
        setSaveState(pending.current ? "saving" : "saved");
        return;
      }
      const svg = serializeInkSvg(document);
      let path = await current.save(current.path, svg, current.baseline);
      if (!path && current.path !== null) {
        path = await current.save(null, svg, null, current.path);
        if (path) setConflictCopy(path);
      }
      if (path) {
        failed.current = false;
        current.path = path;
        current.baseline = svg;
        setSession((open) => open && open.path !== path ? { ...open, path } : open);
        setSaveState(pending.current ? "saving" : "saved");
        setRevision((value) => value + 1);
      } else {
        // Keep the strokes for the next attempt; newer edits already waiting supersede them.
        failed.current = true;
        pending.current ??= document;
        setSaveState("conflict");
      }
    });
    return queue.current;
  }, []);

  useEffect(() => () => { void flush(); }, [flush]);

  const change = useCallback((document: InkDocument) => {
    pending.current = document;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    // After a failed save, retrying every few hundred milliseconds would only repeat the error.
    if (failed.current) return;
    setSaveState("saving");
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY);
  }, [flush]);

  const reset = useCallback((next: InkTarget) => {
    keyCounter.current += 1;
    target.current = next;
    failed.current = false;
    setConflictCopy(null);
    setSaveState("saved");
  }, []);

  /** Saves until nothing is pending; false when strokes could not be written and must stay open. */
  const settle = useCallback(async (): Promise<boolean> => {
    do {
      await flush();
    } while (pending.current && !failed.current);
    return !failed.current && !pending.current;
  }, [flush]);

  const create = useCallback(async () => {
    if (!(await settle())) return;
    reset({ path: null, baseline: null, save: actionsRef.current.saveInk });
    setError(null);
    // New drawings follow the Obsidian theme: dark paper in dark mode, white paper otherwise.
    const dark = typeof document !== "undefined" && document.body.classList.contains("theme-dark");
    setSession({ key: keyCounter.current, path: null, document: createInkDocument(initialBackground ?? (dark ? "dark" : "paper")), readOnly: false });
  }, [initialBackground, reset, settle]);

  const open = useCallback(async (path: string) => {
    if (!(await settle())) return;
    setError(null);
    try {
      const svg = await actionsRef.current.readInk(path);
      if (svg === null) throw new Error("The drawing file could not be found.");
      const parsed = parseInkSvg(svg);
      if (!parsed) throw new Error("This SVG was not created with BloomMD and cannot be edited here.");
      reset({ path, baseline: svg, save: actionsRef.current.saveInk });
      setSession({ key: keyCounter.current, path, document: parsed.document, readOnly: parsed.readOnly });
    } catch (caught) {
      console.error("BloomMD could not open the drawing", caught);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [reset, settle]);

  /**
   * Strokes drawn while the final save runs are saved too, before the target is cleared. Resolves to
   * false (and keeps the drawing open) when they could not be saved.
   */
  const close = useCallback(async (): Promise<boolean> => {
    if (!(await settle())) return false;
    target.current = null;
    setConflictCopy(null);
    setSession(null);
    return true;
  }, [settle]);

  /**
   * Picks up a version of the open drawing written elsewhere (sync, another device). Strokes that
   * are not on disk yet are never replaced: the session reports a conflict and `reload` decides.
   */
  const refresh = useCallback(async () => {
    await queue.current;
    const current = target.current;
    if (!current?.path) return;
    const svg = await actionsRef.current.readInk(current.path);
    if (svg === null || svg === current.baseline || target.current !== current) return;
    if (pending.current || failed.current) {
      setSaveState("conflict");
      return;
    }
    await open(current.path);
  }, [open]);

  /** Drops unsaved strokes and loads the drawing as it is on disk now. */
  const reload = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    await queue.current;
    // A save that was refused before must not keep `open` from loading the version on disk.
    failed.current = false;
    const path = target.current?.path;
    if (path) await open(path);
  }, [open]);

  return { session, saveState, error, conflictCopy, revision, change, create, open, close, flush, refresh, reload };
}

type PreviewState = { kind: "ink"; document: InkDocument } | { kind: "image" } | { kind: "missing" };

/** Loads a drawing for the list: BloomMD ink renders interactively (links, hover), other SVGs as images. */
function useDrawingPreview(path: string | null, actions: InkVaultActions, revision: number): PreviewState {
  const [state, setState] = useState<PreviewState>({ kind: "image" });
  const readInk = actions.readInk;
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setState({ kind: "missing" });
      return;
    }
    readInk(path)
      .then((svg) => {
        if (cancelled) return;
        const parsed = svg === null ? null : parseInkSvg(svg);
        setState(parsed ? { kind: "ink", document: parsed.document } : { kind: svg === null ? "missing" : "image" });
      })
      .catch((error: unknown) => {
        // Damaged drawings still show as images; the editor reports the parse error when opened.
        console.error("BloomMD could not preview the drawing", error);
        if (!cancelled) setState({ kind: "image" });
      });
    return () => {
      cancelled = true;
    };
  }, [path, readInk, revision]);
  return state;
}

function DrawingCard({ drawing, actions, revision, onEdit }: { drawing: NodeDrawing; actions: InkVaultActions; revision: number; onEdit: (path: string) => void }) {
  const preview = useDrawingPreview(drawing.path, actions, revision);
  const path = drawing.path;
  return (
    <div className="bloommd-ink-thumb" onClick={() => path && onEdit(path)}>
      {preview.kind === "ink" ? (
        <InkPreview document={preview.document} handlers={actions} label={`Drawing ${drawing.link}`} />
      ) : preview.kind === "image" && path ? (
        <img key={revision} src={actions.resourceUrl(path)} alt={`Drawing ${drawing.link}`} draggable={false} />
      ) : (
        <span>{drawing.link} was not found in the vault</span>
      )}
      {path && preview.kind === "ink" && (
        <button type="button" className="bloommd-ink-thumb-edit" title={`Edit ${drawing.link}`} aria-label={`Edit ${drawing.link}`} onClick={(event) => { event.stopPropagation(); onEdit(path); }}>
          <PenLine size={14} />
        </button>
      )}
    </div>
  );
}

export function InkDrawingList({
  drawings,
  actions,
  revision,
  onEdit,
  onCreate,
}: {
  drawings: NodeDrawing[];
  actions: InkVaultActions;
  revision: number;
  onEdit: (path: string) => void;
  onCreate?: () => void;
}) {
  if (drawings.length === 0 && !onCreate) return null;
  return (
    <div className="bloommd-ink-list">
      {drawings.map((drawing) => <DrawingCard key={drawing.link} drawing={drawing} actions={actions} revision={revision} onEdit={onEdit} />)}
      {onCreate && (
        <button type="button" className="bloommd-ink-new" onClick={onCreate}>
          <Plus size={18} />
          <span>New drawing</span>
        </button>
      )}
    </div>
  );
}
