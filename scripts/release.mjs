import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const versions = JSON.parse(await readFile(join(root, "versions.json"), "utf8"));
const errors = [];

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "release"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function releaseSnapshotSha256() {
  const hash = createHash("sha256");
  const excluded = new Set(["MIRROR.json", "main.js", "shared-runtime.js", "styles.css", "bun.lock"]);
  const entries = [];
  for (const path of await walk(root)) {
    const relativePath = relative(root, path);
    if (excluded.has(relativePath) || relativePath.endsWith("/.DS_Store") || relativePath === ".DS_Store") continue;
    entries.push({ path: relativePath, bytes: await readFile(path) });
  }
  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push("manifest version must be numeric semver without a v prefix");
if (packageJson.version !== manifest.version) errors.push("package.json and manifest.json versions differ");
if (versions[manifest.version] !== manifest.minAppVersion) errors.push("versions.json does not map the release to minAppVersion");
if (manifest.id !== "bloommd") errors.push("manifest id must remain bloommd");
if (manifest.isDesktopOnly !== true) errors.push("mobile support must not be advertised before the mobile test matrix passes");

for (const file of ["main.js", "shared-runtime.js", "manifest.json", "styles.css", "icon.png", "README.md", "LICENSE", "PRIVACY.md", "CHANGELOG.md"]) {
  try {
    const info = await stat(join(root, file));
    if (!info.isFile() || info.size === 0) errors.push(`${file} is empty`);
  } catch {
    errors.push(`${file} is missing`);
  }
}

try {
  const bundle = await stat(join(root, "main.js"));
  if (bundle.size > 600 * 1024) errors.push(`main.js is ${bundle.size} bytes and exceeds the 600 KiB release budget`);
} catch {
  // The required-file check above reports the missing bundle.
}

const dependencies = Object.keys(packageJson.dependencies ?? {});
for (const prohibited of ["posthog-js", "@sentry/browser", "mixpanel-browser", "segment-analytics"]) {
  if (dependencies.includes(prohibited)) errors.push(`telemetry dependency ${prohibited} is not allowed`);
}

const sourceReviewChecks = [
  {
    file: "src/main.ts",
    checks: [
      [/\brequire\s*\(/, "src/main.ts must use imports instead of require()"],
      [/\bdocument\.createElement\s*\(/, "src/main.ts must use Obsidian createEl helpers"],
      [/this\.addCommand\(\{[^\n]*name:\s*["'][^"']*BloomMD/i, "command names must not repeat the plugin name"],
    ],
  },
  {
    file: "src/markdown-document.ts",
    checks: [
      [/atx\[2\]!\./, "the generated heading parser contains an unnecessary assertion"],
      [/underline\[1\]!\./, "the generated Setext parser contains an unnecessary assertion"],
    ],
  },
  {
    file: "src/shared-document.ts",
    checks: [
      [/^\s+onBindingChange\([^)]*\):/m, "onBindingChange must be a function property"],
      [/^\s+onStatusChange\?\([^)]*\):/m, "onStatusChange must be a function property"],
      [/^\s+createClient\?\([^)]*\):/m, "createClient must be a function property"],
      [/^\s+createProvider\?\([^)]*\):/m, "createProvider must be a function property"],
    ],
  },
];

for (const { file, checks } of sourceReviewChecks) {
  const source = await readFile(join(root, file), "utf8");
  for (const [pattern, message] of checks) {
    if (pattern.test(source)) errors.push(message);
  }
}

// The public repository is a generated release mirror. The canonical monorepo plugin does not
// carry MIRROR.json, so this contract is optional locally and mandatory whenever a public mirror
// is being verified. The generated Core snapshots are hashed to make accidental source edits
// visible before a tag is published.
try {
  const mirror = JSON.parse(await readFile(join(root, "MIRROR.json"), "utf8"));
  if (mirror.mode !== "release-mirror") errors.push("MIRROR.json must describe a release-mirror");
  if (mirror.pluginVersion !== manifest.version) errors.push("MIRROR.json and manifest.json versions differ");
  if (!/^[a-f0-9]{64}$/.test(mirror.releaseSnapshotSha256 ?? "")) {
    errors.push("MIRROR.json is missing a valid release snapshot hash");
  } else if (await releaseSnapshotSha256() !== mirror.releaseSnapshotSha256) {
    errors.push("MIRROR.json does not attest to the exact public release snapshot");
  }
  if (mirror.sourceDirty === true) {
    const message = "MIRROR.json was generated from a dirty monorepo checkout";
    if (process.env.BLOOMMD_REQUIRE_CLEAN_MIRROR === "1" || process.env.CI === "true") errors.push(message);
    else console.warn(`warning: ${message}`);
  }

  for (const entry of [mirror.core, mirror.coreTypes]) {
    if (!entry?.generatedPath || !entry.generatedSha256 || !entry.sourceSha256) {
      errors.push("MIRROR.json is missing generated Core hash metadata");
      continue;
    }
    const generatedPath = join(root, entry.generatedPath);
    try {
      if (await sha256(generatedPath) !== entry.generatedSha256) {
        errors.push(`${entry.generatedPath} differs from the Core snapshot recorded in MIRROR.json`);
      }
      const generated = await readFile(generatedPath, "utf8");
      if (!generated.includes(entry.sourceSha256)) {
        errors.push(`${entry.generatedPath} does not contain the recorded Core source hash`);
      }
    } catch {
      errors.push(`${entry.generatedPath} is missing`);
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") errors.push("MIRROR.json is not valid JSON");
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

if (process.argv.includes("--package")) {
  const output = join(root, "release", manifest.version);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const packageFiles = ["main.js", "shared-runtime.js", "manifest.json", "styles.css", "icon.png", "README.md", "LICENSE", "PRIVACY.md", "CHANGELOG.md"];
  try {
    await stat(join(root, "MIRROR.json"));
    packageFiles.push("MIRROR.json");
  } catch {
    // The canonical monorepo source does not need a generated mirror manifest.
  }
  for (const file of packageFiles) {
    await cp(join(root, file), join(output, file));
  }
  console.log(`Prepared BloomMD ${manifest.version} in ${output}`);
} else {
  console.log(`BloomMD ${manifest.version} release contract verified.`);
}
