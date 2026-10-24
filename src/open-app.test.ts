import { describe, expect, test } from "bun:test";
import { desktopNodeId, desktopOpenUrl, mobileOpenUrl } from "./open-app";

describe("mobileOpenUrl", () => {
  test("names the note by its vault path, which the app resolves in the same opened vault", () => {
    expect(mobileOpenUrl("Schule/Physik.md", "k3Xa9_z")).toBe("bloommd://open?path=Schule%2FPhysik.md&node=k3Xa9_z");
    expect(mobileOpenUrl("Notiz.md", "heading-4")).toBe("bloommd://open?path=Notiz.md");
  });
});

describe("desktopOpenUrl", () => {
  test("opens the note at the selected node", () => {
    expect(desktopOpenUrl("/Users/max/Vault/Physik/Thermodynamik.md", "k3Xa9_z")).toBe("bloommd://open?path=%2FUsers%2Fmax%2FVault%2FPhysik%2FThermodynamik.md&node=k3Xa9_z");
  });

  test("encodes spaces and umlauts in the path", () => {
    const url = new URL(desktopOpenUrl("/Users/max/iCloud Drive/Übung 1.md"));
    expect(url.searchParams.get("path")).toBe("/Users/max/iCloud Drive/Übung 1.md");
    expect(url.searchParams.has("node")).toBe(false);
  });

  test("leaves out ids that are not stored in the file or are malformed", () => {
    expect(desktopOpenUrl("/a.md", "heading-12")).toBe("bloommd://open?path=%2Fa.md");
    expect(desktopOpenUrl("/a.md", "x y")).toBe("bloommd://open?path=%2Fa.md");
    expect(desktopOpenUrl("/a.md", null)).toBe("bloommd://open?path=%2Fa.md");
    expect(desktopNodeId("heading-3")).toBeNull();
    expect(desktopNodeId("k3Xa9_z")).toBe("k3Xa9_z");
  });
});
