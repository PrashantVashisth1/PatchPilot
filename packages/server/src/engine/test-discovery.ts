// ---------------------------------------------------------------------------
// PatchPilot — test discovery & recommendation (Step 4)
//
// Discovers likely test files by convention and matches them against changed
// files using evidence: naming, imports, directory proximity, and module
// prefixes. Recommendations are discovery-only: a listed test is a candidate
// to run, never a claim that it passed (PatchPilot does not execute tests).
//
// Pure functions only — no filesystem or process access.
// ---------------------------------------------------------------------------

import { posix } from "node:path";
import type {
  TestRecommendation,
  TestMatch,
  TestMatchReason,
} from "@patchpilot/shared";
import type { FileStatus } from "@patchpilot/shared";
import type { RepoImportEdge } from "./graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangedFile {
  path: string;
  status: FileStatus;
  oldPath?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex for test/spec filename suffixes. */
const TEST_SUFFIX_RE = /\.(test|spec)\./;
const TEST_EXT_RE = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/;

/** Directory segments that denote a test directory. */
const TEST_DIRS = new Set(["__tests__", "test", "tests", "spec", "specs"]);

/** Confidence levels per match kind. */
const MATCH_CONFIDENCE: Record<TestMatchReason["kind"], number> = {
  "name-match": 1.0,
  "import-match": 0.85,
  "transitive-import": 0.7,
  "module-prefix": 0.6,
  "directory-proximity": 0.5,
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Produce ranked test recommendations grouped by changed file.
 *
 * @param testFiles    candidate test file paths (repo-relative)
 * @param forwardEdges import edges whose source is a test file (test → target)
 * @param changedFiles the files changed in the diff
 * @param reachOf      optional map: test file → modules it transitively reaches
 *                     (enables matching tests to transitively affected modules)
 */
export function discoverTestRecommendations(
  testFiles: string[],
  forwardEdges: RepoImportEdge[],
  changedFiles: ChangedFile[],
  reachOf?: Map<string, Set<string>>,
): TestRecommendation[] {
  if (testFiles.length === 0 || changedFiles.length === 0) return [];

  // Index forward edges by source (test file) → target paths.
  const testImports = new Map<string, Set<string>>();
  for (const edge of forwardEdges) {
    let targets = testImports.get(edge.source);
    if (!targets) {
      targets = new Set();
      testImports.set(edge.source, targets);
    }
    targets.add(edge.target);
  }

  const subjectCache = new Map<string, string>();

  const recommendations: TestRecommendation[] = [];

  for (const cf of changedFiles) {
    const matches: TestMatch[] = [];

    for (const testPath of testFiles) {
      const reasons = matchTestToChanged(
        testPath,
        cf,
        testImports.get(testPath),
        reachOf?.get(testPath),
        subjectCache,
      );
      if (reasons.length === 0) continue;

      matches.push({
        testFile: testPath,
        confidence: Math.max(...reasons.map((r) => MATCH_CONFIDENCE[r.kind])),
        reasons,
      });
    }

    if (matches.length === 0) continue;

    // Higher confidence first; tie-break by path for determinism.
    matches.sort((a, b) => b.confidence - a.confidence || a.testFile.localeCompare(b.testFile));

    const recommendedTests = matches.map((m) => m.testFile);
    const confidence = matches[0].confidence;

    recommendations.push({
      changedFile: cf.path,
      recommendedTests,
      reason:
        `${recommendedTests.length} test file(s) discovered covering this ` +
        `change (best-guess by naming/imports/proximity). PatchPilot does not ` +
        `execute tests — run them to validate.`,
      verificationSteps: [
        "Run the recommended test files in your local/CI test runner.",
        "Confirm failures correlate with the change before treating them as regressions.",
      ],
      confidence,
      matches,
    });
  }

  // Highest-confidence changed-file first.
  recommendations.sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) ||
      a.changedFile.localeCompare(b.changedFile),
  );
  return recommendations;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchTestToChanged(
  testPath: string,
  cf: ChangedFile,
  importedTargets: Set<string> | undefined,
  reach: Set<string> | undefined,
  subjectCache: Map<string, string>,
): TestMatchReason[] {
  const reasons: TestMatchReason[] = [];
  const candidates = cf.oldPath ? [cf.path, cf.oldPath] : [cf.path];

  let subject = subjectCache.get(testPath);
  if (subject === undefined) {
    subject = deriveSubjectPath(testPath);
    subjectCache.set(testPath, subject);
  }

  // 1. import-match: this test directly imports the changed file.
  if (importedTargets) {
    for (const c of candidates) {
      if (importedTargets.has(c)) {
        reasons.push({ kind: "import-match", file: c, detail: `imports "${c}"` });
      }
    }
  }

  // 2. transitive-import: this test reaches the changed file indirectly.
  if (reach) {
    for (const c of candidates) {
      if (reach.has(c) && !importedTargets?.has(c)) {
        reasons.push({
          kind: "transitive-import",
          file: c,
          detail: `transitively depends on "${c}"`,
        });
      }
    }
  }

  // 3. name-match: the test's subject equals a changed file.
  for (const c of candidates) {
    if (c === subject) {
      reasons.push({
        kind: "name-match",
        file: cf.path,
        detail: `test subject "${subject}" matches changed file`,
      });
    }
  }

  // 4. module-prefix: subject and changed file share a stem or dir prefix.
  const subjectStem = posix.basename(subject).replace(TEST_EXT_RE, "");
  for (const c of candidates) {
    if (reasons.some((r) => r.file === c)) continue;
    if (sameModulePrefix(c, subject)) {
      reasons.push({
        kind: "module-prefix",
        file: cf.path,
        detail: `test "${subjectStem}" shares module prefix with "${c}"`,
      });
    }
  }

  // 5. directory-proximity: same directory as a changed file.
  if (candidates.some((c) => posix.dirname(c) === dirOfTest(testPath))) {
    reasons.push({
      kind: "directory-proximity",
      file: cf.path,
      detail: `same directory as "${cf.path}"`,
    });
  }

  return dedupeReasons(reasons);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dirOfTest(testPath: string): string {
  const segments = posix.dirname(testPath).split("/");
  // A test in a `__tests__`/`tests` directory is proxied to its parent dir.
  const filtered = segments.filter((s) => !TEST_DIRS.has(s));
  return filtered.join("/");
}

function sameModulePrefix(changedPath: string, subject: string): boolean {
  const changedStem = posix.basename(changedPath).replace(TEST_EXT_RE, "");
  const subjectStem = posix.basename(subject).replace(TEST_EXT_RE, "");
  if (!changedStem || !subjectStem) return false;
  return changedStem.startsWith(subjectStem) || subjectStem.startsWith(changedStem);
}

function deriveSubjectPath(testPath: string): string {
  let p = testPath;

  // Strip the `.test` / `.spec` marker.
  p = p.replace(TEST_SUFFIX_RE, ".");

  // Strip a leading/embedded test directory segment.
  const segments = p.split("/");
  const testDirIdx = segments.findIndex((seg) => TEST_DIRS.has(seg));
  if (testDirIdx !== -1) {
    segments.splice(testDirIdx, 1);
    p = segments.join("/");
  }

  return posix.normalize(p);
}

function dedupeReasons(reasons: TestMatchReason[]): TestMatchReason[] {
  const seen = new Set<string>();
  const out: TestMatchReason[] = [];
  for (const r of reasons) {
    const key = `${r.kind}|${r.file}|${r.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
