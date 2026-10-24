import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { FileText, Link2, Plus, Unlink, X } from "lucide-react";
import type { NodeRelation } from "./concept-map";

export interface LinkedNoteHandlers {
  onOpenNote: (note: string) => void;
  /** Mouse or Apple Pencil hover shows Obsidian's page preview; touch has no hover. */
  onHoverNote: (event: MouseEvent, note: string, targetEl: HTMLElement) => void;
}

/** Page preview only for hovering pointers; a finger tap opens the note instead. */
export function hoverNoteHandler(note: string, handlers: LinkedNoteHandlers) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    handlers.onHoverNote(event.nativeEvent, note, event.currentTarget);
  };
}

export function LinkedNoteSection({
  note,
  handlers,
  onLink,
  onUnlink,
}: {
  note: string | undefined;
  handlers: LinkedNoteHandlers;
  onLink: () => void;
  onUnlink: () => void;
}) {
  return (
    <section className="bloommd-inspector-section bloommd-linked-note">
      <h4>Linked note</h4>
      {note ? (
        <div className="bloommd-linked-note-row">
          <button type="button" className="bloommd-linked-note-open" title={`Open ${note}`} onClick={() => handlers.onOpenNote(note)} onPointerEnter={hoverNoteHandler(note, handlers)}>
            <FileText size={15} /><span>{note}</span>
          </button>
          <button type="button" className="bloommd-icon-control" title="Link a different note" aria-label="Link a different note" onClick={onLink}><Link2 size={16} /></button>
          <button type="button" className="bloommd-icon-control" title="Remove the link" aria-label="Remove linked note" onClick={onUnlink}><Unlink size={16} /></button>
        </div>
      ) : (
        <button type="button" className="bloommd-link-note-button" aria-label="Link a note" onClick={onLink}>
          <Link2 size={15} /><span>Link a note</span>
        </button>
      )}
      <p className="bloommd-inspector-note">Keep details in the note; the map shows how topics connect.</p>
    </section>
  );
}

export function RelationsSection({
  relations,
  candidates,
  onChange,
}: {
  relations: NodeRelation[];
  /** Other nodes of this map that can be connected. */
  candidates: Array<{ id: string; title: string }>;
  onChange: (relations: NodeRelation[]) => void;
}) {
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const titles = new Map(candidates.map((candidate) => [candidate.id, candidate.title]));
  const available = candidates.filter((candidate) => !relations.some((relation) => relation.target === candidate.id));

  return (
    <section className="bloommd-inspector-section bloommd-relations">
      <h4>Connections</h4>
      {relations.length > 0 && (
        <ul className="bloommd-relation-list">
          {relations.map((relation) => (
            <li key={relation.target}>
              <span className="bloommd-relation-target">{titles.get(relation.target) ?? "Missing node"}</span>
              <input
                aria-label={`Label for the connection to ${titles.get(relation.target) ?? "missing node"}`}
                placeholder="Label"
                defaultValue={relation.label ?? ""}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next === (relation.label ?? "")) return;
                  onChange(relations.map((entry) => (entry.target === relation.target ? { target: entry.target, ...(next ? { label: next } : {}) } : entry)));
                }}
              />
              <button type="button" className="bloommd-icon-control" title="Remove connection" aria-label={`Remove connection to ${titles.get(relation.target) ?? "missing node"}`} onClick={() => onChange(relations.filter((entry) => entry.target !== relation.target))}><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="bloommd-relation-add">
          <select aria-label="Connect to node" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Connect to…</option>
            {available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
          </select>
          <input aria-label="Connection label" placeholder="Label (optional)" value={label} onChange={(event) => setLabel(event.target.value)} />
          <button
            type="button"
            className="bloommd-icon-control"
            title="Add connection"
            aria-label="Add connection"
            disabled={!target}
            onClick={() => {
              onChange([...relations, { target, ...(label.trim() ? { label: label.trim() } : {}) }]);
              setTarget("");
              setLabel("");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
      )}
      <p className="bloommd-inspector-note">Connections link any two nodes of this map, next to the heading structure.</p>
    </section>
  );
}
