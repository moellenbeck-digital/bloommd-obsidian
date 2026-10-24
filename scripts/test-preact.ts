import { mock } from "bun:test";
import * as compat from "preact/compat";
import * as client from "preact/compat/client";
import * as jsxRuntime from "preact/compat/jsx-runtime";
import { act } from "preact/test-utils";

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
