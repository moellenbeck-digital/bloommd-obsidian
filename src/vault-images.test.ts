import { describe, expect, test } from "bun:test";
import { findVaultImage, syntaxOf, unresolvedImages, type VaultImageHost } from "./vault-images";

/** A vault with these files; Obsidian's own lookup finds a file by its name anywhere in it. */
function vault(files: string[]): VaultImageHost {
  return {
    hasFile: (path) => files.includes(path),
    resolveLink: (link) => files.find((file) => file === link || file.endsWith(`/${link}`)) ?? null,
  };
}

describe("findVaultImage", () => {
  const host = vault(["Reisen/Bilder/Strand am Meer.png", "Reisen/Übersicht Süd.jpg", "Anhänge/logo.svg"]);

  test("resolves relative to the note like web and desktop, spaces and umlauts included", () => {
    expect(findVaultImage(host, "Reisen/Urlaub.md", "Bilder/Strand%20am%20Meer.png", "markdown")).toEqual({ found: true, path: "Reisen/Bilder/Strand am Meer.png" });
    expect(findVaultImage(host, "Reisen/Urlaub.md", "<./Übersicht Süd.jpg>", "markdown")).toEqual({ found: true, path: "Reisen/Übersicht Süd.jpg" });
    expect(findVaultImage(host, "Reisen/Deep/x.md", "../Übersicht Süd.jpg", "markdown")).toEqual({ found: true, path: "Reisen/Übersicht Süd.jpg" });
  });

  test("an embed is also found by name from anywhere in the vault, as Obsidian does", () => {
    expect(findVaultImage(host, "Reisen/Urlaub.md", "logo.svg", "wiki")).toEqual({ found: true, path: "Anhänge/logo.svg" });
  });

  test("names the path that is missing", () => {
    expect(findVaultImage(host, "Reisen/Urlaub.md", "fehlt.png", "markdown")).toEqual({ found: false, path: "Reisen/fehlt.png", problem: "not found in the vault" });
  });

  test("a path out of the vault is refused, not looked up", () => {
    const looked: string[] = [];
    const spying: VaultImageHost = { hasFile: (path) => { looked.push(path); return false; }, resolveLink: (link) => { looked.push(link); return null; } };
    expect(findVaultImage(spying, "a.md", "../../etc/passwd.png", "markdown")).toEqual({ found: false, path: "../../etc/passwd.png", problem: "path leaves the workspace" });
    expect(looked).toEqual([]);
  });

  test("remote images need no vault file", () => {
    expect(findVaultImage(host, "a.md", "https://example.com/a.png", "markdown")).toEqual({ found: true, path: "https://example.com/a.png" });
  });
});

describe("unresolvedImages", () => {
  const host = vault(["Reisen/Bilder/a.png"]);
  const embeds = [
    { link: "Bilder/a.png", original: "![](Bilder/a.png)" },
    { link: "fehlt.png", original: "![[fehlt.png|200]]" },
    { link: "fehlt.png", original: "![[fehlt.png]]" },
    { link: "Andere Notiz", original: "![[Andere Notiz]]" },
    { link: "woanders.png", original: "![x](woanders.png)" },
  ];

  test("lists the images of this node that cannot be found, once each", () => {
    const markdown = "Text ![](Bilder/a.png) und ![[fehlt.png|200]] und ![[fehlt.png]]";
    expect(unresolvedImages(host, "Reisen/Urlaub.md", markdown, embeds)).toEqual([{ path: "Reisen/fehlt.png", problem: "not found in the vault" }]);
  });

  test("ignores embeds that belong to other nodes of the note", () => {
    expect(unresolvedImages(host, "Reisen/Urlaub.md", "Nur Text", embeds)).toEqual([]);
  });

  test("tells the two syntaxes apart", () => {
    expect(syntaxOf("![[a.png]]")).toBe("wiki");
    expect(syntaxOf("![a](a.png)")).toBe("markdown");
  });
});
