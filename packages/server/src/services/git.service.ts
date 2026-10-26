// ---------------------------------------------------------------------------
// PatchPilot — Git service
//
// All Git operations use child_process.spawn with argument arrays.
// No shell interpolation, no remote cloning, no script execution.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { resolve, isAbsolute, normalize } from "node:path";
import { statSync, existsSync } from "node:fs";
import { unprocessable, badRequest, AppError } from "../utils/errors.js";
import type { FileStatus } from "@patchpilot/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time a single git subprocess may run (milliseconds). */
const GIT_TIMEOUT_MS = 30_000;

/** Maximum bytes of stdout we accept from a single git call. */
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MiB

/** --name-status status codes we handle. */
const STATUS_MAP: Record<string, FileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  T: "modified",   // type-change → treat as modified
};

/** Rename status code (with `--find-renames`, the code includes a similarity score, e.g. "R100"). */
const RENAME_CODE_RE = /^R\d*$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GitDiffFile {
  path: string;
  status: FileStatus;
  oldPath?: string;
}

export interface GitDiffStats {
  files: GitDiffFile[];
  additions: number;
  deletions: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a two-ref Git diff on a local repository.
 *
 * @returns structured diff results
 * @throws AppError (400 / 422) on invalid input or runtime failure
 */
export async function runGitDiff(opts: {
  repoPath: string;
  baseRef: string;
  headRef: string;
}): Promise<GitDiffStats> {
  const repoPath = validateRepoPath(opts.repoPath);
  await ensureIsWorktree(repoPath);

  // 1. --name-status for the file list (single pass, rename-aware)
  const nameStatusRaw = await runGit(repoPath, [
    "diff",
    "--name-status",
    "--find-renames=50%",
    opts.baseRef,
    opts.headRef,
  ]);

  // 2. --shortstat for aggregate line counts
  let additions = 0;
  let deletions = 0;
  try {
    const shortstatRaw = await runGit(repoPath, [
      "diff",
      "--shortstat",
      opts.baseRef,
      opts.headRef,
    ]);
    const parsed = parseShortstat(shortstatRaw);
    additions = parsed.additions;
    deletions = parsed.deletions;
  } catch {
    // Best-effort; empty diffs or binary-only diffs may not produce shortstat.
  }

  // 4. Parse file list
  const files = [...parseNameStatus(nameStatusRaw).values()];

  // 5. Detect empty diff
  if (files.length === 0) {
    throw unprocessable(
      `No changes found between "${opts.baseRef}" and "${opts.headRef}".`,
      "EMPTY_DIFF",
    );
  }

  return { files, additions, deletions };
}

// ---------------------------------------------------------------------------
// Per-file line stats (optional, used by the engine for per-file context)
// ---------------------------------------------------------------------------

/**
 * Run `git diff --numstat` to get per-file line additions/deletions.
 * Returns a map of path → {additions, deletions}.
 * Non-fatal: returns empty map on failure.
 */
export async function runGitNumstat(
  repoPath: string,
  baseRef: string,
  headRef: string,
): Promise<Map<string, { additions: number; deletions: number }>> {
  const result = new Map<string, { additions: number; deletions: number }>();
  try {
    const raw = await runGit(repoPath, [
      "diff",
      "--numstat",
      baseRef,
      headRef,
    ]);
    for (const line of raw.split("\n")) {
      const parts = line.trim().split("\t");
      if (parts.length < 3) continue;
      const adds = parseInt(parts[0], 10);
      const dels = parseInt(parts[1], 10);
      const filePath = parts[2];
      if (!isNaN(adds) && !isNaN(dels)) {
        result.set(filePath, { additions: adds, deletions: dels });
      }
    }
  } catch {
    // Best-effort.
  }
  return result;
}

// ---------------------------------------------------------------------------
// Revision content access (Step 3: source analysis)
// ---------------------------------------------------------------------------

/**
 * Read a file's content at a specific Git ref via `git show <ref>:<path>`.
 *
 * @returns file content, or `null` when the path does not exist at the ref
 * @throws AppError on other Git failures
 */
export async function readFileAtRef(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  if (!isValidGitPath(filePath)) {
    throw unprocessable(
      `Invalid file path for Git read: ${JSON.stringify(filePath)}`,
      "BAD_GIT_PATH",
    );
  }
  try {
    const content = await runGit(repoPath, ["show", `${ref}:${filePath}`]);
    return stripBom(content);
  } catch (err) {
    if (isMissingPathError(err)) {
      return null;
    }
    throw err;
  }
}

/**
 * List all file paths present at a Git ref via `git ls-tree -r -z --name-only`.
 * Used as the resolution oracle for relative imports.
 */
export async function listTreePaths(
  repoPath: string,
  ref: string,
): Promise<Set<string>> {
  const raw = await runGit(repoPath, ["ls-tree", "-r", "-z", "--name-only", ref]);
  const paths = new Set<string>();
  for (const entry of raw.split("\0")) {
    const p = entry.trim();
    if (p) paths.add(p);
  }
  return paths;
}

/** A repo-relative, posix-style path that is safe to pass to `git show`. */
function isValidGitPath(p: string): boolean {
  if (!p || p.length > 4096) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  if (p.includes("\\") || p.includes("\0")) return false;
  const parts = p.split("/");
  return !parts.some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Distinguish "path not present at ref" (=> null) from real Git failures. */
function isMissingPathError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  const details = err.details as { stderr?: string } | undefined;
  const stderr = details?.stderr ?? "";
  return /does not exist/i.test(stderr) || /exists on disk, but not in/i.test(stderr);
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

function validateRepoPath(raw: string): string {
  if (!raw || raw.trim().length === 0) {
    throw badRequest("repoPath is required");
  }

  if (!isAbsolute(raw)) {
    throw badRequest(
      "repoPath must be an absolute path. Received: " + JSON.stringify(raw),
    );
  }

  // Normalize and resolve.
  const resolved = normalize(resolve(raw));

  // Reject paths that could be traversal beyond root.
  // resolve() already strips ".." segments, but check that we remain absolute.
  if (!isAbsolute(resolved)) {
    throw badRequest("repoPath resolved to a non-absolute path");
  }

  if (!existsSync(resolved)) {
    throw unprocessable(
      `Repository path does not exist: ${resolved}`,
      "REPO_NOT_FOUND",
    );
  }

  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw unprocessable(
      `Cannot stat repository path: ${resolved}`,
      "REPO_NOT_ACCESSIBLE",
    );
  }

  if (!stat.isDirectory()) {
    throw badRequest("repoPath must be a directory");
  }

  return resolved;
}

async function ensureIsWorktree(repoPath: string): Promise<void> {
  // Verify that repoPath is the root of its own Git work tree,
  // not merely a subdirectory of a parent work tree.
  let toplevel: string;
  try {
    toplevel = await runGit(repoPath, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw unprocessable(
      `Path is not a Git working tree: ${repoPath}`,
      "NOT_GIT_REPO",
    );
  }

  const normalized = normalize(toplevel);
  if (normalized !== normalize(repoPath)) {
    throw unprocessable(
      `Path is not a Git working tree root: ${repoPath}`,
      "NOT_GIT_REPO",
    );
  }
}

// ---------------------------------------------------------------------------
// Core spawn
// ---------------------------------------------------------------------------

/**
 * Spawn `git <args>` with argument arrays. Never uses a shell.
 * Enforces timeout and stdout size limits.
 */
function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (stdout.length > MAX_OUTPUT_BYTES) {
        killed = true;
        child.kill();
        reject(
          unprocessable(
            `Git output exceeds ${MAX_OUTPUT_BYTES} byte limit`,
            "OUTPUT_TOO_LARGE",
          ),
        );
      }
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);

    child.on("close", (code, signal) => {
      if (killed) return;
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const reason = signal ? `killed by signal ${signal}` : `exit code ${code}`;
        const cleanErr = sanitizeStderr(stderr);
        let message = `Git command failed: ${reason}`;
        if (/ambiguous argument '([^']+)': unknown revision/i.test(cleanErr)) {
          const badRef = cleanErr.match(/ambiguous argument '([^']+)': unknown revision/i)?.[1];
          message = `Git ref "${badRef}" does not exist in this repository. Verify that the branch or commit exists (e.g. "main" vs "master").`;
        } else if (/Not a valid object name ([^\s]+)/i.test(cleanErr)) {
          const badRef = cleanErr.match(/Not a valid object name ([^\s]+)/i)?.[1];
          message = `Invalid Git object or reference: "${badRef}".`;
        } else if (/bad revision '([^']+)'/i.test(cleanErr)) {
          const badRef = cleanErr.match(/bad revision '([^']+)'/i)?.[1];
          message = `Invalid Git revision: "${badRef}".`;
        }

        reject(
          unprocessable(
            message,
            "GIT_ERROR",
            {
              args: ["git", ...args],
              exitCode: code,
              signal,
              stderr: cleanErr,
            },
          ),
        );
      }
    });

    child.on("error", (err) => {
      if (killed) return;
      reject(
        unprocessable(
          "Failed to spawn git process",
          "GIT_SPAWN_ERROR",
          { message: err.message },
        ),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/**
 * Parse `git diff --name-status` output.
 * Each line: `<STATUS>\t<path>` or `<STATUS>\t<oldPath>\t<newPath>` for renames.
 */
function parseNameStatus(raw: string): Map<string, GitDiffFile> {
  const files = new Map<string, GitDiffFile>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 2) continue;

    const code = parts[0];
    if (RENAME_CODE_RE.test(code) && parts.length >= 3) {
      const oldPath = cleanPath(parts[1]);
      const newPath = cleanPath(parts[2]);
      // A rename is represented once, keyed by its new path (oldPath kept).
      files.set(newPath, { path: newPath, status: "renamed", oldPath });
    } else {
      const status = STATUS_MAP[code];
      if (!status) continue; // skip unknown status codes
      const filePath = cleanPath(parts[1]);
      files.set(filePath, { path: filePath, status });
    }
  }

  return files;
}

/** Parse `git diff --shortstat` into numbers. */
function parseShortstat(raw: string): { additions: number; deletions: number } {
  // Format: " 1 file changed, 5 insertions(+), 2 deletions(-)"
  const addMatch = raw.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = raw.match(/(\d+)\s+deletions?\(-\)/);
  return {
    additions: addMatch ? parseInt(addMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
  };
}

/** Strip leading/trailing whitespace from a git-returned path. */
function cleanPath(p: string): string {
  return p.trim().replace(/^["']|["']$/g, "");
}

/** Remove UTF-8 BOM (U+FEFF) from the start of a string if present. */
function stripBom(s: string): string {
  return s.startsWith("\uFEFF") ? s.slice(1) : s;
}

/** Remove any path info that could leak filesystem details. */
function sanitizeStderr(stderr: string): string {
  // Keep the error message but strip long paths if present (max 200 chars)
  if (stderr.length > 500) {
    return stderr.slice(0, 500) + "...";
  }
  return stderr;
}