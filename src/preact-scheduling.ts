import { options } from "preact";

/**
 * `react` and `react-dom` are aliased to preact/compat in the release build (see package.json).
 * React flushes the passive effects of a click or key press before the browser handles the next
 * event; preact defers them until after the next frame (up to 35 ms). The canvas keeps React Flow's
 * node store in sync from effects, so with preact's default a toggle such as study or focus mode
 * would show one stale frame and a follow-up input could act on the old nodes. Flushing in a
 * microtask restores React's ordering: effects still run after the commit, before the next event.
 */
options.requestAnimationFrame = (flush) => queueMicrotask(flush);
