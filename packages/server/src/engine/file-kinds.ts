// ---------------------------------------------------------------------------
// PatchPilot — file-kind classification (shared by engine modules)
// ---------------------------------------------------------------------------

import { extname } from "node:path";

/** File extensions eligible for AST analysis. */
export const JS_TS_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx",
  ".mjs", ".cjs", ".mts", ".cts",
]);

/** True when the path has a JavaScript/TypeScript source extension. */
export function isJsTsFile(path: string): boolean {
  return JS_TS_EXTS.has(extname(path).toLowerCase());
}