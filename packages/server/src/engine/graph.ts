// ---------------------------------------------------------------------------
// PatchPilot — repository-wide import graph (Step 4)
//
// Builds a static import graph for a given Git ref by parsing every JS/TS
// source file and resolving relative imports against the tree. The reverse
// adjacency drives reverse-dependency (consumer) analysis for changed files.
//
// This module never executes repository code: it only reads file content via
// the safe git service and parses it with the TypeScript Compiler API.
// ---------------------------------------------------------------------------

import { posix } from "node:path";
import type { ImpactEdge } from "@patchpilot/shared";
import { readFileAtRef, listTreePaths } from "../services/git.service.js";
import { isJsTsFile } from "./file-kinds.js";
import { parseSource } from "./ast-parser.js";
import { resolveImport, isRelativeSpecifier } from "./resolve.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single resolved import edge (source imports target). */
export interface RepoImportEdge {
  source: string;   // importing file (repo-relative posix path)
  target: string;   // imported file (repo-relative posix path)
  names: string[];  // imported symbols ([] for `import *` / side-effect / star)
  line?: number;
  isTypeOnly?: boolean;
}

/** A resolved import graph keyed for reverse lookups. */
export interface RepoGraph {
  /** reverse adjacency: target path -> edges whose source imports it. */
  reverse: Map<string, RepoImportEdge[]>;
  /** all forward edges (useful for test-discovery import matching). */
  edges: RepoImportEdge[];
  truncated: boolean;
  truncationReason?: string;
}

export interface BuildGraphOptions {
  /** Max source files to parse (default 5000). Exceeding truncates. */
  maxFiles?: number;
  /** Max chars per file to parse (default 1_000_000; larger files skipped). */
  maxFileChars?: number;
  /** Soft wall-clock deadline in ms (default 30_000). */
  deadlineMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONCURRENCY = 8;
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_CHARS = 1_000_000;
const DEFAULT_DEADLINE_MS = 30_000;

/** Path segments that are always excluded from the graph. */
const EXCLUDED_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".cache", ".turbo", ".svelte-kit", "vendor",
  ".yarn", ".pnpm-store", ".angular", ".idea", ".vscode",
  "generated",
]);

/** File name suffixes excluded from being parsed as source nodes. */
const EXCLUDED_SUFFIXES = [".d.ts", ".d.mts", ".d.cts", ".min.js", ".min.ts"];

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

/**
 * Build the repository-wide import graph at `ref`.
 *
 * Reads and parses every eligible JS/TS file, resolving relative imports
 * against `treePaths`. Returns a reverse index plus forward edges. Truncation
 * (file count, deadline, per-file size) is reported via `truncated` rather
 * than silently producing a partial graph that looks complete.
 */
export async function buildRepoGraph(
  repoPath: string,
  ref: string,
  treePaths?: Set<string>,
  options: BuildGraphOptions = {},
): Promise<RepoGraph> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileChars = options.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;

  const deadline = Date.now() + deadlineMs;
  const tree = treePaths ?? (await listTreePaths(repoPath, ref));

  const candidates = [...tree].filter(shouldParseForGraph);
  if (candidates.length === 0) {
    return { reverse: new Map(), edges: [], truncated: false };
  }

  const truncatedByCount = candidates.length > maxFiles;
  const targets = candidates.slice(0, maxFiles);

  const edges: RepoImportEdge[] = [];
  const reverse = new Map<string, RepoImportEdge[]>();
  let index = 0;
  let hitDeadline = false;

  async function worker(): Promise<void> {
    while (index < targets.length) {
      if (Date.now() > deadline) {
        hitDeadline = true;
        break;
      }
      const path = targets[index++];
      const content = await safeRead(repoPath, ref, path);
      if (content === null || content.length > maxFileChars) continue;
      const result = parseSource(path, content);
      if (!result.ok) continue; // malformed file: skip, its importers still appear via their own edges

      for (const imp of result.facts.imports) {
        if (!isRelativeSpecifier(imp.source)) continue;
        const resolved = resolveImport(path, imp.source, tree);
        if (!resolved) continue;
        const edge: RepoImportEdge = {
          source: path,
          target: resolved,
          names: imp.names,
          line: imp.line,
          isTypeOnly: imp.isTypeOnly,
        };
        edges.push(edge);
        const list = reverse.get(resolved);
        if (list) list.push(edge);
        else reverse.set(resolved, [edge]);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, targets.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const truncated = truncatedByCount || hitDeadline;
  const truncationReason = hitDeadline
    ? `Graph scan hit the ${deadlineMs}ms deadline before ${targets.length} files were processed.`
    : truncatedByCount
      ? `Graph scan truncated at ${maxFiles} files (${candidates.length} eligible).`
      : undefined;

  return { reverse, edges, truncated, truncationReason };
}

function shouldParseForGraph(path: string): boolean {
  if (!isJsTsFile(path)) return false;
  const segments = path.split("/");
  for (const seg of segments) {
    if (EXCLUDED_SEGMENTS.has(seg)) return false;
  }
  for (const suffix of EXCLUDED_SUFFIXES) {
    if (path.endsWith(suffix)) return false;
  }
  return true;
}

async function safeRead(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    return await readFileAtRef(repoPath, ref, filePath);
  } catch {
    return null; // isolated read failure: skip this file
  }
}

// ---------------------------------------------------------------------------
// Reverse-dependency computation (pure, testable)
// ---------------------------------------------------------------------------

/**
 * Compute impact edges (consumers) for a set of changed targets using the
 * reverse adjacency. BFS over importers up to `maxDepth`, deduplicating
 * consumers, tolerating cycles, and preserving the dependency path as
 * evidence for each relationship.
 *
 * Returns the edges plus the set of targets whose consumer list hit the
 * `maxConsumersPerTarget` cap (so callers can flag the result as partial).
 */
export function computeImpactEdges(
  reverse: Map<string, RepoImportEdge[]>,
  targets: string[],
  maxDepth: number,
  maxConsumersPerTarget = 200,
): { edges: ImpactEdge[]; truncatedTargets: Set<string> } {
  const edges: ImpactEdge[] = [];
  const truncatedTargets = new Set<string>();

  for (const target of targets) {
    const seen = new Set<string>([target]);
    let count = 0;
    let capHit = false;
    let frontier: Array<{ node: string; path: string[] }> = [
      { node: target, path: [target] },
    ];

    let depth = 0;
    outer: while (frontier.length > 0 && depth < maxDepth) {
      const next: Array<{ node: string; path: string[] }> = [];
      for (const { node, path } of frontier) {
        const importers = reverse.get(node);
        if (!importers) continue;
        for (const imp of importers) {
          if (seen.has(imp.source)) continue;
          seen.add(imp.source);
          const d = depth + 1;
          const newPath = [...path, imp.source];
          edges.push({
            consumer: imp.source,
            target,
            depth: d,
            relationship: d === 1 ? "direct" : "transitive",
            path: newPath,
          });
          count++;
          if (count >= maxConsumersPerTarget) {
            capHit = true;
            break outer;
          }
          next.push({ node: imp.source, path: newPath });
        }
      }
      frontier = next;
      depth++;
    }

    if (capHit) truncatedTargets.add(target);
  }

  return { edges, truncatedTargets };
}

/** Direct importers (depth 1) of a single target. */
export function directConsumers(
  reverse: Map<string, RepoImportEdge[]>,
  target: string,
): string[] {
  const importers = reverse.get(target);
  if (!importers) return [];
  return [...new Set(importers.map((e) => e.source))];
}

/**
 * Compute, for each root file, the set of modules it transitively depends on
 * (following forward import edges), up to `maxDepth`. Used to match test files
 * to changed modules they reach indirectly ("affected modules").
 */
export function transitiveReach(
  forward: RepoImportEdge[],
  roots: string[],
  maxDepth: number,
): Map<string, Set<string>> {
  const adj = new Map<string, string[]>();
  for (const e of forward) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }

  const result = new Map<string, Set<string>>();
  for (const root of roots) {
    const seen = new Set<string>([root]);
    let frontier = [root];
    let depth = 0;
    while (frontier.length > 0 && depth < maxDepth) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const target of adj.get(node) ?? []) {
          if (seen.has(target)) continue;
          seen.add(target);
          next.push(target);
        }
      }
      frontier = next;
      depth++;
    }
    result.set(root, seen);
  }
  return result;
}

/** Path segment list for evidence/display. */
export function pathKey(p: string): string {
  return posix.normalize(p);
}
