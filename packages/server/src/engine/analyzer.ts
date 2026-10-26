// ---------------------------------------------------------------------------
// PatchPilot — Analysis engine
//
// Step 2: Git-backed facts (change types, line stats, config/deletion findings).
// Step 3: AST facts for JS/TS files, read at the correct base/head revisions —
//         exports, imports, routes, export-signature changes, resolved
//         relative imports, and evidence-backed findings from those facts.
//
// Not done yet (later steps): reverse dependency graph, test matching,
// AI-generated recommendations.
// ---------------------------------------------------------------------------

import { basename } from "node:path";
import type {
  FileAnalysis,
  Finding,
  AnalysisError,
  AnalyzeResponse,
  DepEdge,
  ExportInfo,
  ImportInfo,
  Evidence,
  RouteInfo,
  ImpactEdge,
  ImpactDetail,
  TestRecommendation,
} from "@patchpilot/shared";
import {
  makeFinding,
  FINDING_LARGE_DIFF,
  FINDING_FILE_DELETED,
  FINDING_FILE_RENAMED,
  FINDING_PACKAGE_CONFIG_CHANGED,
  FINDING_EXPORT_SIGNATURE_CHANGED,
  FINDING_ROUTE_FILE_CHANGED,
  FINDING_DOWNSTREAM_IMPACT,
  LARGE_DIFF_THRESHOLD,
  computeRiskScore,
} from "@patchpilot/shared";
import type { GitDiffStats, GitDiffFile } from "../services/git.service.js";
import type { FileSource } from "./source-reader.js";
import { isJsTsFile } from "./file-kinds.js";
import { parseSource, type AstFacts } from "./ast-parser.js";
import { resolveImport } from "./resolve.js";
import {
  computeImpactEdges,
  transitiveReach,
  type RepoGraph,
  type RepoImportEdge,
} from "./graph.js";
import { discoverTestRecommendations } from "./test-discovery.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Basenames that, when changed, are treated as config changes. */
const CONFIG_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.build.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  "eslint.config.js",
  "eslint.config.mjs",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "vitest.config.js",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "webpack.config.ts",
  "rollup.config.js",
  "rollup.config.ts",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.js",
  ".env.example",
]);

/** Maximum evidence entries cited in a single finding. */
const MAX_FINDING_EVIDENCE = 5;

/** Default transitive dependency depth for impact analysis. */
const DEFAULT_MAX_DEPTH = 5;

/** Default max consumers reported per changed target. */
const DEFAULT_MAX_CONSUMERS = 200;

/** Direct consumers above this threshold trigger a high-fan-in risk signal. */
export const HIGH_FAN_IN_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

export interface AnalyzeInput {
  diff: GitDiffStats;
  /** Per-file line stats from git diff --numstat (optional). */
  numstat?: Map<string, { additions: number; deletions: number }>;
  /** Base/head source content for JS/TS files (optional; skips AST when absent). */
  sources?: Map<string, FileSource>;
  /** Paths present at each ref, used as the import-resolution oracle. */
  trees?: { base?: Set<string>; head?: Set<string> };
  /** Repository-wide import graph at head (optional; enables impact analysis). */
  graph?: RepoGraph;
  /** Repository-wide import graph at base (optional; enables removed-file impact). */
  baseGraph?: RepoGraph;
  /** Full repo file listing at head (optional; enables test discovery). */
  repoFiles?: string[];
  /** Maximum transitive depth for reverse-dependency analysis. */
  maxTransitiveDepth?: number;
  /** Maximum consumers reported per changed file. */
  maxConsumersPerTarget?: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyze(input: AnalyzeInput): AnalyzeResponse {
  const { diff, numstat, sources, trees } = input;
  const maxDepth = input.maxTransitiveDepth ?? DEFAULT_MAX_DEPTH;
  const maxConsumers = input.maxConsumersPerTarget ?? DEFAULT_MAX_CONSUMERS;

  const files: FileAnalysis[] = [];
  const globalFindings: Finding[] = [];
  const errors: AnalysisError[] = [];
  const dependencyGraph: DepEdge[] = [];

  // ---- Step 4: repository-wide impact (reverse dependencies) ----
  const { impact, truncatedTargets } = buildImpact(
    input.graph,
    input.baseGraph,
    diff.files,
    maxDepth,
    maxConsumers,
  );
  const directByFile = directConsumersByFile(impact);

  for (const gf of diff.files) {
    const fileFindings: Finding[] = [];
    const fileName = basename(gf.path);
    const isJS_TS = isJsTsFile(gf.path);
    const isConfig = CONFIG_BASENAMES.has(fileName) ||
      (gf.oldPath ? CONFIG_BASENAMES.has(basename(gf.oldPath)) : false);

    const lineStats = numstat?.get(gf.path);

    // ---- Verified finding: deleted file ----
    if (gf.status === "deleted") {
      fileFindings.push(
        makeFinding(FINDING_FILE_DELETED, [
          {
            source: "git-diff",
            classification: "verified",
            description: `File deleted: ${gf.path}`,
            file: gf.path,
          },
        ]),
      );
    }

    // ---- Verified finding: renamed file ----
    if (gf.status === "renamed" && gf.oldPath) {
      fileFindings.push(
        makeFinding(FINDING_FILE_RENAMED, [
          {
            source: "git-diff",
            classification: "verified",
            description: `File renamed from "${gf.oldPath}" to "${gf.path}"`,
            file: gf.path,
          },
        ]),
      );
    }

    // ---- Verified finding: config file changed ----
    if (isConfig) {
      fileFindings.push(
        makeFinding(FINDING_PACKAGE_CONFIG_CHANGED, [
          {
            source: "git-diff",
            classification: "verified",
            description: `Configuration file changed: ${gf.path}`,
            file: gf.path,
          },
        ]),
      );
    }

    // ---- Unsupported-file warning (non-source files) ----
    if (!isJS_TS && !isConfig) {
      errors.push({
        file: gf.path,
        message: `File type not supported for static analysis. AST parsing, dependency tracing, and test matching will be skipped.`,
        code: "UNSUPPORTED_FORMAT",
      });
    }

    // ---- AST analysis for JS/TS files ----
    let exports: ExportInfo[] = [];
    let imports: ImportInfo[] = [];
    let routes: RouteInfo[] = [];
    let dependsOn: string[] = [];
    let removedExports: string[] = [];
    let changedExports: string[] = [];

    if (isJS_TS) {
      const ast = analyzeSource(gf, sources?.get(gf.path), trees, errors);
      exports = ast.exports;
      imports = ast.imports;
      routes = ast.routes;
      dependsOn = ast.dependsOn;
      removedExports = ast.removedExports;
      changedExports = ast.changedExports;
      dependencyGraph.push(...ast.edges);
      fileFindings.push(...ast.findings);
    }

    // ---- Step 4: reverse dependencies for this changed file ----
    const dependedOnBy = consumersOf(gf, directByFile);

    // ---- Step 4: downstream-impact finding (inferred risk) ----
    if (dependedOnBy.length > 0 && (removedExports.length > 0 || changedExports.length > 0)) {
      fileFindings.push(
        downstreamImpactFinding(gf.path, dependedOnBy, removedExports, changedExports),
      );
    }

    files.push({
      path: gf.path,
      status: gf.status,
      oldPath: gf.oldPath,
      exports,
      imports,
      routes,
      dependsOn,
      dependedOnBy,
      testFiles: [], // populated during test discovery below
      findings: fileFindings,
      additions: lineStats?.additions,
      deletions: lineStats?.deletions,
    });

    globalFindings.push(...fileFindings);
  }

  // ---- Verified finding: large diff ----
  if (diff.files.length >= LARGE_DIFF_THRESHOLD) {
    globalFindings.push(
      makeFinding(FINDING_LARGE_DIFF, [
        {
          source: "git-diff",
          classification: "verified",
          description: `Large change set: ${diff.files.length} files changed (threshold: ${LARGE_DIFF_THRESHOLD})`,
          file: "<diff>",
        },
      ]),
    );
  }

  // ---- Step 4: test discovery ----
  const recommendations = discoverTests(input, files);

  // ---- Step 4: attach discovered test files to each changed file ----
  const testByChanged = indexRecommendedTests(recommendations);
  for (const file of files) {
    file.testFiles = testByChanged.get(file.path) ?? [];
  }

  // ---- Step 4: report partial scans explicitly ----
  const graphTruncated = input.graph?.truncated || input.baseGraph?.truncated;
  if (graphTruncated) {
    errors.push({
      file: "<graph>",
      message: `Impact analysis is partial: ${input.graph?.truncationReason ?? input.baseGraph?.truncationReason ?? "graph scan truncated"}`,
      code: "GRAPH_TRUNCATED",
    });
  }

  const riskScore = computeRiskScore(globalFindings);

  return {
    summary: {
      totalFilesChanged: diff.files.length,
      errorCount: errors.length,
      riskScore,
      testsRecommended: recommendations.length,
    },
    files,
    dependencyGraph,
    impact,
    impactDetails: buildImpactDetails(diff.files, impact, truncatedTargets),
    scanComplete: !graphTruncated,
    scanNote: graphTruncated
      ? (input.graph?.truncationReason ?? input.baseGraph?.truncationReason)
      : undefined,
    recommendations,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Step 4 helpers
// ---------------------------------------------------------------------------

interface ImpactResult {
  impact: ImpactEdge[];
  truncatedTargets: Set<string>;
}

function buildImpact(
  graph: RepoGraph | undefined,
  baseGraph: RepoGraph | undefined,
  diffFiles: GitDiffFile[],
  maxDepth: number,
  maxConsumers: number,
): ImpactResult {
  if (!graph && !baseGraph) {
    return { impact: [], truncatedTargets: new Set() };
  }

  const headReverse = graph?.reverse ?? new Map<string, RepoImportEdge[]>();
  const baseReverse = baseGraph?.reverse ?? new Map<string, RepoImportEdge[]>();

  // Files that exist at head: added, modified, renamed (new path).
  const headTargets = diffFiles
    .filter((f) => f.status !== "deleted")
    .map((f) => f.path);
  // Files that exist at base: deleted (path), renamed (old path).
  const baseTargets = diffFiles
    .filter((f) => f.status === "deleted" || f.status === "renamed")
    .map((f) => (f.status === "renamed" && f.oldPath ? f.oldPath : f.path));

  const head = computeImpactEdges(headReverse, headTargets, maxDepth, maxConsumers);
  const base = computeImpactEdges(baseReverse, baseTargets, maxDepth, maxConsumers);

  const seen = new Set<string>();
  const merged: ImpactEdge[] = [];
  const truncatedTargets = new Set<string>();
  for (const e of [...head.edges, ...base.edges]) {
    const key = `${e.target}|${e.consumer}|${e.depth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  for (const t of head.truncatedTargets) truncatedTargets.add(t);
  for (const t of base.truncatedTargets) truncatedTargets.add(t);

  return { impact: merged, truncatedTargets };
}

function directConsumersByFile(impact: ImpactEdge[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const e of impact) {
    if (e.depth !== 1) continue;
    let s = map.get(e.target);
    if (!s) {
      s = new Set();
      map.set(e.target, s);
    }
    s.add(e.consumer);
  }
  return new Map([...map.entries()].map(([k, v]) => [k, [...v].sort()]));
}

function consumersOf(
  gf: GitDiffFile,
  directByFile: Map<string, string[]>,
): string[] {
  const set = new Set<string>();
  for (const c of directByFile.get(gf.path) ?? []) set.add(c);
  if (gf.oldPath) {
    for (const c of directByFile.get(gf.oldPath) ?? []) set.add(c);
  }
  return [...set].sort();
}

function buildImpactDetails(
  diffFiles: GitDiffFile[],
  impact: ImpactEdge[],
  truncatedTargets: Set<string>,
): ImpactDetail[] {
  return diffFiles.map((gf) => {
    const ownTargets = new Set<string>([gf.path]);
    if (gf.oldPath) ownTargets.add(gf.oldPath);

    const direct = new Set<string>();
    const transitive = new Set<string>();
    for (const e of impact) {
      if (!ownTargets.has(e.target)) continue;
      if (e.depth === 1) direct.add(e.consumer);
      else transitive.add(e.consumer);
    }

    const directList = [...direct].sort();
    const transitiveList = [...transitive].sort();
    const truncated = [...ownTargets].some((t) => truncatedTargets.has(t));

    return {
      file: gf.path,
      directConsumers: directList,
      transitiveConsumers: transitiveList,
      transitiveCount: transitiveList.length,
      truncated,
    };
  });
}

function downstreamImpactFinding(
  filePath: string,
  consumers: string[],
  removedExports: string[],
  changedExports: string[],
): Finding {
  const evidence: Evidence[] = [];

  for (const consumer of consumers.slice(0, MAX_FINDING_EVIDENCE)) {
    evidence.push({
      source: "ast",
      classification: "inferred",
      description:
        `Consumer "${consumer}" imports this module and may be affected by ` +
        describeExportDelta(removedExports, changedExports),
      file: consumer,
    });
  }

  if (consumers.length > MAX_FINDING_EVIDENCE) {
    evidence.push({
      source: "ast",
      classification: "inferred",
      description: `...and ${consumers.length - MAX_FINDING_EVIDENCE} more direct consumers`,
      file: filePath,
    });
  }

  return makeFinding(FINDING_DOWNSTREAM_IMPACT, evidence, 0.6);
}

function describeExportDelta(removed: string[], changed: string[]): string {
  const parts: string[] = [];
  if (removed.length > 0) parts.push(`removed export(s): ${removed.join(", ")}`);
  if (changed.length > 0) parts.push(`changed export(s): ${changed.join(", ")}`);
  return parts.join("; ") || "changes to its exports";
}

function discoverTests(
  input: AnalyzeInput,
  files: FileAnalysis[],
): TestRecommendation[] {
  const testFiles = (input.repoFiles ?? [...(input.trees?.head ?? [])])
    .filter((p) => isTestPath(p))
    .sort();
  if (testFiles.length === 0) return [];

  const forwardEdges = input.graph?.edges ?? [];
  const changedFiles = files.map((f) => ({
    path: f.path,
    status: f.status,
    oldPath: f.oldPath,
  }));

  // Transitive reach for each test file, so tests can be matched to modules
  // they depend on indirectly ("affected modules").
  const reachOf = transitiveReach(forwardEdges, testFiles, input.maxTransitiveDepth ?? DEFAULT_MAX_DEPTH);

  return discoverTestRecommendations(testFiles, forwardEdges, changedFiles, reachOf);
}

function isTestPath(p: string): boolean {
  if (!isJsTsFile(p)) return false;
  const base = basename(p);
  return /\.(test|spec)\.[^.]+$/.test(base) || p.includes("/__tests__/");
}

function indexRecommendedTests(
  recommendations: TestRecommendation[],
): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const r of recommendations) {
    let s = map.get(r.changedFile);
    if (!s) {
      s = new Set();
      map.set(r.changedFile, s);
    }
    for (const t of r.recommendedTests) s.add(t);
  }
  return new Map([...map.entries()].map(([k, v]) => [k, [...v].sort()]));
}

// ---------------------------------------------------------------------------
// AST layer
// ---------------------------------------------------------------------------

interface AstOutcome {
  exports: ExportInfo[];
  imports: ImportInfo[];
  routes: RouteInfo[];
  dependsOn: string[];
  edges: DepEdge[];
  findings: Finding[];
  /** Names of base exports absent from head (removals). */
  removedExports: string[];
  /** Names of exports whose head signature differs from base. */
  changedExports: string[];
}

/**
 * Parse and compare base/head sources for one changed file, producing
 * per-file AST facts, findings, and import resolution. Isolated failures
 * append to `errors` and never throw.
 */
function analyzeSource(
  gf: { path: string; status: string; oldPath?: string },
  source: FileSource | undefined,
  trees: AnalyzeInput["trees"],
  errors: AnalysisError[],
): AstOutcome {
  const outcome: AstOutcome = {
    exports: [],
    imports: [],
    routes: [],
    dependsOn: [],
    edges: [],
    findings: [],
    removedExports: [],
    changedExports: [],
  };

  // No source data (legacy calls without sources, or file skipped).
  if (!source) {
    if (gf.status === "deleted") {
      errors.push({
        file: gf.path,
        message: `Deleted files cannot be statically analyzed: base content unavailable.`,
        code: "UNSUPPORTED_FORMAT",
      });
    }
    return outcome;
  }

  // Per-file read/binary/size problems — isolated, non-fatal.
  if (source.readError) {
    errors.push({
      file: gf.path,
      message: `Could not read source from Git: ${source.readError}`,
      code: "IO_ERROR",
    });
    return outcome;
  }
  if (source.binary) {
    errors.push({
      file: gf.path,
      message: `Binary content detected; AST parsing skipped.`,
      code: "UNSUPPORTED_FORMAT",
    });
    return outcome;
  }
  if (source.tooLarge) {
    errors.push({
      file: gf.path,
      message: `Source exceeds the per-file size limit for AST analysis.`,
      code: "FILE_TOO_LARGE",
    });
    return outcome;
  }

  // Which revisions do we parse?
  const basePath = gf.status === "renamed" && gf.oldPath ? gf.oldPath : gf.path;
  const parseBase = source.base !== null && gf.status !== "added";
  const parseHead = source.head !== null && gf.status !== "deleted";

  let baseResult = parseBase ? parseSource(basePath, source.base!) : null;
  let headResult = parseHead ? parseSource(gf.path, source.head!) : null;

  if (baseResult && !baseResult.ok) {
    errors.push({
      file: gf.path,
      message: `Base version could not be parsed: ${baseResult.error}`,
      code: "PARSE_ERROR",
    });
    baseResult = null; // Do not guess facts from a broken AST.
  }
  if (headResult && !headResult.ok) {
    errors.push({
      file: gf.path,
      message: `Head version could not be parsed: ${headResult.error}`,
      code: "PARSE_ERROR",
    });
    headResult = null;
  }

  // The "present" facts: head state for files that exist at head; for deleted
  // files we preserve the base version's facts (last known state).
  const present = headResult?.facts ?? (gf.status === "deleted" ? baseResult?.facts : undefined);

  if (!present) return outcome;

  outcome.exports = present.exports;
  outcome.imports = present.imports;
  outcome.routes = present.routes;

  // ---- Export signature changes (modified / renamed) ----
  if (baseResult?.ok && headResult?.ok &&
      (gf.status === "modified" || gf.status === "renamed")) {
    outcome.exports = detectSignatureChanges(
      present.exports,
      headResult.facts.exportSignatures,
      baseResult.facts.exportSignatures,
    );
    outcome.changedExports = outcome.exports
      .filter((e) => e.signatureChanged)
      .map((e) => e.name);
    outcome.removedExports = [...baseResult.facts.exportSignatures.keys()].filter(
      (name) => !outcome.exports.some((e) => e.name === name),
    );
    outcome.findings.push(
      ...exportChangeFindings(gf.path, outcome.exports, baseResult.facts),
    );
  }
  // ---- Route changes: compare before/after route sets, only with reliable
  // parse data on both sides (parse failures must not create false findings).
  const routeFinding = routeChangeFinding(gf, baseResult, headResult);
  if (routeFinding) outcome.findings.push(routeFinding);

  // ---- Import resolution (conservative, explicit) ----
  const useHeadTree = headResult !== null;
  const treeSet = useHeadTree ? trees?.head : trees?.base;
  if (treeSet && treeSet.size > 0) {
    const unresolved: string[] = [];
    const seen = new Set<string>();

    for (const imp of present.imports) {
      const resolved = resolveImport(gf.path, imp.source, treeSet);
      imp.resolvedPath = resolved;
      if (resolved) {
        if (!seen.has(resolved)) {
          seen.add(resolved);
          outcome.dependsOn.push(resolved);
          outcome.edges.push({ source: gf.path, target: resolved });
        }
      } else {
        unresolved.push(imp.source);
      }
    }

    if (unresolved.length > 0) {
      errors.push({
        file: gf.path,
        message: `Unresolved relative imports: ${[...new Set(unresolved)].join(", ")}`,
        code: "UNRESOLVED_IMPORT",
      });
    }
  }

  return outcome;
}

/**
 * Mark head exports whose base signature differs. Comparison is
 * whitespace-normalized declaration text (deterministic; see ast-parser).
 */
function detectSignatureChanges(
  headExports: ExportInfo[],
  headSignatures: Map<string, string>,
  baseSignatures: Map<string, string>,
): ExportInfo[] {
  return headExports.map((ex) => ({
    ...ex,
    signatureChanged:
      baseSignatures.has(ex.name) &&
      baseSignatures.get(ex.name) !==
        (headSignatures.get(ex.name) ?? `<unrecorded:${ex.name}>`),
  }));
}

/**
 * Compare head exports against base export signatures. Exports whose base
 * signature text differs keep `signatureChanged: true`; base-only exports are
 * removals. Both feed one evidence-backed finding per file.
 */
function exportChangeFindings(
  filePath: string,
  headExports: ExportInfo[],
  baseFacts: AstFacts,
): Finding[] {
  const changed = headExports.filter((e) => e.signatureChanged);
  const removed = [...baseFacts.exportSignatures.keys()].filter(
    (name) => !headExports.some((e) => e.name === name),
  );

  if (changed.length === 0 && removed.length === 0) return [];

  const evidence: Evidence[] = [];

  for (const ex of changed.slice(0, MAX_FINDING_EVIDENCE)) {
    evidence.push({
      source: "ast",
      classification: "verified",
      description: `Export "${ex.name}" (${ex.kind}) changed between base and head versions`,
      file: filePath,
      lineStart: ex.line,
    });
  }
  for (const name of removed.slice(0, MAX_FINDING_EVIDENCE - changed.length)) {
    evidence.push({
      source: "ast",
      classification: "verified",
      description: `Export "${name}" was removed (present in base, absent in head)`,
      file: filePath,
    });
  }

  if (changed.length + removed.length > MAX_FINDING_EVIDENCE) {
    evidence.push({
      source: "ast",
      classification: "verified",
      description: `...and ${changed.length + removed.length - MAX_FINDING_EVIDENCE} more changed/removed exports`,
      file: filePath,
    });
  }

  return [
    makeFinding(FINDING_EXPORT_SIGNATURE_CHANGED, evidence, 1.0),
  ];
}

/** Verified route-set comparison; inferred interpretation of the risk. */
function routeChangeFinding(
  gf: { path: string; status: string },
  baseResult: { ok: boolean; facts: AstFacts } | null,
  headResult: { ok: boolean; facts: AstFacts } | null,
): Finding | null {
  // Determine the before/after route sets with reliable data only.
  let beforeRoutes: RouteInfo[];
  let afterRoutes: RouteInfo[];

  switch (gf.status) {
    case "added":
      beforeRoutes = [];
      afterRoutes = headResult?.ok ? headResult.facts.routes : [];
      break;
    case "deleted":
      beforeRoutes = baseResult?.ok ? baseResult.facts.routes : [];
      afterRoutes = [];
      break;
    default: // modified / renamed — require both sides parsed cleanly
      if (!baseResult?.ok || !headResult?.ok) return null;
      beforeRoutes = baseResult.facts.routes;
      afterRoutes = headResult.facts.routes;
  }

  const keyOf = (r: RouteInfo) => `${r.framework ?? "?"}|${r.method}|${r.path}`;
  const beforeKeys = new Set(beforeRoutes.map(keyOf));
  const afterKeys = new Set(afterRoutes.map(keyOf));

  const added = [...afterKeys].filter((k) => !beforeKeys.has(k));
  const removed = [...beforeKeys].filter((k) => !afterKeys.has(k));
  if (added.length === 0 && removed.length === 0) return null;

  const routeEvidence: Evidence[] = afterRoutes
    .filter((r) => added.includes(keyOf(r)))
    .slice(0, 3)
    .map((r) => ({
      source: "ast" as const,
      classification: "verified" as const,
      description: `Route registered: ${r.method} ${r.path} (${r.framework ?? "unknown"} framework)`,
      file: gf.path,
      lineStart: r.line,
    }));

  const removedEvidence: Evidence[] = beforeRoutes
    .filter((r) => removed.includes(keyOf(r)))
    .slice(0, 3 - routeEvidence.length)
    .map((r) => ({
      source: "ast" as const,
      classification: "verified" as const,
      description: `Route removed: ${r.method} ${r.path} (${r.framework ?? "unknown"} framework)`,
      file: gf.path,
    }));

  if (routeEvidence.length === 0 && removedEvidence.length === 0) return null;

  // Ordered inferred-first so the risk model applies the inferred weight for
  // this finding; the verified entries record the underlying route facts.
  const evidence: Evidence[] = [
    {
      source: "heuristic",
      classification: "inferred",
      description: `Route definitions changed in this file; routing behavior may be affected (${added.length} added, ${removed.length} removed)`,
      file: gf.path,
    },
    ...routeEvidence,
    ...removedEvidence,
  ];

  return makeFinding(FINDING_ROUTE_FILE_CHANGED, evidence, 0.7);
}