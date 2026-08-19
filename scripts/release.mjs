import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const versions = JSON.parse(await readFile(join(root, "versions.json"), "utf8"));
const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push("manifest version must be numeric semver without a v prefix");
if (packageJson.version !== manifest.version) errors.push("package.json and manifest.json versions differ");
if (versions[manifest.version] !== manifest.minAppVersion) errors.push("versions.json does not map the release to minAppVersion");
if (manifest.id !== "bloommd") errors.push("manifest id must remain bloommd");
if (manifest.isDesktopOnly !== true) errors.push("mobile support must not be advertised before the mobile test matrix passes");

for (const file of ["main.js", "manifest.json", "styles.css", "icon.png", "README.md", "LICENSE", "PRIVACY.md", "CHANGELOG.md"]) {
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

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

if (process.argv.includes("--package")) {
  const output = join(root, "release", manifest.version);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css", "icon.png", "README.md", "LICENSE", "PRIVACY.md", "CHANGELOG.md"]) {
    await cp(join(root, file), join(output, file));
  }
  console.log(`Prepared BloomMD ${manifest.version} in ${output}`);
} else {
  console.log(`BloomMD ${manifest.version} release contract verified.`);
}
