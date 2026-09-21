import { Window } from "happy-dom";

/**
 * The standalone mirror bundles a browser-safe Markdown parser for the optional sharing runtime.
 * Its entity decoder probes `document` when it is loaded, so Node-based release tests need a
 * small, real DOM rather than a production-only bundle workaround.
 */
const window = new Window({ url: "https://bloommd.test/obsidian-plugin" });

globalThis.window = window as unknown as Window & typeof globalThis.window;
globalThis.document = window.document as unknown as Document;
globalThis.navigator = window.navigator as unknown as Navigator;
globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
