/**
 * Hands a note to BloomMD Desktop from Obsidian on the desktop.
 *
 * A running app takes the note over its local handoff socket (the same channel the `bloommd` CLI
 * uses), which carries the node to select and works on every platform. Only when no app is running
 * is it launched, with the target as an environment variable: Electrobun's launcher neither
 * forwards arguments nor delivers the URL of a link that started the app. macOS starts the app by
 * bundle id; Linux starts the installed package's launcher. Windows has no installed location to
 * rely on yet, so there the app must already be running.
 */

export const BLOOMMD_BUNDLE_ID = "app.bloommd";

/** Where the Linux package installs BloomMD Desktop (`packaging/arch/bloommd/PKGBUILD`). */
export const LINUX_DESKTOP_EXECUTABLES = ["/usr/bin/bloommd-desktop", "/opt/bloommd/app/bin/launcher"];

/** Pauses between handoff attempts after starting the app; about four seconds in total. */
export const HANDOFF_RETRY_DELAYS_MS = [250, 400, 600, 900, 1_200, 1_200];

const HANDOFF_SOCKET_NAME = "bloommd-desktop-handoff.sock";

interface NetModule {
  connect(path: string): {
    once(event: "error" | "connect", listener: () => void): void;
    end(data: string, callback: () => void): void;
    destroy(): void;
    setTimeout(ms: number, listener: () => void): void;
  };
}
interface ChildProcessModule {
  execFile(file: string, args: string[], callback: (error: Error | null) => void): void;
  spawn(file: string, args: string[], options: { detached: boolean; stdio: "ignore"; env: Record<string, string | undefined> }): {
    once(event: "error" | "spawn", listener: (error?: Error) => void): void;
    unref(): void;
  };
}
interface FsModule {
  accessSync(path: string, mode?: number): void;
  constants: { X_OK: number };
}
interface OsModule {
  tmpdir(): string;
  userInfo(): { uid: number; username: string };
}

export interface HandoffDeps {
  net: NetModule;
  childProcess: ChildProcessModule;
  fs: FsModule;
  platform: string;
  tmpdir: string;
  uid: number;
  username: string;
  env: Record<string, string | undefined>;
  sleep?: (ms: number) => Promise<void>;
}

/** Node modules through Electron's `require`; absent on Obsidian mobile. */
export function desktopDeps(): HandoffDeps | null {
  const load = (window as unknown as { require?: (id: string) => unknown }).require;
  if (typeof load !== "function") return null;
  try {
    const os = load("os") as OsModule;
    const proc = (window as unknown as { process?: { platform: string; env: Record<string, string | undefined> } }).process;
    let user = { uid: -1, username: proc?.env.USERNAME ?? proc?.env.USER ?? "" };
    try {
      user = os.userInfo();
    } catch {
      // No passwd entry (containers): the environment names the user.
    }
    return {
      net: load("net") as NetModule,
      childProcess: load("child_process") as ChildProcessModule,
      fs: load("fs") as FsModule,
      platform: proc?.platform ?? "",
      tmpdir: os.tmpdir(),
      uid: user.uid,
      username: user.username,
      env: proc?.env ?? {},
    };
  } catch {
    return null;
  }
}

function handoffUserKey(username: string): string {
  let hash = 0x811c9dc5;
  for (const char of username.toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Mirrors the per-user path BloomMD Desktop listens on (`packages/desktop/src/bun/handoff-path.ts`;
 * a contract test keeps both in step): macOS `$TMPDIR`, Linux `$XDG_RUNTIME_DIR` or a private
 * `bloommd-<uid>` directory, Windows a named pipe with a per-user key.
 */
export function desktopHandoffPath(deps: Pick<HandoffDeps, "platform" | "tmpdir" | "env" | "uid" | "username">): string {
  const override = deps.env.BLOOMMD_DESKTOP_HANDOFF_PATH?.trim();
  if (override) return override;
  const trimSlash = (path: string) => path.replace(/[\\/]+$/, "");
  if (deps.platform === "win32") return `\\\\.\\pipe\\bloommd-desktop-handoff-${handoffUserKey(deps.username)}`;
  if (deps.platform === "darwin") return `${trimSlash(deps.tmpdir)}/${HANDOFF_SOCKET_NAME}`;
  const runtime = deps.env.XDG_RUNTIME_DIR?.trim();
  if (runtime && runtime.startsWith("/")) return `${trimSlash(runtime)}/${HANDOFF_SOCKET_NAME}`;
  return `${trimSlash(deps.tmpdir)}/bloommd-${deps.uid}/${HANDOFF_SOCKET_NAME}`;
}

/** True when a running BloomMD Desktop accepted the note. */
export function forwardToRunningDesktop(deps: HandoffDeps, target: string, nodeId?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: ReturnType<NetModule["connect"]> | null = null;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(result);
    };
    try {
      socket = deps.net.connect(desktopHandoffPath(deps));
    } catch {
      finish(false);
      return;
    }
    socket.setTimeout(1_500, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => {
      const message = nodeId ? { type: "open", target, nodeId } : { type: "open", target };
      socket?.end(`${JSON.stringify(message)}\n`, () => finish(true));
    });
  });
}

/**
 * After starting the app, hands the note over once its socket is up. On a cold start the app also
 * has the note from its environment and opens it once; when the app was already running and only
 * the first handoff failed, this is the only way the note arrives.
 */
export async function forwardAfterLaunch(deps: HandoffDeps, target: string, nodeId?: string | null, delays = HANDOFF_RETRY_DELAYS_MS): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
  for (const delay of delays) {
    await sleep(delay);
    if (await forwardToRunningDesktop(deps, target, nodeId)) return true;
  }
  return false;
}

/** The installed BloomMD Desktop launcher on Linux, or null when none is found. */
export function linuxDesktopExecutable(deps: Pick<HandoffDeps, "fs">): string | null {
  for (const candidate of LINUX_DESKTOP_EXECUTABLES) {
    try {
      deps.fs.accessSync(candidate, deps.fs.constants.X_OK);
      return candidate;
    } catch {
      // Not installed here.
    }
  }
  return null;
}

/**
 * Starts BloomMD Desktop with the note. `missing` means no installed app was found (macOS knows no
 * app with BloomMD's bundle id; Linux has no package launcher); `unsupported` means this platform
 * has no reliable way to start it (Windows): the app must already be running.
 */
export function launchDesktop(deps: HandoffDeps, url: string): Promise<"launched" | "missing" | "unsupported"> {
  if (deps.platform === "darwin") {
    return new Promise((resolve) => {
      deps.childProcess.execFile("open", ["-b", BLOOMMD_BUNDLE_ID, "--env", `BLOOMMD_OPEN_TARGET=${url}`], (error) => {
        resolve(error ? "missing" : "launched");
      });
    });
  }
  if (deps.platform !== "linux") return Promise.resolve("unsupported");
  const executable = linuxDesktopExecutable(deps);
  if (!executable) return Promise.resolve("missing");
  return new Promise((resolve) => {
    try {
      const child = deps.childProcess.spawn(executable, [], { detached: true, stdio: "ignore", env: { ...deps.env, BLOOMMD_OPEN_TARGET: url } });
      child.once("error", () => resolve("missing"));
      child.once("spawn", () => {
        child.unref();
        resolve("launched");
      });
    } catch {
      resolve("missing");
    }
  });
}

export type DesktopOpenResult =
  /** A running app took the note. */
  | "opened"
  /** The app was started and confirmed the note over its socket. */
  | "launched"
  /** The app was started but never confirmed the note. */
  | "unconfirmed"
  /** macOS knows no BloomMD app. */
  | "not-installed"
  /** Linux: no installed BloomMD launcher was found, and no app is running. */
  | "not-found"
  /** Windows (or no Node access): BloomMD cannot be started from Obsidian; start it first. */
  | "start-first";

/**
 * "Open app" on the desktop: hand the note to a running BloomMD, otherwise start BloomMD with it and
 * confirm the handoff. Every result says honestly what happened, so the notice never claims a note
 * was opened when it was not.
 */
export async function openNoteInDesktop(
  deps: HandoffDeps | null,
  absolutePath: string,
  nodeId: string | null,
  url: string,
  onLaunched?: () => void,
): Promise<DesktopOpenResult> {
  if (!deps) return "start-first";
  if (await forwardToRunningDesktop(deps, absolutePath, nodeId)) return "opened";
  const launched = await launchDesktop(deps, url);
  if (launched === "unsupported") return "start-first";
  if (launched === "missing") return deps.platform === "darwin" ? "not-installed" : "not-found";
  onLaunched?.();
  return await forwardAfterLaunch(deps, absolutePath, nodeId) ? "launched" : "unconfirmed";
}
