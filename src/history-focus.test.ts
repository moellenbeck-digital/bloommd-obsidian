import { describe, expect, test } from "bun:test";
import { historyFocusId } from "./history-focus";

const original = `# Root <!-- bloommd:id=root -->

## Child <!-- bloommd:id=child -->

### Grandchild <!-- bloommd:id=grandchild -->
`;

describe("historyFocusId", () => {
  test("keeps focus on an existing node after a rename or content change", () => {
    const replacement = original.replace("Grandchild", "Renamed");
    expect(historyFocusId(original, replacement, "grandchild")).toBe("grandchild");
  });

  test("moves focus to the parent when undo removes the selected node", () => {
    const replacement = original.replace("\n### Grandchild <!-- bloommd:id=grandchild -->\n", "");
    expect(historyFocusId(original, replacement, "grandchild")).toBe("child");
  });

  test("falls back to the replacement root when the parent is gone too", () => {
    const replacement = "# Root <!-- bloommd:id=root -->\n";
    expect(historyFocusId(original, replacement, "grandchild")).toBe("root");
  });
});
