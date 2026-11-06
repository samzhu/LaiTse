import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const repositoryRoot = resolve(pocRoot, "..");

export function enterRepositoryRootForLegacyScript() {
  process.chdir(repositoryRoot);
}
