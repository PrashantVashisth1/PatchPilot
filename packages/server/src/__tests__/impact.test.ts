// ---------------------------------------------------------------------------
// Tests: Step 4 — repository-wide impact analysis
//
// Covers:
//   1. computeImpactEdges (direct/transitive/cycles/dedupe)
//   2. directConsumers
//   3. analyzer integration: reverse deps, removed files/exports, renamed
//   4. partial scans (truncation) and empty repositories
//   5. API backward compatibility
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { computeImpactEdges, directConsumers } from "../engine/graph.js";
import type { RepoGraph, RepoImportEdge } from "../engine/graph.js";
import { analyze } from "../engine/analyzer.js";
import type { GitDiffStats, GitDiffFile } from "../services/git.service.js";
import type { FileSource } from "../engine/source-reader.js";
import type { FileStatus, AnalyzeResponse } from "@patchpilot/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edge(source: string, target: string, names: string[] = []): RepoImportEdge {
  return { source, target, names };
}

function reverseIndex(edges: RepoImportEdge[]): Map<string, RepoImportEdge[]> {
  const map = new Map<string, RepoImportEdge[]>();
  for (const e of edges) {
    const list = map.get(e.target) ?? [];
    list.push(e);
    map.set(e.target, list);
  }
  return map;
}

function makeGraph(edges: RepoImportEdge[], truncated = false, reason?: string): RepoGraph {
  return { edges, reverse: reverseIndex(edges), truncated, truncationReason: reason };
}

function makeDiff(files: Array<{ path: string; status: FileStatus; oldPath?: string }>): GitDiffStats {
  return { files: files as GitDiffFile[], additions: 0, deletions: 0 };
}

function makeSource(path: string, base: string | null, head: string | null): FileSource {
  return { path, base, head };
}

// ---------------------------------------------------------------------------
// computeImpactEdges
// ---------------------------------------------------------------------------

describe("computeImpactEdges", () => {
  it("computes direct and transitive consumers with depth and path evidence", () => {
    // a <- b <- c ; a <- d
    const reverse = reverseIndex([
      edge("src/b.ts", "src/a.ts"),
      edge("src/c.ts", "src/b.ts"),
      edge("src/d.ts", "src/a.ts"),
    ]);

    const { edges, truncatedTargets } = computeImpactEdges(
      reverse, ["src/a.ts"], 5,
    );

    const byConsumer = new Map(edges.map((e) => [e.consumer, e]));

    assert.equal(byConsumer.get("src/b.ts")!.depth, 1);
    assert.equal(byConsumer.get("src/b.ts")!.relationship, "direct");
    assert.deepEqual(byConsumer.get("src/b.ts")!.path, ["src/a.ts", "src/b.ts"]);

    assert.equal(byConsumer.get("src/d.ts")!.depth, 1);

    assert.equal(byConsumer.get("src/c.ts")!.depth, 2);
    assert.equal(byConsumer.get("src/c.ts")!.relationship, "transitive");
    assert.deepEqual(byConsumer.get("src/c.ts")!.path, ["src/a.ts", "src/b.ts", "src/c.ts"]);

    assert.equal(edges.length, 3);
    assert.equal(truncatedTargets.size, 0);
  });

  it("terminates on cycles and deduplicates consumers", () => {
    // a <-> b cycle: a imports b, b imports a; c imports a.
    const reverse = reverseIndex([
      edge("src/a.ts", "src/b.ts"),
      edge("src/b.ts", "src/a.ts"),
      edge("src/c.ts", "src/a.ts"),
    ]);

    const { edges } = computeImpactEdges(reverse, ["src/a.ts"], 5);

    // Consumers of a: b (direct) and c (direct); b's importer is a itself → cycle ignored.
    const consumers = new Set(edges.map((e) => e.consumer));
    assert.deepEqual([...consumers].sort(), ["src/b.ts", "src/c.ts"]);
    assert.equal(edges.length, 2, "no duplicate edges");
  });

  it("enforces maxConsumersPerTarget and flags truncation", () => {
    const reverse = reverseIndex([
      edge("src/c1.ts", "src/a.ts"),
      edge("src/c2.ts", "src/a.ts"),
      edge("src/c3.ts", "src/a.ts"),
    ]);

    const { edges, truncatedTargets } = computeImpactEdges(
      reverse, ["src/a.ts"], 5, 2,
    );

    assert.equal(edges.length, 2);
    assert.ok(truncatedTargets.has("src/a.ts"));
  });

  it("respects maxDepth, never exceeding it", () => {
    const reverse = reverseIndex([
      edge("src/b.ts", "src/a.ts"),
      edge("src/c.ts", "src/b.ts"),
      edge("src/d.ts", "src/c.ts"),
    ]);

    const { edges } = computeImpactEdges(reverse, ["src/a.ts"], 2);
    const depths = edges.map((e) => e.depth);
    assert.ok(Math.max(...depths) <= 2);
    assert.ok(!edges.some((e) => e.consumer === "src/d.ts"));
  });
});

describe("directConsumers", () => {
  it("returns deduplicated direct importers", () => {
    const reverse = reverseIndex([
      edge("src/b.ts", "src/a.ts"),
      edge("src/b.ts", "src/a.ts"), // duplicate import (two import stmts)
      edge("src/c.ts", "src/a.ts"),
    ]);
    assert.deepEqual(directConsumers(reverse, "src/a.ts"), ["src/b.ts", "src/c.ts"]);
  });

  it("returns empty for unknown targets", () => {
    assert.deepEqual(directConsumers(reverseIndex([]), "src/a.ts"), []);
  });
});

// ---------------------------------------------------------------------------
// analyzer integration — reverse dependencies
// ---------------------------------------------------------------------------

describe("analyze — reverse dependency impact", () => {
  it("populates dependedOnBy, impact, and impactDetails for direct + transitive consumers", () => {
    const graph = makeGraph([
      edge("src/b.ts", "src/a.ts"),
      edge("src/c.ts", "src/b.ts"),
    ]);

    const result = analyze({
      diff: makeDiff([{ path: "src/a.ts", status: "modified" }]),
      graph,
    });

    const file = result.files.find((f) => f.path === "src/a.ts")!;
    assert.deepEqual(file.dependedOnBy, ["src/b.ts"], "direct consumers only");

    // impact has both direct (b) and transitive (c).
    const consumers = result.impact.map((e) => `${e.consumer}@${e.depth}`).sort();
    assert.deepEqual(consumers, ["src/b.ts@1", "src/c.ts@2"]);

    const detail = result.impactDetails.find((d) => d.file === "src/a.ts")!;
    assert.deepEqual(detail.directConsumers, ["src/b.ts"]);
    assert.deepEqual(detail.transitiveConsumers, ["src/c.ts"]);

    assert.equal(result.scanComplete, true);
  });

  it("identifies consumers of a removed (deleted) file via the base graph", () => {
    const baseGraph = makeGraph([
      edge("src/consumer.ts", "src/old.ts"),
    ]);

    const result = analyze({
      diff: makeDiff([{ path: "src/old.ts", status: "deleted" }]),
      baseGraph,
      sources: new Map([
        ["src/old.ts", makeSource("src/old.ts", "export const gone = 1;\n", null)],
      ]),
      trees: { base: new Set(["src/old.ts"]), head: new Set() },
    });

    const file = result.files.find((f) => f.path === "src/old.ts")!;
    assert.equal(file.status, "deleted");
    assert.deepEqual(file.dependedOnBy, ["src/consumer.ts"]);
    assert.ok(result.impact.some((e) => e.consumer === "src/consumer.ts" && e.target === "src/old.ts"));
  });

  it("merges old-path and new-path consumers for renamed files", () => {
    const graph = makeGraph([
      edge("src/newConsumer.ts", "src/new.ts"),
    ]);
    const baseGraph = makeGraph([
      edge("src/oldConsumer.ts", "src/old.ts"),
    ]);

    const result = analyze({
      diff: makeDiff([{ path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" }]),
      graph,
      baseGraph,
      sources: new Map([
        ["src/new.ts", makeSource("src/new.ts", "export function f(): void {}\n", "export function f(): void {}\n")],
      ]),
      trees: { base: new Set(["src/old.ts"]), head: new Set(["src/new.ts"]) },
    });

    const file = result.files.find((f) => f.path === "src/new.ts")!;
    assert.deepEqual(file.dependedOnBy.sort(), ["src/newConsumer.ts", "src/oldConsumer.ts"]);
  });

  it("emits a downstream-impact finding when exports change and consumers exist", () => {
    const graph = makeGraph([
      edge("src/consumer.ts", "src/lib.ts"),
    ]);

    const baseCode = "export function api(): void {}\nexport function removedFn(): void {}\n";
    const headCode = "export function api(mode: string): void {}\n";

    const result = analyze({
      diff: makeDiff([{ path: "src/lib.ts", status: "modified" }]),
      graph,
      sources: new Map([["src/lib.ts", makeSource("src/lib.ts", baseCode, headCode)]]),
      trees: { base: new Set(["src/lib.ts"]), head: new Set(["src/lib.ts"]) },
    });

    const file = result.files.find((f) => f.path === "src/lib.ts")!;
    const impactFinding = file.findings.find((f) => f.id === "downstream-impact");
    assert.ok(impactFinding, "should emit downstream-impact finding");
    assert.ok(impactFinding!.evidence.some((e) =>
      e.classification === "inferred" && e.description.includes("src/consumer.ts"),
    ));
  });

  it("lists consumers but does not label them broken when no export changed", () => {
    // Same export signature in base and head → no export change → no
    // downstream-impact finding, though consumers are still listed.
    const graph = makeGraph([edge("src/consumer.ts", "src/lib.ts")]);
    const baseCode = "export function api(): void {}\n";
    const headCode = "export function api(): void {}\n";

    const result = analyze({
      diff: makeDiff([{ path: "src/lib.ts", status: "modified" }]),
      graph,
      sources: new Map([["src/lib.ts", makeSource("src/lib.ts", baseCode, headCode)]]),
      trees: { base: new Set(["src/lib.ts"]), head: new Set(["src/lib.ts"]) },
    });

    const file = result.files.find((f) => f.path === "src/lib.ts")!;
    assert.deepEqual(file.dependedOnBy, ["src/consumer.ts"]);
    assert.ok(
      !file.findings.some((f) => f.id === "downstream-impact"),
      "no export change → no downstream-impact finding",
    );
  });

  it("reports partial scans explicitly (scanComplete=false + GRAPH_TRUNCATED)", () => {
    const graph = makeGraph([], true, "truncated at N files");
    const result = analyze({
      diff: makeDiff([{ path: "src/a.ts", status: "modified" }]),
      graph,
    });

    assert.equal(result.scanComplete, false);
    assert.ok(result.scanNote);
    assert.ok(result.errors.some((e) => e.code === "GRAPH_TRUNCATED"));
  });
});

// ---------------------------------------------------------------------------
// Empty / edge cases + backward compatibility
// ---------------------------------------------------------------------------

describe("analyze — empty / backward compatibility", () => {
  it("produces empty impact fields with no graph (empty repository)", () => {
    const result: AnalyzeResponse = analyze({
      diff: makeDiff([{ path: "src/a.ts", status: "modified" }]),
    });

    assert.deepEqual(result.impact, []);
    assert.equal(result.scanComplete, true);
    assert.equal(result.scanNote, undefined);
    // impactDetails still present (one entry per changed file, empty).
    assert.equal(result.impactDetails.length, 1);
    assert.deepEqual(result.impactDetails[0].directConsumers, []);
  });

  it("keeps the documented API shape plus Step 4 fields", () => {
    const result: AnalyzeResponse = analyze({
      diff: makeDiff([{ path: "src/a.ts", status: "modified" }]),
    });

    assert.ok("summary" in result);
    assert.ok("files" in result);
    assert.ok("dependencyGraph" in result);
    assert.ok("recommendations" in result);
    assert.ok("errors" in result);
    // Step 4 additions.
    assert.ok("impact" in result);
    assert.ok("impactDetails" in result);
    assert.ok("scanComplete" in result);
  });

  it("handles many files without exceeding consumer limits", () => {
    const edges: RepoImportEdge[] = [];
    for (let i = 0; i < 50; i++) {
      edges.push(edge(`src/c${i}.ts`, "src/a.ts"));
    }
    const graph = makeGraph(edges);

    const result = analyze({
      diff: makeDiff([{ path: "src/a.ts", status: "modified" }]),
      graph,
      maxConsumersPerTarget: 10,
    });

    const detail = result.impactDetails.find((d) => d.file === "src/a.ts")!;
    assert.equal(detail.truncated, true, "hit the consumer cap");
    assert.ok(detail.directConsumers.length <= 10);
  });
});
