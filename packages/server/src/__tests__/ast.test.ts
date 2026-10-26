// ---------------------------------------------------------------------------
// Tests: Step 3 — AST source analysis
//
// Three layers:
//   1. parseSource unit tests (in-memory, no Git)
//   2. resolveImport unit tests (tree-set oracle)
//   3. analyzer tests with injected base/head sources
// Git-backed end-to-end coverage lives in analyze.route.test.ts.
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseSource } from "../engine/ast-parser.js";
import { resolveImport } from "../engine/resolve.js";
import { analyze } from "../engine/analyzer.js";
import type { FileSource } from "../engine/source-reader.js";
import type { GitDiffStats, GitDiffFile } from "../services/git.service.js";
import type { FileStatus, AnalyzeResponse } from "@patchpilot/shared";

// ---------------------------------------------------------------------------
// parseSource — imports and re-exports
// ---------------------------------------------------------------------------

describe("parseSource — imports", () => {
  it("extracts relative static imports with names, namespace, and type-only flags", () => {
    const code = [
      'import { helper, other } from "./util";',
      'import defaultExport from "../lib/def";',
      'import * as ns from "./ns";',
      'import type { Config } from "./types";',
      'import "./side-effect";',
      'import { external } from "some-package";', // non-relative: excluded
      "",
    ].join("\n");

    const result = parseSource("src/mod.ts", code);
    assert.ok(result.ok, `should parse: ${result.error}`);

    const bySource = new Map(result.facts.imports.map((i) => [i.source, i]));

    const util = bySource.get("./util")!;
    assert.deepEqual(util.names.sort(), ["helper", "other"]);
    assert.equal(util.isTypeOnly, undefined);
    assert.ok(util.line && util.line >= 1);

    const def = bySource.get("../lib/def")!;
    assert.deepEqual(def.names, ["default"]);

    const nsImp = bySource.get("./ns")!;
    assert.deepEqual(nsImp.names, []);
    assert.equal(nsImp.namespace, "ns");

    const typeImp = bySource.get("./types")!;
    assert.equal(typeImp.isTypeOnly, true);

    // Side-effect import: recorded with no names.
    assert.ok(bySource.has("./side-effect"));

    // Non-relative package import must be excluded.
    assert.ok(!bySource.has("some-package"));
  });

  it("extracts dynamic imports and require calls with relative specifiers", () => {
    const code = [
      'async function run() { return import("./lazy"); }',
      'const cfg = require("./config");',
      'const pkg = require("external-pkg");', // excluded
      "",
    ].join("\n");

    const result = parseSource("src/mod.ts", code);
    assert.ok(result.ok);

    const sources = result.facts.imports.map((i) => i.source);
    assert.ok(sources.includes("./lazy"));
    assert.ok(sources.includes("./config"));
    assert.ok(!sources.includes("external-pkg"));

    const lazy = result.facts.imports.find((i) => i.source === "./lazy")!;
    assert.equal(lazy.dynamic, true);
  });

  it("records re-exports both as imports (dependency) and exports", () => {
    const code = [
      'export { helper } from "./util";',
      'export * from "./star";',
      'export * as starNs from "./star";',
      'export type { T } from "./types";',
      'export { deep } from "some-package";', // non-relative: export kept, import excluded
      "",
    ].join("\n");

    const result = parseSource("src/mod.ts", code);
    assert.ok(result.ok);

    // Relative re-exports create import entries (dependencies).
    // Two statements re-exporting "./star" => two import entries.
    const importSources = result.facts.imports.map((i) => i.source).sort();
    assert.deepEqual(importSources, ["./star", "./star", "./types", "./util"]);

    // Exports carry reExportedFrom.
    const helper = result.facts.exports.find((e) => e.name === "helper")!;
    assert.equal(helper.reExportedFrom, "./util");
    assert.equal(helper.kind, "unknown");

    const star = result.facts.exports.find((e) => e.name === "*")!;
    assert.equal(star.reExportedFrom, "./star");

    const starNs = result.facts.exports.find((e) => e.name === "starNs")!;
    assert.equal(starNs.reExportedFrom, "./star");

    const typeRe = result.facts.exports.find((e) => e.name === "T")!;
    assert.equal(typeRe.isTypeOnly, true);

    // Non-relative re-export: kept as export, excluded from imports.
    const deep = result.facts.exports.find((e) => e.name === "deep")!;
    assert.equal(deep.reExportedFrom, "some-package");
    assert.ok(!result.facts.imports.some((i) => i.source === "some-package"));
  });
});

// ---------------------------------------------------------------------------
// parseSource — exports
// ---------------------------------------------------------------------------

describe("parseSource — exports", () => {
  it("detects named, default, and type-only exports with kinds and lines", () => {
    const code = [
      "export function foo(a: number): string { return 'x'; }",
      "export class Bar { m() {} }",
      "export const baz = 42;",
      "export let counter = 0;",
      "export var legacy = 1;",
      "export type Alias = string;",
      "export interface IFace { x: number; }",
      "export enum Color { Red, Green }",
      "export default function main() {}",
      "",
    ].join("\n");

    const result = parseSource("src/mod.ts", code);
    assert.ok(result.ok, `should parse: ${result.error}`);

    const byName = new Map(result.facts.exports.map((e) => [e.name, e]));

    assert.equal(byName.get("foo")!.kind, "function");
    assert.equal(byName.get("Bar")!.kind, "class");
    assert.equal(byName.get("baz")!.kind, "const");
    assert.equal(byName.get("counter")!.kind, "let");
    assert.equal(byName.get("legacy")!.kind, "var");
    assert.equal(byName.get("Alias")!.kind, "type");
    assert.equal(byName.get("Alias")!.isTypeOnly, true);
    assert.equal(byName.get("IFace")!.kind, "interface");
    assert.equal(byName.get("IFace")!.isTypeOnly, true);
    assert.equal(byName.get("Color")!.kind, "enum");
    assert.equal(byName.get("default")!.kind, "function");

    for (const ex of result.facts.exports) {
      assert.ok(ex.line && ex.line >= 1, `export ${ex.name} should have a line`);
    }
  });

  it("resolves export specifier lists against local declarations regardless of order", () => {
    const code = [
      "export { later, earlier, aliased as alias };",
      "function later() {}",
      "const earlier = 1;",
      "const aliased = 2;",
      "",
    ].join("\n");

    const result = parseSource("src/mod.ts", code);
    assert.ok(result.ok);

    const byName = new Map(result.facts.exports.map((e) => [e.name, e]));

    // Declared AFTER the export list — still resolved (two-pass indexing).
    assert.equal(byName.get("later")!.kind, "function");
    assert.equal(byName.get("earlier")!.kind, "const");
    // `aliased as alias` exports the alias name.
    assert.ok(byName.has("alias"));
    assert.ok(!byName.has("aliased"));
  });

  it("handles default exports of expressions and identifiers", () => {
    const code = [
      "const config = { a: 1 };",
      "export default config;",
      "",
    ].join("\n");

    const result = parseSource("src/mod.ts", code);
    assert.ok(result.ok);

    const def = result.facts.exports.find((e) => e.name === "default")!;
    assert.equal(def.kind, "const"); // resolved via declaration index
  });
});

// ---------------------------------------------------------------------------
// parseSource — route detection
// ---------------------------------------------------------------------------

describe("parseSource — Express routes", () => {
  it("detects app/router routes with path literals", () => {
    const code = [
      'const app = {};',
      'const router = {};',
      'const handler = () => {};',
      "",
      'app.get("/users", handler);',
      'app.post("/users/:id", handler);',
      'router.put("/items/:id", handler);',
      'router.patch("/items", handler);',
      'app.delete("/users/:id", handler);',
      'router.use("/api", handler);',
      'app.all("/anything", handler);',
      "",
    ].join("\n");

    const result = parseSource("src/routes.ts", code);
    assert.ok(result.ok, `should parse: ${result.error}`);

    const keys = result.facts.routes.map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(keys.sort(), [
      "ALL /anything",
      "DELETE /users/:id",
      "GET /users",
      "PATCH /items",
      "POST /users/:id",
      "PUT /items/:id",
      "USE /api",
    ]);
    assert.equal(result.facts.routes[0].framework, "express");
    for (const r of result.facts.routes) {
      assert.ok(r.line >= 1);
    }
  });

  it("rejects lookalike calls without a path or with a single argument", () => {
    const code = [
      'const map = new Map();',
      'map.get("key");',                        // single arg: not a route
      'const app = {};',
      'app.use(express.json());',               // no path literal
      'const handler = () => {};',
      'app.get(dynamicPath(), handler);',      // non-literal path
      "",
    ].join("\n");

    const result = parseSource("src/routes.ts", code);
    assert.ok(result.ok);
    assert.equal(result.facts.routes.length, 0);
  });
});

describe("parseSource — React Router routes", () => {
  it("detects <Route path=...> JSX elements", () => {
    const code = [
      'import { Route } from "react-router-dom";',
      "",
      "export const App = () => (",
      "  <div>",
      '    <Route path="/home" element={null} />',
      '    <Route path="/users/:id" element={null} />',
      "    <Route element={null} />",           // no path: not recorded
      "  </div>",
      ");",
      "",
    ].join("\n");

    const result = parseSource("src/App.tsx", code);
    assert.ok(result.ok, `should parse: ${result.error}`);

    const paths = result.facts.routes.map((r) => r.path);
    assert.deepEqual(paths, ["/home", "/users/:id"]);
    assert.equal(result.facts.routes[0].method, "ROUTE");
    assert.equal(result.facts.routes[0].framework, "react-router");
  });

  it("detects createBrowserRouter route config objects including nested children", () => {
    const code = [
      'import { createBrowserRouter } from "react-router-dom";',
      "",
      "export const router = createBrowserRouter([",
      '  { path: "/", element: null },',
      '  { path: "/users/:id", element: null, children: [',
      '    { path: "posts", element: null },',
      "  ]},",
      "]);",
      "",
    ].join("\n");

    const result = parseSource("src/router.tsx", code);
    assert.ok(result.ok);

    const paths = result.facts.routes.map((r) => r.path);
    assert.deepEqual(paths, ["/", "/users/:id", "posts"]);
    for (const r of result.facts.routes) {
      assert.equal(r.framework, "react-router");
      assert.ok(r.line >= 1);
    }
  });
});

// ---------------------------------------------------------------------------
// parseSource — robustness
// ---------------------------------------------------------------------------

describe("parseSource — robustness", () => {
  it("reports syntax errors without throwing", () => {
    const broken = "export const = ;\nfunction ( {}\n";
    const result = parseSource("src/broken.ts", broken);
    assert.equal(result.ok, false);
    assert.ok(result.error!.startsWith("Syntax error at line"));
    assert.deepEqual(result.facts.exports, []);
  });

  it("handles empty content", () => {
    const result = parseSource("src/empty.ts", "");
    assert.ok(result.ok);
    assert.equal(result.facts.exports.length, 0);
    assert.equal(result.facts.imports.length, 0);
  });
});

// ---------------------------------------------------------------------------
// resolveImport
// ---------------------------------------------------------------------------

describe("resolveImport", () => {
  const tree = new Set([
    "src/a/mod.ts",
    "src/a/mod.tsx",
    "src/a/exact.js",
    "src/a/dashed.d.ts",
    "src/util/index.ts",
    "src/idx/thing/index.tsx",
    "src/typed/impl.ts",
    "src/plain/worker.mjs",
  ]);

  it("resolves extension candidates in TS-first order", () => {
    assert.equal(resolveImport("src/a/app.ts", "./mod", tree), "src/a/mod.ts");
    assert.equal(resolveImport("src/a/app.ts", "./exact.js", tree), "src/a/exact.js");
  });

  it("resolves index files", () => {
    assert.equal(resolveImport("src/app.ts", "./util", tree), "src/util/index.ts");
    assert.equal(resolveImport("src/other.ts", "./idx/thing", tree), "src/idx/thing/index.tsx");
  });

  it("maps .js specifiers to .ts siblings (TS ESM style)", () => {
    // From src/a/app.ts, "../typed/impl.js" -> src/typed/impl.ts
    assert.equal(resolveImport("src/a/app.ts", "../typed/impl.js", tree), "src/typed/impl.ts");
  });

  it("resolves parent-relative specifiers", () => {
    assert.equal(resolveImport("src/a/app.ts", "../util", tree), "src/util/index.ts");
  });

  it("returns null for unresolved specifiers", () => {
    assert.equal(resolveImport("src/a/app.ts", "./missing", tree), null);
    assert.equal(resolveImport("src/a/app.ts", "../nowhere", tree), null);
  });

  it("returns null for non-relative specifiers and empty trees", () => {
    assert.equal(resolveImport("src/a/app.ts", "lodash", tree), null);
    assert.equal(resolveImport("src/a/app.ts", "./mod", new Set()), null);
  });
});

// ---------------------------------------------------------------------------
// analyzer — AST integration with injected sources
// ---------------------------------------------------------------------------

function makeDiff(files: Array<{ path: string; status: FileStatus; oldPath?: string }>): GitDiffStats {
  const diffFiles: GitDiffFile[] = files;
  return { files: diffFiles, additions: 0, deletions: 0 };
}

function makeSource(path: string, base: string | null, head: string | null, extra: Partial<FileSource> = {}): FileSource {
  return { path, base, head, ...extra };
}

describe("analyze — AST facts (injected sources)", () => {
  const headTree = new Set(["src/app.ts", "src/util.ts", "src/dep.ts"]);

  it("populates exports, routes, and resolved dependencies for an added file", () => {
    const code = [
      'import { helper } from "./util";',
      'import { missing } from "./nope";',
      "const r = {} as any;",
      'export function run(): number { return 1; }',
      'r.get("/health", () => 1);',
      "",
    ].join("\n");

    const result = analyze({
      diff: makeDiff([{ path: "src/app.ts", status: "added" }]),
      sources: new Map([["src/app.ts", makeSource("src/app.ts", null, code)]]),
      trees: { base: new Set(), head: headTree },
    });

    const file = result.files[0];
    assert.equal(file.status, "added");

    // Exports from head content.
    assert.deepEqual(file.exports.map((e) => e.name), ["run"]);

    // Route detected + route finding (added routes).
    assert.deepEqual(file.routes.map((r) => `${r.method} ${r.path}`), ["GET /health"]);
    assert.ok(file.findings.some((f) => f.id === "route-file-changed"));

    // Resolved dependency edge; unresolved import reported explicitly.
    assert.deepEqual(file.dependsOn, ["src/util.ts"]);
    assert.ok(result.dependencyGraph.some(
      (e) => e.source === "src/app.ts" && e.target === "src/util.ts",
    ));
    const unresolved = result.errors.find((e) => e.code === "UNRESOLVED_IMPORT");
    assert.ok(unresolved, "should report unresolved import");
    assert.ok(unresolved!.message.includes("./nope"));

    // resolvedPath is explicit: string for resolved, null for unresolved.
    const utilImp = file.imports.find((i) => i.source === "./util")!;
    assert.equal(utilImp.resolvedPath, "src/util.ts");
    const missingImp = file.imports.find((i) => i.source === "./nope")!;
    assert.equal(missingImp.resolvedPath, null);
  });

  it("detects export signature changes and removals for modified files", () => {
    const baseCode = [
      "export function greet(name: string): string { return name; }",
      "export function stable(): void {}",
      "export function removed(): void {}",
      "",
    ].join("\n");
    const headCode = [
      "export function greet(name: string, greeting: string): string { return name; }",
      "export function stable(): void {}",
      "export function added(): void {}",
      "",
    ].join("\n");

    const result = analyze({
      diff: makeDiff([{ path: "src/app.ts", status: "modified" }]),
      sources: new Map([["src/app.ts", makeSource("src/app.ts", baseCode, headCode)]]),
      trees: { base: new Set(), head: headTree },
    });

    const file = result.files[0];
    const byName = new Map(file.exports.map((e) => [e.name, e]));

    assert.equal(byName.get("greet")!.signatureChanged, true);
    assert.equal(byName.get("stable")!.signatureChanged, false);
    assert.equal(byName.get("added")!.signatureChanged, false);
    assert.ok(!byName.has("removed"));

    const exportFinding = file.findings.find((f) => f.id === "export-signature-changed");
    assert.ok(exportFinding, "should emit export change finding");
    const evidenceText = exportFinding!.evidence.map((e) => e.description).join(" ");
    assert.ok(evidenceText.includes('"greet"'), "should cite changed export");
    assert.ok(evidenceText.includes('"removed"'), "should cite removed export");

    // Verified evidence → contributes to the score.
    assert.ok(result.summary.riskScore.value >= 20);
  });

  it("does not flag export changes when only formatting differs", () => {
    const baseCode = "export    function   same ( )   {   }\n";
    const headCode = "export function same() {}\n";

    const result = analyze({
      diff: makeDiff([{ path: "src/app.ts", status: "modified" }]),
      sources: new Map([["src/app.ts", makeSource("src/app.ts", baseCode, headCode)]]),
      trees: { base: new Set(), head: headTree },
    });

    const file = result.files[0];
    assert.equal(file.exports[0].signatureChanged, false);
    assert.ok(!file.findings.some((f) => f.id === "export-signature-changed"));
  });

  it("preserves base-version facts for deleted files and flags removed routes", () => {
    const baseCode = [
      'import { helper } from "./util";',
      "export function gone(): void {}",
      'const r = {} as any;',
      'r.get("/users", () => 1);',
      "",
    ].join("\n");

    const baseTree = new Set(["src/app.ts", "src/util.ts"]);

    const result = analyze({
      diff: makeDiff([{ path: "src/app.ts", status: "deleted" }]),
      sources: new Map([["src/app.ts", makeSource("src/app.ts", baseCode, null)]]),
      trees: { base: baseTree, head: new Set() },
    });

    const file = result.files[0];
    assert.equal(file.status, "deleted");

    // Base-version facts preserved.
    assert.deepEqual(file.exports.map((e) => e.name), ["gone"]);
    assert.deepEqual(file.routes.map((r) => r.path), ["/users"]);
    // Deleted file's imports resolve against the BASE tree.
    assert.deepEqual(file.dependsOn, ["src/util.ts"]);

    // Findings: file-deleted (git) + route removal (ast).
    assert.ok(file.findings.some((f) => f.id === "file-deleted"));
    const routeFinding = file.findings.find((f) => f.id === "route-file-changed");
    assert.ok(routeFinding, "removed routes should be flagged");
    assert.ok(routeFinding!.evidence.some((e) => e.description.includes("Route removed")));
    // No false "export changed" finding: nothing to compare against.
    assert.ok(!file.findings.some((f) => f.id === "export-signature-changed"));
  });

  it("compares base(old) against head(new) for renamed files", () => {
    const oldCode = "export function api(): void {}\n";
    const newCode = "export function api(mode: string): void {}\nexport const VERSION = 2;\n";

    const result = analyze({
      diff: makeDiff([{ path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" }]),
      sources: new Map([["src/new.ts", makeSource("src/new.ts", oldCode, newCode)]]),
      trees: { base: new Set(["src/old.ts"]), head: new Set(["src/new.ts"]) },
    });

    const file = result.files[0];
    assert.equal(file.status, "renamed");
    assert.equal(file.oldPath, "src/old.ts");

    const byName = new Map(file.exports.map((e) => [e.name, e]));
    assert.equal(byName.get("api")!.signatureChanged, true);
    assert.equal(byName.get("VERSION")!.signatureChanged, false);

    assert.ok(file.findings.some((f) => f.id === "file-renamed"));
    assert.ok(file.findings.some((f) => f.id === "export-signature-changed"));
  });

  it("isolates parse failures to the broken file", () => {
    const broken = "export const = ;\n";
    const good = 'import { helper } from "./dep";\nexport function ok(): void {}\n';

    const result = analyze({
      diff: makeDiff([
        { path: "src/broken.ts", status: "modified" },
        { path: "src/good.ts", status: "modified" },
      ]),
      sources: new Map([
        ["src/broken.ts", makeSource("src/broken.ts", "export const old = 1;\n", broken)],
        ["src/good.ts", makeSource("src/good.ts", "export function ok2(): void {}\n", good)],
      ]),
      trees: { base: new Set(["src/broken.ts", "src/good.ts"]), head: headTree },
    });

    // Broken file: PARSE_ERROR, no invented facts.
    const parseError = result.errors.find(
      (e) => e.file === "src/broken.ts" && e.code === "PARSE_ERROR",
    );
    assert.ok(parseError, "should report PARSE_ERROR for broken file");
    const brokenFile = result.files.find((f) => f.path === "src/broken.ts")!;
    assert.deepEqual(brokenFile.exports, []);
    assert.deepEqual(brokenFile.imports, []);

    // Good file: fully analyzed, unaffected.
    const goodFile = result.files.find((f) => f.path === "src/good.ts")!;
    assert.deepEqual(goodFile.exports.map((e) => e.name), ["ok"]);
    assert.deepEqual(goodFile.dependsOn, ["src/dep.ts"]);

    // No crash: response still valid.
    assert.equal(result.files.length, 2);
  });

  it("reports binary, too-large, and read-failure sources explicitly", () => {
    const result = analyze({
      diff: makeDiff([
        { path: "src/bin.ts", status: "modified" },
        { path: "src/huge.ts", status: "modified" },
        { path: "src/failed.ts", status: "modified" },
      ]),
      sources: new Map([
        ["src/bin.ts", makeSource("src/bin.ts", null, null, { binary: true })],
        ["src/huge.ts", makeSource("src/huge.ts", null, null, { tooLarge: true })],
        ["src/failed.ts", makeSource("src/failed.ts", null, null, { readError: "git boom" })],
      ]),
      trees: { base: new Set(), head: headTree },
    });

    const codes = result.errors.map((e) => `${e.file}:${e.code}`);
    assert.ok(codes.includes("src/bin.ts:UNSUPPORTED_FORMAT"));
    assert.ok(codes.includes("src/huge.ts:FILE_TOO_LARGE"));
    assert.ok(codes.includes("src/failed.ts:IO_ERROR"));

    // None of them invented facts.
    for (const f of result.files) {
      assert.deepEqual(f.exports, []);
      assert.deepEqual(f.imports, []);
    }
  });

  it("does not flag routes when only handler internals change", () => {
    const baseCode = 'r.get("/users", () => 1);\nconst r = {} as any;\nexport const a = 1;\n';
    const headCode = 'r.get("/users", () => 2);\nconst r = {} as any;\nexport const a = 2;\n';

    const result = analyze({
      diff: makeDiff([{ path: "src/app.ts", status: "modified" }]),
      sources: new Map([["src/app.ts", makeSource("src/app.ts", baseCode, headCode)]]),
      trees: { base: new Set(), head: headTree },
    });

    const file = result.files[0];
    assert.ok(!file.findings.some((f) => f.id === "route-file-changed"),
      "identical route set must not fire route finding");
    // But the export change is still detected.
    assert.ok(file.findings.some((f) => f.id === "export-signature-changed"));
  });

  it("skips import resolution when no tree data is available", () => {
    const code = 'import { helper } from "./util";\nexport const a = 1;\n';

    const result = analyze({
      diff: makeDiff([{ path: "src/app.ts", status: "added" }]),
      sources: new Map([["src/app.ts", makeSource("src/app.ts", null, code)]]),
      trees: {}, // no tree data (fetch failed)
    });

    const file = result.files[0];
    assert.equal(file.imports[0].resolvedPath, undefined); // not attempted
    assert.deepEqual(file.dependsOn, []);
    assert.ok(!result.errors.some((e) => e.code === "UNRESOLVED_IMPORT"));
  });

  it("response keeps the documented schema with AST facts", () => {
    const result: AnalyzeResponse = analyze({
      diff: makeDiff([{ path: "src/app.ts", status: "added" }]),
      sources: new Map([["src/app.ts", makeSource("src/app.ts", null, "export const a = 1;\n")]]),
      trees: { base: new Set(), head: headTree },
    });

    assert.ok("summary" in result);
    assert.ok("files" in result);
    assert.ok("dependencyGraph" in result);
    assert.ok("recommendations" in result);
    assert.ok("errors" in result);
    assert.equal(result.summary.testsRecommended, 0);
    assert.deepEqual(result.recommendations, []);
  });
});