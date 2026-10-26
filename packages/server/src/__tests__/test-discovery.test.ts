// ---------------------------------------------------------------------------
// Tests: Step 4 — test discovery & recommendation ranking
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { discoverTestRecommendations } from "../engine/test-discovery.js";
import type { ChangedFile } from "../engine/test-discovery.js";
import type { RepoImportEdge } from "../engine/graph.js";

function imports(source: string, targets: string[]): RepoImportEdge[] {
  return targets.map((t) => ({ source, target: t, names: [] }));
}

describe("discoverTestRecommendations", () => {
  it("matches by test-file naming (highest confidence)", () => {
    const recs = discoverTestRecommendations(
      ["src/cart.test.ts"],
      [],
      [{ path: "src/cart.ts", status: "modified" }],
    );

    assert.equal(recs.length, 1);
    assert.equal(recs[0].changedFile, "src/cart.ts");
    assert.deepEqual(recs[0].recommendedTests, ["src/cart.test.ts"]);
    assert.equal(recs[0].confidence, 1.0);
    assert.ok(recs[0].matches!.some((m) => m.reasons.some((r) => r.kind === "name-match")));
  });

  it("matches by import (test imports the changed module)", () => {
    const recs = discoverTestRecommendations(
      ["src/checkout.test.ts"],
      imports("src/checkout.test.ts", ["src/cart.ts"]),
      [{ path: "src/cart.ts", status: "modified" }],
    );

    assert.equal(recs.length, 1);
    assert.equal(recs[0].confidence, 0.85);
    assert.ok(recs[0].matches!.some((m) => m.reasons.some((r) => r.kind === "import-match")));
  });

  it("matches by directory proximity", () => {
    const recs = discoverTestRecommendations(
      ["src/nearby.spec.ts"],
      [],
      [{ path: "src/cart.ts", status: "modified" }],
    );

    assert.equal(recs.length, 1);
    assert.equal(recs[0].confidence, 0.5);
    assert.ok(recs[0].matches!.some((m) => m.reasons.some((r) => r.kind === "directory-proximity")));
  });

  it("matches tests inside __tests__ directories to their subject module", () => {
    const recs = discoverTestRecommendations(
      ["src/__tests__/cart.test.ts"],
      [],
      [{ path: "src/cart.ts", status: "modified" }],
    );

    assert.equal(recs.length, 1);
    assert.deepEqual(recs[0].recommendedTests, ["src/__tests__/cart.test.ts"]);
    assert.ok(recs[0].matches!.some((m) => m.reasons.some((r) => r.kind === "name-match")));
  });

  it("matches renamed files against both old and new paths", () => {
    const recs = discoverTestRecommendations(
      ["src/old.test.ts"],
      [],
      [{ path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" }],
    );

    assert.equal(recs.length, 1);
    assert.equal(recs[0].changedFile, "src/new.ts");
  });

  it("matches test files that transitively depend on a changed module", () => {
    // cart.test.ts -> cart.ts -> math.ts (changed). Test reaches math.ts indirectly.
    const reachOf = new Map([["src/services/cart.test.ts", new Set(["src/services/cart.ts", "src/lib/math.ts"])]]);
    const recs = discoverTestRecommendations(
      ["src/services/cart.test.ts"],
      imports("src/services/cart.test.ts", ["src/services/cart.ts"]),
      [{ path: "src/lib/math.ts", status: "modified" }],
      reachOf,
    );

    assert.equal(recs.length, 1);
    assert.equal(recs[0].confidence, 0.7);
    assert.ok(recs[0].matches!.some((m) => m.reasons.some((r) => r.kind === "transitive-import")));
  });

  it("ranks higher-confidence matches first", () => {
    const recs = discoverTestRecommendations(
      ["src/imported.spec.ts", "src/proximity.spec.ts"],
      imports("src/imported.spec.ts", ["src/util.ts"]),
      [{ path: "src/util.ts", status: "modified" }],
    );

    assert.equal(recs.length, 1, "both tests map to the same changed file");
    const order = recs[0].matches!.map((m) => m.testFile);
    assert.equal(order[0], "src/imported.spec.ts", "import-match (0.85) ranks above proximity (0.5)");
  });

  it("returns empty when no tests match", () => {
    const recs = discoverTestRecommendations(
      ["tests/unrelated.test.ts"],
      [],
      [{ path: "src/cart.ts", status: "modified" }],
    );
    assert.deepEqual(recs, []);
  });

  it("returns empty for empty inputs (empty repository)", () => {
    assert.deepEqual(discoverTestRecommendations([], [], []), []);
    assert.deepEqual(
      discoverTestRecommendations(["src/a.test.ts"], [], []),
      [],
    );
  });
});

describe("discoverTestRecommendations — integration through analyzer", () => {
  it("populates file.testFiles and summary.testsRecommended", async () => {
    const { analyze } = await import("../engine/analyzer.js");
    const result = analyze({
      diff: {
        files: [{ path: "src/cart.ts", status: "modified" }],
        additions: 0,
        deletions: 0,
      },
      repoFiles: ["src/cart.ts", "src/cart.test.ts", "src/other.ts"],
      graph: {
        edges: [],
        reverse: new Map(),
        truncated: false,
      },
    });

    const file = result.files.find((f) => f.path === "src/cart.ts")!;
    assert.deepEqual(file.testFiles, ["src/cart.test.ts"]);
    assert.equal(result.summary.testsRecommended, 1);
    assert.equal(result.recommendations.length, 1);

    // Distinguished as discovery-only, never "passed".
    assert.ok(
      !JSON.stringify(result).includes("passed"),
      "must not claim any test passed",
    );
  });
});
