import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Mirrors the release budget enforced by scripts/release.mjs. */
const MAIN_JS_BUDGET = 600 * 1024;

const pluginRoot = join(import.meta.dir, "..");

interface Metafile {
  outputs: Record<string, { bytes: number; entryPoint?: string; inputs: Record<string, { bytesInOutput: number }> }>;
}

/** Runs the exact `build` script into a temporary directory, with a metafile for the breakdown. */
async function buildRelease(): Promise<{ mainBytes: number; inputs: Record<string, number> }> {
  const packageJson = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8")) as { scripts: { build: string } };
  const outdir = await mkdtemp(join(tmpdir(), "bloommd-bundle-size-"));
  try {
    const args = packageJson.scripts.build.split(/\s+/).slice(1).map((arg) => (arg === "--outdir=." ? `--outdir=${outdir}` : arg));
    expect(args).toContain(`--outdir=${outdir}`);
    const metafile = join(outdir, "meta.json");
    const esbuild = Bun.resolveSync("esbuild/bin/esbuild", pluginRoot);
    const result = Bun.spawnSync([esbuild, ...args, `--metafile=${metafile}`, "--log-level=error"], { cwd: pluginRoot, stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`build failed: ${new TextDecoder().decode(result.stderr)}`);
    const meta = JSON.parse(await readFile(metafile, "utf8")) as Metafile;
    const main = Object.values(meta.outputs).find((output) => output.entryPoint === "src/main.ts");
    if (!main) throw new Error("build emitted no main.js");
    const inputs: Record<string, number> = {};
    for (const [path, input] of Object.entries(main.inputs)) {
      const inPackage = path.split("node_modules/").pop()!;
      const key = path.includes("node_modules/") ? inPackage.split("/").slice(0, inPackage.startsWith("@") ? 2 : 1).join("/") : path;
      inputs[key] = (inputs[key] ?? 0) + input.bytesInOutput;
    }
    return { mainBytes: (await stat(join(outdir, "main.js"))).size, inputs };
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

describe("release bundle size", () => {
  test("main.js stays within the release budget and ships preact/compat instead of React", async () => {
    const { mainBytes, inputs } = await buildRelease();
    const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
    const largest = Object.entries(inputs).sort((left, right) => right[1] - left[1]).slice(0, 8);
    // Printed on every run so growth is visible in test logs before it hits the budget.
    console.log(
      `main.js ${mainBytes} bytes (${kib(mainBytes)} of ${kib(MAIN_JS_BUDGET)}, headroom ${kib(MAIN_JS_BUDGET - mainBytes)})\n` +
        largest.map(([name, bytes]) => `  ${kib(bytes).padStart(10)}  ${name}`).join("\n"),
    );
    expect(mainBytes).toBeLessThanOrEqual(MAIN_JS_BUDGET);
    // The React -> preact/compat alias saves ~180 KB; losing it would silently eat the headroom.
    expect(Object.keys(inputs)).not.toContain("react-dom");
    expect(Object.keys(inputs)).toContain("preact");
  }, 30_000);
});
