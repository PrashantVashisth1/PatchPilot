// ---------------------------------------------------------------------------
// PatchPilot — shared API types
// ---------------------------------------------------------------------------

/** Status of a single file in the diff. */
export type FileStatus = "added" | "modified" | "deleted" | "renamed";

// ---------------------------------------------------------------------------
// AST-derived facts
// ---------------------------------------------------------------------------

/**
 * A named export extracted from source.
 *
 * Step 3 additions (all additive, backward compatible):
 *   - `line`, `isTypeOnly`, `reExportedFrom`
 *   - `kind` widened with "let" | "var"
 */
export interface ExportInfo {
  name: string;
  kind: "function" | "class" | "const" | "let" | "var" | "type" | "interface" | "enum" | "default" | "unknown";
  /** Whether the export signature changed (only populated for modified files). */
  signatureChanged: boolean;
  /** Line number of the export (1-based). */
  line?: number;
  /** True for `export type` / type-only exports (type aliases, interfaces). */
  isTypeOnly?: boolean;
  /** Module specifier when this is a re-export (e.g. `export { x } from "./y"`). */
  reExportedFrom?: string;
}

/**
 * A local import (relative paths only; node_modules excluded).
 *
 * Step 3 additions (all additive):
 *   - `line`, `isTypeOnly`, `namespace`, `dynamic`, `resolvedPath`
 *   - `resolvedPath`: repo-relative posix path when resolved; `null` when the
 *     import was checked against the tree but could not be resolved;
 *     `undefined` when resolution was not attempted.
 */
export interface ImportInfo {
  source: string;   // e.g. "../utils/foo"
  names: string[];  // imported symbols ([] for namespace imports)
  /** Line number of the import statement (1-based). */
  line?: number;
  /** True for `import type` statements. */
  isTypeOnly?: boolean;
  /** Local binding for `import * as ns from ...`. */
  namespace?: string;
  /** True for dynamic `import("./x")` and `require("./x")`. */
  dynamic?: boolean;
  /** Resolved repo-relative path (posix separators) or null if unresolved. */
  resolvedPath?: string | null;
}

// ---------------------------------------------------------------------------
// Impact analysis (Step 4)
// ---------------------------------------------------------------------------

/** Relationship between a changed file and an impacted consumer. */
export interface ImpactEdge {
  /** The consumer file (depends on the changed file). */
  consumer: string;
  /** The changed file the consumer depends on. */
  target: string;
  /** Dependency depth: 1 = direct, 2+ = transitive (number of edges). */
  depth: number;
  /** Whether this is a direct or transitive dependency. */
  relationship: "direct" | "transitive";
  /** Path through which the consumer reaches the target (repo-relative). */
  path: string[];
}

/**
 * A detected route definition.
 * `method` is the HTTP verb for Express ("GET", "POST", ...) and "ROUTE"
 * for React Router entries (framework-specific routing, not HTTP-verb based).
 */
export interface RouteInfo {
  method: string;   // e.g. "GET", "POST", "USE", "ROUTE"
  path: string;     // e.g. "/api/users/:id"
  line: number;
  /** "express" | "react-router" when recognized. */
  framework?: string;
}

// ---------------------------------------------------------------------------
// Evidence model
// ---------------------------------------------------------------------------

/** Provenance of a piece of evidence. */
export type EvidenceSource = "git-diff" | "ast" | "filesystem" | "heuristic";

/** Whether the fact is a verified observation or a heuristic inference. */
export type EvidenceClassification = "verified" | "inferred";

/** A single piece of evidence backing a finding. */
export interface Evidence {
  source: EvidenceSource;
  classification: EvidenceClassification;
  description: string;
  /** File path the evidence was drawn from. */
  file: string;
  /** Optional line range. */
  lineStart?: number;
  lineEnd?: number;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** Severity of a single finding. */
export type FindingSeverity = "low" | "medium" | "high";

/** A risk-relevant observation, backed by evidence. */
export interface Finding {
  id: string;                // stable identifier e.g. "missing-tests"
  severity: FindingSeverity;
  /** Numeric contribution to the risk score (0-1 scale). */
  contribution: number;
  /** Confidence in this finding (0-1). 1 = deterministic. */
  confidence: number;
  evidence: Evidence[];
}

// ---------------------------------------------------------------------------
// Risk score
// ---------------------------------------------------------------------------

export type RiskLabel = "low" | "medium" | "high";

/** Transparent, explainable risk score with constituent findings. */
export interface RiskScore {
  /** Aggregate 0-100. */
  value: number;
  label: RiskLabel;
  /** Individual findings that compose the score. */
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

export interface FileAnalysis {
  path: string;
  status: FileStatus;
  oldPath?: string;   // populated for renamed files
  exports: ExportInfo[];
  imports: ImportInfo[];
  routes: RouteInfo[];
  /** Files that this file imports (direct dependencies). */
  dependsOn: string[];
  /** Files that import this file (direct reverse dependencies). */
  dependedOnBy: string[];
  /** Matched test files that should be run to validate this change. */
  testFiles: string[];
  findings: Finding[];
  /** Lines added in this file (from git diff). */
  additions?: number;
  /** Lines deleted in this file (from git diff). */
  deletions?: number;
}

// ---------------------------------------------------------------------------
// Dependency graph
//
// NOTE (Step 3): populated only with outward edges from changed files whose
// relative imports resolved inside the repository. It is a partial view by
// design — a full reverse-dependency graph is a later step.
// ---------------------------------------------------------------------------

export interface DepEdge {
  source: string;  // importing file
  target: string;  // imported file
}

// ---------------------------------------------------------------------------
// Test recommendation
// ---------------------------------------------------------------------------

export interface TestRecommendation {
  /** The changed file this recommendation covers. */
  changedFile: string;
  /** Discovered test file paths that are candidates to run (repo-relative). */
  recommendedTests: string[];
  /** Why these tests are recommended (human-readable summary). */
  reason: string;
  /** Steps a reviewer should take to manually verify. */
  verificationSteps: string[];
  /** Overall confidence in the recommendation (0-1). 1 = high-confidence name match. */
  confidence?: number;
  /** Per-test match evidence with specific reasons. */
  matches?: TestMatch[];
}

/** A single discovered test matched to a changed file. */
export interface TestMatch {
  /** The test file path (repo-relative). */
  testFile: string;
  /** Confidence for this specific test match (0-1). */
  confidence: number;
  /** How the test was matched to the changed file. */
  reasons: TestMatchReason[];
}

export interface TestMatchReason {
  /** How the match was identified. */
  kind:
    | "name-match"
    | "import-match"
    | "transitive-import"
    | "directory-proximity"
    | "module-prefix";
  /** The changed file this reason references. */
  file: string;
  /** Evidence detail. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Errors (non-fatal)
// ---------------------------------------------------------------------------

export interface AnalysisError {
  file: string;
  message: string;
  /** Error class for programmatic handling. */
  code:
    | "PARSE_ERROR"
    | "TIMEOUT"
    | "UNSUPPORTED_FORMAT"
    | "IO_ERROR"
    | "UNRESOLVED_IMPORT"
    | "FILE_TOO_LARGE"
    | "GRAPH_TRUNCATED"
    | "SCAN_INCOMPLETE"
    | "UNKNOWN";
}

// ---------------------------------------------------------------------------
// API request / response
// ---------------------------------------------------------------------------

export interface AnalyzeRequest {
  /** Absolute path to a local Git repository. */
  repoPath: string;
  /** Git ref to diff from (e.g. "main", "HEAD~1", a commit hash). */
  baseRef: string;
  /** Git ref to diff to (defaults to "HEAD"). */
  headRef?: string;
  /** Optional per-file count limit (default 500). */
  maxFiles?: number;
}

export interface AnalyzeResponse {
  summary: {
    totalFilesChanged: number;
    errorCount: number;
    riskScore: RiskScore;
    testsRecommended: number;
  };
  files: FileAnalysis[];
  dependencyGraph: DepEdge[];
  /** Repository-wide impact edges: consumers of changed files. */
  impact: ImpactEdge[];
  /** Per-file reverse-dependency details (depth + evidence). */
  impactDetails: ImpactDetail[];
  /** Whether the repository-wide scan was complete or truncated. */
  scanComplete: boolean;
  /** Human-readable note when the scan was partial. */
  scanNote?: string;
  recommendations: TestRecommendation[];
  errors: AnalysisError[];
}

/** Reverse-dependency summary for one changed file. */
export interface ImpactDetail {
  file: string;
  /** Direct (depth 1) consumers. */
  directConsumers: string[];
  /** Transitive consumers (depth 2+), deduplicated. */
  transitiveConsumers: string[];
  /** Total number of distinct transitive consumers (may exceed list if capped). */
  transitiveCount: number;
  /** Whether the transitive list was capped by a limit. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Error response envelope (shared by all routes)
// ---------------------------------------------------------------------------

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}