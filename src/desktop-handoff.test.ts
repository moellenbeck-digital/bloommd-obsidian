import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopHandoffPath, forwardAfterLaunch, forwardToRunningDesktop, launchDesktop, openNoteInDesktop, type HandoffDeps } from "./desktop-handoff";

type SpawnCall = { file: string; args: string[]; env: Record<string, string | undefined>; detached: boolean };

const spawner = (calls: SpawnCall[], fail = false): HandoffDeps["childProcess"]["spawn"] => (file, args, options) => {
  calls.push({ file, args, env: options.env, detached: options.detached });
  return {
    once: (event, listener) => {
      if ((event === "error") === fail) queueMicrotask(() => listener(fail ? new Error("ENOENT") : undefined));
    },
    unref: () => undefined,
  };
};

const fsWith = (executables: string[]): HandoffDeps["fs"] => ({
  constants: { X_OK: 1 },
  accessSync: (path) => {
    if (!executables.includes(path)) throw new Error("ENOENT");
  },
});

const deps = (overrides: Partial<HandoffDeps> = {}): HandoffDeps => ({
  net: net as unknown as HandoffDeps["net"],
  childProcess: { execFile: (_file, _args, callback) => callback(null), spawn: spawner([]) },
  fs: fsWith([]),
  platform: "darwin",
  tmpdir: "/tmp/",
  uid: 1000,
  username: "max",
  env: {},
  sleep: async () => undefined,
  ...overrides,
});

const noSocket = { BLOOMMD_DESKTOP_HANDOFF_PATH: join(tmpdir(), "no-such-bloommd.sock") };

describe("desktopHandoffPath", () => {
  test("is per user on each platform", () => {
    expect(desktopHandoffPath({ platform: "darwin", tmpdir: "/var/folders/x/T/", env: {}, uid: 501, username: "max" })).toBe("/var/folders/x/T/bloommd-desktop-handoff.sock");
    expect(desktopHandoffPath({ platform: "linux", tmpdir: "/tmp", env: { XDG_RUNTIME_DIR: "/run/user/1000" }, uid: 1000, username: "max" })).toBe("/run/user/1000/bloommd-desktop-handoff.sock");
    // Without a runtime dir: a private directory with the uid in its name, never the shared /tmp.
    expect(desktopHandoffPath({ platform: "linux", tmpdir: "/tmp", env: {}, uid: 1000, username: "max" })).toBe("/tmp/bloommd-1000/bloommd-desktop-handoff.sock");
    expect(desktopHandoffPath({ platform: "linux", tmpdir: "/tmp", env: { BLOOMMD_DESKTOP_HANDOFF_PATH: "/run/x.sock" }, uid: 1000, username: "max" })).toBe("/run/x.sock");
    const pipe = desktopHandoffPath({ platform: "win32", tmpdir: "C:\\Temp", env: {}, uid: -1, username: "Max" });
    expect(pipe).toMatch(/^\\\\\.\\pipe\\bloommd-desktop-handoff-[0-9a-f]{8}$/);
    expect(desktopHandoffPath({ platform: "win32", tmpdir: "C:\\Temp", env: {}, uid: -1, username: "anna" })).not.toBe(pipe);
  });

});

describe("forwardToRunningDesktop", () => {
  test("sends the note and node to a running app", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "bloommd-plugin-handoff-")), "desktop.sock");
    const received: string[] = [];
    const server = net.createServer((socket) => socket.on("data", (chunk) => received.push(String(chunk))));
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      expect(await forwardToRunningDesktop(deps({ env: { BLOOMMD_DESKTOP_HANDOFF_PATH: path } }), "/v/Note.md", "abc123")).toBe(true);
      await Bun.sleep(20);
      expect(JSON.parse(received.join("").trim())).toEqual({ type: "open", target: "/v/Note.md", nodeId: "abc123" });
    } finally {
      server.close();
    }
  });

  test("reports false when no app is running", async () => {
    expect(await forwardToRunningDesktop(deps({ env: noSocket }), "/v/Note.md")).toBe(false);
  });
});

describe("launchDesktop", () => {
  test("starts the app by bundle id with the note as environment", async () => {
    const calls: Array<[string, string[]]> = [];
    const result = await launchDesktop(deps({ childProcess: { execFile: (file, args, callback) => { calls.push([file, args]); callback(null); }, spawn: spawner([]) } }), "bloommd://open?path=%2Fa.md&node=x");
    expect(result).toBe("launched");
    expect(calls).toEqual([["open", ["-b", "app.bloommd", "--env", "BLOOMMD_OPEN_TARGET=bloommd://open?path=%2Fa.md&node=x"]]]);
  });

  test("knows when the app is not installed", async () => {
    expect(await launchDesktop(deps({ childProcess: { execFile: (_f, _a, callback) => callback(new Error("Unable to find application")), spawn: spawner([]) } }), "bloommd://x")).toBe("missing");
  });

  test("starts the installed Linux package detached, with the note as environment", async () => {
    const calls: SpawnCall[] = [];
    const linux = deps({ platform: "linux", env: { HOME: "/home/max" }, fs: fsWith(["/usr/bin/bloommd-desktop"]), childProcess: { execFile: () => undefined, spawn: spawner(calls) } });
    expect(await launchDesktop(linux, "bloommd://open?path=%2Fa.md")).toBe("launched");
    expect(calls).toEqual([{ file: "/usr/bin/bloommd-desktop", args: [], env: { HOME: "/home/max", BLOOMMD_OPEN_TARGET: "bloommd://open?path=%2Fa.md" }, detached: true }]);
  });

  test("Linux without the package, or a failing spawn, is missing", async () => {
    expect(await launchDesktop(deps({ platform: "linux" }), "bloommd://x")).toBe("missing");
    const failing = deps({ platform: "linux", fs: fsWith(["/opt/bloommd/app/bin/launcher"]), childProcess: { execFile: () => undefined, spawn: spawner([], true) } });
    expect(await launchDesktop(failing, "bloommd://x")).toBe("missing");
  });

  test("Windows has no launch path", async () => {
    expect(await launchDesktop(deps({ platform: "win32" }), "bloommd://x")).toBe("unsupported");
  });
});

describe("openNoteInDesktop", () => {
  test("Windows without a running app asks to start BloomMD first instead of claiming it is missing", async () => {
    const calls: SpawnCall[] = [];
    const windows = deps({ platform: "win32", env: noSocket, childProcess: { execFile: () => { throw new Error("must not run"); }, spawn: spawner(calls) } });
    expect(await openNoteInDesktop(windows, "C:\\v\\Note.md", null, "bloommd://x")).toBe("start-first");
    expect(calls).toEqual([]);
  });

  test("Linux without a running app or package says it was not found", async () => {
    expect(await openNoteInDesktop(deps({ platform: "linux", env: noSocket }), "/v/Note.md", null, "bloommd://x")).toBe("not-found");
  });

  test("macOS without the app says it is not installed", async () => {
    const mac = deps({ env: noSocket, childProcess: { execFile: (_f, _a, callback) => callback(new Error("Unable to find application")), spawn: spawner([]) } });
    expect(await openNoteInDesktop(mac, "/v/Note.md", null, "bloommd://x")).toBe("not-installed");
  });

  test("without Node access (no desktop deps) only a running app could help", async () => {
    expect(await openNoteInDesktop(null, "/v/Note.md", null, "bloommd://x")).toBe("start-first");
  });

  test("a started app that never answers is reported honestly", async () => {
    let launched = 0;
    const result = await openNoteInDesktop(deps({ env: noSocket }), "/v/Note.md", null, "bloommd://x", () => { launched += 1; });
    expect(result).toBe("unconfirmed");
    expect(launched).toBe(1);
  });

  test("a note reaches an app whose socket comes up after the launch", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "bloommd-plugin-handoff-")), "desktop.sock");
    const received: string[] = [];
    const server = net.createServer((socket) => socket.on("data", (chunk) => received.push(String(chunk))));
    let attempts = 0;
    // The app starts listening only after the launch and a couple of retries.
    const sleep = async () => {
      attempts += 1;
      if (attempts === 3) await new Promise<void>((resolve) => server.listen(path, resolve));
    };
    try {
      const result = await openNoteInDesktop(deps({ env: { BLOOMMD_DESKTOP_HANDOFF_PATH: path }, sleep }), "/v/Note.md", "abc123", "bloommd://x");
      expect(result).toBe("launched");
      expect(attempts).toBe(3);
      await Bun.sleep(20);
      expect(JSON.parse(received.join("").trim())).toEqual({ type: "open", target: "/v/Note.md", nodeId: "abc123" });
    } finally {
      server.close();
    }
  });
});

describe("forwardAfterLaunch", () => {
  test("waits with growing pauses and gives up after a few seconds", async () => {
    const waited: number[] = [];
    const result = await forwardAfterLaunch(deps({ env: noSocket, sleep: async (ms) => { waited.push(ms); } }), "/v/Note.md");
    expect(result).toBe(false);
    expect(waited.length).toBeGreaterThan(3);
    expect(waited.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(3_000);
    expect(waited.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(6_000);
  });
});
