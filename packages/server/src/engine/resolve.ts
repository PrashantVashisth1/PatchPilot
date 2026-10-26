// ---------------------------------------------------------------------------
// PatchPilot — conservative relative-import resolution
//
// Resolves only relative specifiers (./ and ../) against the set of paths
// present in the repository tree at a given ref. Unresolved imports are
// represented explicitly as null — no guessing, no node_modules resolution.
// ---------------------------------------------------------------------------

import { posix } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Extension candidates tried in order for the specifier itself. */
const DIRECT_EXTS = [
  "",       // specifier already includes its extension
  ".ts", ".tsx", ".d.ts",
  ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
];

/** Extension candidates for `<specifier>/index.*`. */
const INDEX_EXTS = [
  ".ts", ".tsx", ".d.ts",
  ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
];

/**
 * TS-style specifier rewriting: `./foo.js` in TypeScript commonly resolves
 * to `foo.ts` / `foo.tsx` (ESM-style imports written with .js extensions).
 */
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** True for relative module specifiers (`./x`, `../y`). */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * Resolve a relative import specifier against the paths present in the repo.
 *
 * @param fromPath  repo-relative posix path of the importing file
 * @param specifier relative module specifier
 * @param treePaths paths that exist at the relevant ref
 * @returns resolved repo-relative posix path, or null when unresolved
 */
export function resolveImport(
  fromPath: string,
  specifier: string,
  treePaths: Set<string>,
): string | null {
  if (!isRelativeSpecifier(specifier)) return null;
  if (treePaths.size === 0) return null;

  const joined = posix.join(posix.dirname(fromPath), specifier);

  // 1. Direct candidates: exact path, then common extensions.
  for (const ext of DIRECT_EXTS) {
    const candidate = joined + ext;
    if (treePaths.has(candidate)) return candidate;
  }

  // 2. TS-style rewrite: ./foo.js -> foo.ts / foo.tsx
  const specExt = posix.extname(specifier);
  const swapped = JS_TO_TS[specExt];
  if (swapped) {
    const stem = joined.slice(0, joined.length - specExt.length);
    for (const ext of swapped) {
      if (treePaths.has(stem + ext)) return stem + ext;
    }
  }

  // 3. Index files: ./utils -> utils/index.ts
  for (const ext of INDEX_EXTS) {
    const candidate = posix.join(joined, `index${ext}`);
    if (treePaths.has(candidate)) return candidate;
  }

  return null;
}