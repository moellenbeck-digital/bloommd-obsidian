import { describe, expect, test } from "bun:test";
import { BAR_MARGIN, DEFAULT_PLACEMENT, barPosition, readPlacement, settleBar } from "./map-ink-bar";

const container = { width: 1000, height: 700 };
const bar = { width: 400, height: 50 };

describe("map drawing tools placement", () => {
  test("starts centred at the top", () => {
    expect(barPosition(DEFAULT_PLACEMENT, bar, container)).toEqual({ left: 300, top: BAR_MARGIN });
  });

  test("dropped in the middle it floats where it was dropped", () => {
    const placement = settleBar({ left: 200, top: 300 }, 400, bar, container, false);
    expect(placement.dock).toBe("float");
    expect(barPosition(placement, bar, container)).toEqual({ left: 200, top: 300 });
  });

  test("let go near the left or right edge it docks there, upright – even a bar as wide as the map", () => {
    const upright = { width: 50, height: 400 };
    expect(settleBar({ left: 20, top: 100 }, 30, upright, container, false).dock).toBe("left");
    expect(settleBar({ left: 940, top: 100 }, 970, upright, container, false).dock).toBe("right");
    expect(settleBar({ left: 12, top: 100 }, 40, { width: 976, height: 50 }, container, false).dock).toBe("left");
    expect(settleBar({ left: 12, top: 100 }, 500, { width: 976, height: 50 }, container, false).dock).toBe("float");
    const right = settleBar({ left: 930, top: 100 }, 960, upright, container, false);
    expect(barPosition(right, upright, container).left).toBe(container.width - upright.width - BAR_MARGIN);
  });

  test("keeps its place relative to the map when the map is resized", () => {
    const placement = settleBar({ left: 300 + BAR_MARGIN, top: 200 }, 500, bar, container, true);
    const wider = barPosition(placement, bar, { width: 1600, height: 700 });
    expect(wider.left).toBeGreaterThan(300);
    expect(wider.left + bar.width).toBeLessThanOrEqual(1600 - BAR_MARGIN);
    expect(placement.collapsed).toBe(true);
  });

  test("never leaves the map, even when the map is smaller than the tools", () => {
    expect(barPosition({ dock: "float", x: 1, y: 1, collapsed: false }, bar, { width: 300, height: 40 })).toEqual({ left: BAR_MARGIN, top: BAR_MARGIN });
  });

  test("reads a remembered place and ignores broken or missing values", () => {
    expect(readPlacement({ getItem: () => JSON.stringify({ dock: "right", x: 0.2, y: 0.9, collapsed: true }) })).toEqual({ dock: "right", x: 0.2, y: 0.9, collapsed: true });
    expect(readPlacement({ getItem: () => "{oops" })).toEqual(DEFAULT_PLACEMENT);
    expect(readPlacement({ getItem: () => JSON.stringify({ dock: "top", x: 7, y: "a" }) })).toEqual({ dock: "float", x: 1, y: 0, collapsed: false });
    expect(readPlacement(undefined)).toEqual(DEFAULT_PLACEMENT);
  });
});
