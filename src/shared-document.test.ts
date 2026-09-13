import { describe, expect, test } from "bun:test";
import { WorkspaceSyncClient, parseFile, serializeToMarkdown } from "./shared-dependencies";
import { ObsidianSharedDocumentSession, type SharedSyncProvider } from "./shared-document";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

describe("ObsidianSharedDocumentSession", () => {
  test("keeps a shared Markdown tree readable after the standalone runtime serializes it", () => {
    const source = [
      "---",
      "title: Research",
      "id: research-1",
      "created: 2026-09-13T00:00:00.000Z",
      "updated: 2026-09-13T00:00:00.000Z",
      "---",
      "",
      "# Research <!-- bloommd:id=root -->",
      "",
      "Intro",
      "",
      "## Sources <!-- bloommd:id=sources -->",
      "",
      "- Paper A",
      "",
    ].join("\n");

    const first = parseFile("Research.md", source);
    const second = parseFile("Research.md", serializeToMarkdown(first));

    expect(second.frontmatter.id).toBe("research-1");
    expect(second.nodes.get("root")?.children).toEqual(["sources"]);
    expect(second.nodes.get("sources")?.content).toBe("- Paper A");
  });

  test("shares a vault file without sending its vault path and keeps the binding local", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const vault = {
      readMarkdown: async () => "# Research\n",
      writeMarkdown: async () => undefined,
    };
    const persisted: unknown[] = [];
    const provider: SharedSyncProvider = {
      getStatus: () => "disconnected",
      setConnectionUrl: () => undefined,
      connect: () => undefined,
      disconnect: () => undefined,
    };
    const createClient = () => new WorkspaceSyncClient({
      baseUrl: "https://bloommd.app",
      accessToken: "bloom_pat_test",
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.includes("/api/workspaces")) return json({ workspace: { id: "workspace-1", name: "Team", slug: "team", kind: "team", role: "editor" }, workspaces: [] });
        if (url.endsWith("/api/mindmaps")) return json({ filePath: "Research.md" });
        if (url.includes("/api/sync-ticket")) return json({ websocketUrl: "wss://sync.example/ws/research", expiresAt: "2026-09-13T10:00:00.000Z", permission: "write" });
        return json({ frontmatter: { id: "document-1" }, storage: { version: 4 } });
      },
    });

    const session = await ObsidianSharedDocumentSession.share({
      file: { path: "Private/Clients/Research.md", basename: "Research" },
      vault,
      serverUrl: "https://bloommd.app",
      accessToken: "bloom_pat_test",
      workspaceId: "workspace-1",
      createClient,
      createProvider: () => provider,
      onBindingChange: async (binding) => { persisted.push(binding); },
    });

    expect(session.getBinding()).toMatchObject({ workspaceId: "workspace-1", cloudFilename: "Research.md", documentId: "document-1" });
    expect(calls[1]?.body).toEqual({ filename: "Research.md", markdown: "# Research\n" });
    expect(calls.find((call) => call.url.endsWith("/api/shared-documents/audit"))?.body).toEqual({
      action: "bound",
      documentId: "document-1",
      workspaceId: "workspace-1",
    });
    expect(JSON.stringify(calls)).not.toContain("Private/Clients");
    expect(persisted).toHaveLength(1);
    session.disconnect();
  });
});
