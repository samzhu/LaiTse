import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const scratchRoot = resolve(root, ".scratch/t01");
const outputPath = resolve(root, process.env.DEPENDENCY_INVENTORY_PATH ?? ".scratch/t01/dependency-inventory.json");
const outputRelative = relative(scratchRoot, outputPath);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("DEPENDENCY_INVENTORY_PATH must stay inside .scratch/t01.");
}

const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const direct = new Map();
for (const dependency of Object.keys(packageManifest.dependencies ?? {})) direct.set(dependency, "runtime");
for (const dependency of Object.keys(packageManifest.devDependencies ?? {})) direct.set(dependency, "development");

const entries = [];
for (const [packagePath, lockEntry] of Object.entries(lock.packages)) {
  if (!packagePath || !lockEntry.version || !packagePath.startsWith("node_modules/")) continue;
  const installPath = resolve(root, packagePath);
  const manifestPath = resolve(installPath, "package.json");
  if (!existsSync(manifestPath)) continue;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const license = typeof manifest.license === "string"
    ? manifest.license
    : Array.isArray(manifest.licenses)
      ? manifest.licenses.map((item) => item.type ?? "unknown").join(" OR ")
      : "unknown";
  const licenseFiles = readdirSync(installPath).filter((name) => /^licen[cs]e(?:\.|$)/i.test(name)).sort();
  entries.push({
    name: manifest.name ?? lockEntry.name ?? packagePath.slice("node_modules/".length),
    version: lockEntry.version,
    license,
    licenseFiles,
    dependencyClass: direct.get(manifest.name) ?? "transitive",
    packagePath: packagePath.replaceAll("\\", "/"),
    resolved: lockEntry.resolved ?? null,
    integrity: lockEntry.integrity ?? null,
  });
}
entries.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version) || left.packagePath.localeCompare(right.packagePath));

let npmVersion = "unavailable";
try {
  npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
} catch {
  // Keep the inventory useful when npm is not on PATH; the Node and lock versions remain available.
}

const report = {
  generatedAt: new Date().toISOString(),
  project: packageManifest.name,
  projectVersion: packageManifest.version,
  projectLicense: packageManifest.license,
  lockfileVersion: lock.lockfileVersion,
  runtime: {
    node: process.version,
    npm: npmVersion,
    platform: process.platform,
    architecture: process.arch,
  },
  installedPackageCount: entries.length,
  packagesWithUnknownDeclaredLicense: entries.filter((entry) => entry.license === "unknown").map((entry) => `${entry.name}@${entry.version}`),
  packages: entries,
};

await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(outputPath), { recursive: true }));
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${entries.length} installed package records to ${outputPath}`);
