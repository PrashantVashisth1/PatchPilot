// ---------------------------------------------------------------------------
// Tests: engine/analyzer.ts
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { analyze } from "../engine/analyzer.js";
import type { GitDiffStats } from "../services/git.service.js";
import type { AnalyzeResponse, FileStatus } from "@patchpilot/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(
  path: string,
  status: FileStatus,
  oldPath?: string,
) {
  return { path, status, oldPath };
}

function makeStats(files: ReturnType<typeof makeFile>[], additions = 0, deletions = 0): GitDiffStats {
  return { files, additions, deletions };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyze", () => {
  it("returns empty report for a single modified JS file with no special findings", () => {
    const result = analyze({
      diff: makeStats([makeFile("src/utils.ts", "modified")]),
    });

    assert.equal(result.summary.totalFilesChanged, 1);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, "src/utils.ts");
    assert.equal(result.files[0].status, "modified");
    assert.equal(result.files[0].findings.length, 0);
    assert.equal(result.summary.riskScore.value, 0);
    assert.equal(result.summary.riskScore.label, "low");
    assert.equal(result.summary.errorCount, 0);
  });

  it("flags deleted files with a finding and error", () => {
    const result = analyze({
      diff: makeStats([makeFile("src/old.ts", "deleted")]),
    });

    const file = result.files[0];
    assert.equal(file.status, "deleted");

    const deletedFinding = file.findings.find((f) => f.id === "file-deleted");
    assert.ok(deletedFinding, "should have file-deleted finding");
    assert.ok(deletedFinding!.evidence[0].classification === "verified");

    const error = result.errors.find(
      (e) => e.file === "src/old.ts" && e.code === "UNSUPPORTED_FORMAT",
    );
    assert.ok(error, "should warn that deleted files can't be analyzed");

    assert.ok(result.summary.riskScore.value > 0, "deletion should contribute to risk");
  });

  it("flags renamed files", () => {
    const result = analyze({
      diff: makeStats([makeFile("src/new.ts", "renamed", "src/old.ts")]),
    });

    const renamedFinding = result.files[0].findings.find((f) => f.id === "file-renamed");
    assert.ok(renamedFinding, "should have file-renamed finding");
    assert.ok(result.summary.riskScore.value > 0);
  });

  it("flags config file changes", () => {
    const result = analyze({
      diff: makeStats([
        makeFile("package.json", "modified"),
        makeFile("tsconfig.json", "modified"),
        makeFile("src/index.ts", "modified"),
      ]),
    });

    // package.json → config finding
    const pkg = result.files.find((f) => f.path === "package.json")!;
    assert.ok(
      pkg.findings.some((f) => f.id === "package-config-changed"),
      "package.json should trigger config finding",
    );

    const tsconfig = result.files.find((f) => f.path === "tsconfig.json")!;
    assert.ok(
      tsconfig.findings.some((f) => f.id === "package-config-changed"),
      "tsconfig.json should trigger config finding",
    );

    // index.ts is JS/TS but not config → no finding
    const index = result.files.find((f) => f.path === "src/index.ts")!;
    assert.equal(index.findings.length, 0, "index.ts should have no findings");
  });

  it("warns about non-JS/TS files but still includes them", () => {
    const result = analyze({
      diff: makeStats([
        makeFile("src/code.ts", "modified"),
        makeFile("README.md", "modified"),
        makeFile("image.png", "added"),
        makeFile("styles.css", "modified"),
      ]),
    });

    const md = result.files.find((f) => f.path === "README.md")!;
    const png = result.files.find((f) => f.path === "image.png")!;
    const css = result.files.find((f) => f.path === "styles.css")!;
    const ts = result.files.find((f) => f.path === "src/code.ts")!;

    // Non-JS/TS files should have warnings
    assert.equal(
      result.errors.filter((e) => e.file === "README.md").length,
      1,
      "README.md should have warning",
    );
    assert.equal(
      result.errors.filter((e) => e.file === "image.png").length,
      1,
      "image.png should have warning",
    );
    assert.equal(
      result.errors.filter((e) => e.file === "styles.css").length,
      1,
      "styles.css should have warning",
    );

    // JS/TS should NOT have unsupported warning
    assert.equal(
      result.errors.filter((e) => e.file === "src/code.ts").length,
      0,
      "code.ts should NOT have unsupported warning",
    );

    // All files still appear in the report
    assert.equal(result.files.length, 4);
  });

  it("detects large diffs", () => {
    const manyFiles = Array.from({ length: 30 }, (_, i) =>
      makeFile(`src/module${i}.ts`, "modified"),
    );

    const result = analyze({ diff: makeStats(manyFiles) });

    const largeDiffFinding = result.summary.riskScore.findings.find(
      (f) => f.id === "large-diff",
    );
    assert.ok(largeDiffFinding, "should have large-diff finding at threshold");
    assert.equal(result.files.length, 30);
  });

  it("does NOT flag large diff below threshold", () => {
    const fewFiles = Array.from({ length: 29 }, (_, i) =>
      makeFile(`src/module${i}.ts`, "modified"),
    );

    const result = analyze({ diff: makeStats(fewFiles) });

    const largeDiffFinding = result.summary.riskScore.findings.find(
      (f) => f.id === "large-diff",
    );
    assert.ok(!largeDiffFinding, "should NOT have large-diff below threshold");
  });

  it("includes numstat line counts when provided", () => {
    const numstat = new Map([
      ["src/app.ts", { additions: 42, deletions: 7 }],
      ["README.md", { additions: 3, deletions: 0 }],
    ]);

    const result = analyze({
      diff: makeStats([makeFile("src/app.ts", "modified"), makeFile("README.md", "modified")]),
      numstat,
    });

    const app = result.files.find((f) => f.path === "src/app.ts")!;
    assert.equal(app.additions, 42);
    assert.equal(app.deletions, 7);

    const readme = result.files.find((f) => f.path === "README.md")!;
    assert.equal(readme.additions, 3);
    assert.equal(readme.deletions, 0);
  });

  it("risk score increases with multiple severity findings", () => {
    // Deleted config file: highest contribution
    const result = analyze({
      diff: makeStats([makeFile("package.json", "deleted")]),
    });

    // Deleted file + config change = two findings contributing
    const pkg = result.files.find((f) => f.path === "package.json")!;
    const findingCount = pkg.findings.length;
    assert.ok(findingCount >= 2, `expected at least 2 findings, got ${findingCount}`); // deleted + config
    assert.ok(result.summary.riskScore.value > 0);
  });

  it("does not invent dependency or test data", () => {
    const result = analyze({
      diff: makeStats([makeFile("src/a.ts", "modified"), makeFile("src/b.ts", "modified")]),
    });

    for (const file of result.files) {
      assert.equal(file.dependsOn.length, 0);
      assert.equal(file.dependedOnBy.length, 0);
      assert.equal(file.exports.length, 0);
      assert.equal(file.imports.length, 0);
      assert.equal(file.routes.length, 0);
      assert.equal(file.testFiles.length, 0);
    }

    assert.equal(result.dependencyGraph.length, 0);
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.summary.testsRecommended, 0);
  });

  it("response matches AnalyzeResponse schema", () => {
    const result: AnalyzeResponse = analyze({
      diff: makeStats([makeFile("src/index.ts", "modified")]),
    });

    // Verify all top-level keys exist
    assert.ok("summary" in result);
    assert.ok("files" in result);
    assert.ok("dependencyGraph" in result);
    assert.ok("recommendations" in result);
    assert.ok("errors" in result);

    // Summary shape
    assert.ok(typeof result.summary.totalFilesChanged === "number");
    assert.ok(typeof result.summary.errorCount === "number");
    assert.ok(typeof result.summary.testsRecommended === "number");
    assert.ok("riskScore" in result.summary);
    assert.ok(["low", "medium", "high"].includes(result.summary.riskScore.label));
  });
});