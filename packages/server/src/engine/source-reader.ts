// ---------------------------------------------------------------------------
// PatchPilot — source reader
//
// Reads changed-file content at the correct base/head Git revisions so the
// analysis reflects the selected comparison, never the working tree.
// Uses the safe spawn-based git service; never executes repository code.
// ---------------------------------------------------------------------------

import type { GitDiffFile } from "../services/git.service.js";
import { readFileAtRef } from "../services/git.service.js";
import { isJsTsFile } from "./file-kinds.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Source content for one changed file at both ends of the comparison.
 * `null` means the file does not exist at that ref (added/deleted side).
 */
export interface FileSource {
  path: string;
  /** Content at baseRef (null if absent, e.g. added files). */
  base: string | null;
  /** Content at headRef (null if absent, e.g. deleted files). */
  head: string | null;
  /** Binary content detected (NUL byte). */
  binary?: boolean;
  /** Content exceeds the per-file size cap for AST analysis. */
  tooLarge?: boolean;
  /** Git read failure for this file (analysis continues for others). */
  readError?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters of source we will parse per file. */
const MAX_SOURCE_CHARS = 1_000_000;

/** Maximum concurrent `git show` subprocesses. */
const CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Fetch base/head source content for all JS/TS files in the diff.
 * Failures are isolated per file (readError) and never abort the batch.
 */
export async function fetchSources(
  repoPath: string,
  baseRef: string,
  headRef: string,
  files: GitDiffFile[],
): Promise<Map<string, FileSource>> {
  const targets = files.filter(
    (f) => isJsTsFile(f.path) || (f.oldPath ? isJsTsFile(f.oldPath) : false),
  );

  const map = new Map<string, FileSource>();
  let index = 0;

  async function worker(): Promise<void> {
    while (index < targets.length) {
      const file = targets[index++];
      map.set(file.path, await loadSource(repoPath, baseRef, headRef, file));
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, targets.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return map;
}

// ---------------------------------------------------------------------------
// Per-file loading
// ---------------------------------------------------------------------------

async function loadSource(
  repoPath: string,
  baseRef: string,
  headRef: string,
  file: GitDiffFile,
): Promise<FileSource> {
  const out: FileSource = { path: file.path, base: null, head: null };

  // Base side: read the old path for renames, the current path otherwise.
  // Added files never exist at base.
  if (file.status !== "added") {
    const basePath = file.status === "renamed" && file.oldPath ? file.oldPath : file.path;
    const result = await safeRead(repoPath, baseRef, basePath);
    out.base = result.value;
    if (result.error) out.readError = result.error;
  }

  // Head side: read the current path. Deleted files never exist at head.
  if (file.status !== "deleted") {
    const result = await safeRead(repoPath, headRef, file.path);
    out.head = result.value;
    if (result.error) out.readError = out.readError
      ? `${out.readError}; ${result.error}`
      : result.error;
  }

  if (out.readError) return out;

  // Binary detection: a NUL byte means this is not parseable source text.
  if ((out.base !== null && out.base.includes("\0")) ||
      (out.head !== null && out.head.includes("\0"))) {
    out.binary = true;
    return out;
  }

  // Per-file size cap keeps AST analysis bounded.
  if ((out.base?.length ?? 0) > MAX_SOURCE_CHARS ||
      (out.head?.length ?? 0) > MAX_SOURCE_CHARS) {
    out.tooLarge = true;
  }

  return out;
}

interface ReadResult {
  value: string | null;
  error?: string;
}

async function safeRead(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<ReadResult> {
  try {
    return { value: await readFileAtRef(repoPath, ref, filePath) };
  } catch (err) {
    return {
      value: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}