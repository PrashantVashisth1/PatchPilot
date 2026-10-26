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

import { basename, extname } from "node:path";
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
} from "@patchpilot/shared";
import {
  makeFinding,
  FINDING_LARGE_DIFF,
  FINDING_FILE_DELETED,
  FINDING_FILE_RENAMED,
  FINDING_PACKAGE_CONFIG_CHANGED,
  FINDING_EXPORT_SIGNATURE_CHANGED,
  FINDING_ROUTE_FILE_CHANGED,
  LARGE_DIFF_THRESHOLD,
  computeRiskScore,
} from "@patchpilot/shared";
import type { GitDiffStats } from "../services/git.service.js";
import type { FileSource } from "./source-reader.js";
import { isJsTsFile } from "./file-kinds.js";
import { parseSource, type AstFacts } from "./ast-parser.js";
import { resolveImport } from "./resolve.js";

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
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyze(input: AnalyzeInput): AnalyzeResponse {
  const { diff, numstat, sources, trees } = input;
  const files: FileAnalysis[] = [];
  const globalFindings: Finding[] = [];
  const errors: AnalysisError[] = [];
  const dependencyGraph: DepEdge[] = [];

  for (const gf of diff.files) {
    const fileFindings: Finding[] = [];
    const ext = extname(gf.path).toLowerCase();
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

    if (isJS_TS) {
      const ast = analyzeSource(gf, sources?.get(gf.path), trees, errors);
      exports = ast.exports;
      imports = ast.imports;
      routes = ast.routes;
      dependsOn = ast.dependsOn;
      dependencyGraph.push(...ast.edges);
      fileFindings.push(...ast.findings);
    }

    files.push({
      path: gf.path,
      status: gf.status,
      oldPath: gf.oldPath,
      exports,
      imports,
      routes,
      dependsOn,
      dependedOnBy: [], // Reverse deps need a full-repo scan — later step.
      testFiles: [],
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

  const riskScore = computeRiskScore(globalFindings);

  return {
    summary: {
      totalFilesChanged: diff.files.length,
      errorCount: errors.length,
      riskScore,
      testsRecommended: 0,
    },
    files,
    dependencyGraph,
    recommendations: [],
    errors,
  };
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