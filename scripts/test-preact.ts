import { mock } from "bun:test";
import * as compat from "preact/compat";
import * as client from "preact/compat/client";
import * as jsxRuntime from "preact/compat/jsx-runtime";
import { act } from "preact/test-utils";
import { dirname } from "node:path";

/**
 * The release bundle aliases React to preact/compat (see the `build` script and README). This
 * preload applies the same alias to `bun test`, so DOM-rendering tests exercise the renderer that
 * actually ships. `act` is not part of preact/compat; tests get preact/test-utils' implementation.
 */
mock.module("react", () => ({ ...compat, default: compat, act }));
mock.module("react/jsx-runtime", () => jsxRuntime);
mock.module("react/jsx-dev-runtime", () => jsxRuntime);
mock.module("react-dom", () => ({ ...compat, default: compat }));
mock.module("react-dom/client", () => client);
// Shared UI sources can resolve the hoisted React copy instead of this plugin's copy.
// Mirror builds contain local snapshots and have no workspace package to resolve.
for (const entry of ["@bloommd/ui/workspace-nodes", "@bloommd/ink/ink-editor"]) {
  let directory: string;
  try {
    directory = dirname(Bun.resolveSync(entry, import.meta.dir));
  } catch (error) {
    // Generated standalone mirrors intentionally have no workspace dependencies.
    if (error instanceof Error && "code" in error && (error.code === "MODULE_NOT_FOUND" || error.code === "ERR_MODULE_NOT_FOUND")) continue;
    throw error;
  }
  mock.module(Bun.resolveSync("react", directory), () => ({ ...compat, default: compat, act }));
  mock.module(Bun.resolveSync("react/jsx-runtime", directory), () => jsxRuntime);
  mock.module(Bun.resolveSync("react/jsx-dev-runtime", directory), () => jsxRuntime);
  mock.module(Bun.resolveSync("react-dom", directory), () => ({ ...compat, default: compat }));
  mock.module(Bun.resolveSync("react-dom/client", directory), () => client);
}
// preact-render-to-string is not a dependency; a synchronous render into a detached element yields
// the same static markup for the small components tests render this way.
mock.module("react-dom/server", () => ({
  renderToStaticMarkup(element: compat.ReactElement) {
    const container = document.createElement("div");
    compat.render(element, container);
    const html = container.innerHTML;
    compat.unmountComponentAtNode(container);
    return html;
  },
}));
