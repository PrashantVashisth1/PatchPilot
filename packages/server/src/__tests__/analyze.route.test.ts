// ---------------------------------------------------------------------------
// Tests: POST /api/analyze route integration
// ---------------------------------------------------------------------------

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import app from "../app.js";
import type { AnalyzeResponse } from "@patchpilot/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;
let server: Server;
let baseUrl: string;

function fixtureRepo(name: string): string {
  const dir = join(tmpRoot, `fixture-${name}`);
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@patchpilot.dev"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "PatchPilot"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function gitCommitAll(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: "pipe" });
}

function getHead(dir: string): string {
  return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
}

async function postAnalyze(
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "patchpilot-route-test-"));

  // Start server on a random port
  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal((data as any).status, "ok");
  });
});

describe("GET /api/demo-fixture", () => {
  it("provisions and returns the demo fixture repository coordinates", async () => {
    const res = await fetch(`${baseUrl}/api/demo-fixture`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.ok(data.repoPath, "should return a valid repoPath");
    assert.equal(data.baseRef, "HEAD~1");
    assert.equal(data.headRef, "HEAD");
  });

  it("returns a valid Git repository capable of being analyzed without error", async () => {
    const res = await fetch(`${baseUrl}/api/demo-fixture`);
    const data = (await res.json()) as any;
    const analyze = await postAnalyze({
      repoPath: data.repoPath,
      baseRef: data.baseRef,
      headRef: data.headRef,
    });
    assert.equal(analyze.status, 200);
    assert.ok((analyze.data as any).files.length >= 2);
  });
});

// ---------------------------------------------------------------------------
// POST /api/analyze — happy path
// ---------------------------------------------------------------------------

describe("POST /api/analyze — valid input", () => {
  it("returns a report for modified and added files", async () => {
    const repo = fixtureRepo("route-basic");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/utils.ts"), 'export const x = 1;\n');
    gitCommitAll(repo, "first commit");
    const baseCommit = getHead(repo);

    writeFileSync(join(repo, "src/utils.ts"), 'export const x = 2;\nexport const y = 3;\n');
    gitCommitAll(repo, "second commit");

    const { status, data } = await postAnalyze({
      repoPath: repo,
      baseRef: baseCommit,
      headRef: "HEAD",
    });

    assert.equal(status, 200);
    const report = data as AnalyzeResponse;
    assert.ok(report.summary.totalFilesChanged > 0, "should have files");
    assert.ok("riskScore" in report.summary);
  });

  it("returns a report for a deleted file", async () => {
    const repo = fixtureRepo("route-deleted");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/old.ts"), 'export const gone = true;\n');
    gitCommitAll(repo, "first");
    const baseCommit = getHead(repo);

    rmSync(join(repo, "src/old.ts"));
    gitCommitAll(repo, "delete");

    const { status, data } = await postAnalyze({
      repoPath: repo,
      baseRef: baseCommit,
      headRef: "HEAD",
    });

    assert.equal(status, 200);
    const report = data as AnalyzeResponse;
    const deleted = report.files.find((f) => f.status === "deleted");
    assert.ok(deleted, "should have deleted file");
    assert.ok(report.summary.riskScore.value > 0, "deletion should increase risk");
  });
});

// ---------------------------------------------------------------------------
// POST /api/analyze — AST facts (Step 3)
// ---------------------------------------------------------------------------

describe("POST /api/analyze — AST facts", () => {
  it("returns routes, resolved imports, and export changes for changed source files", async () => {
    const repo = fixtureRepo("route-ast");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "util.ts"), "export function helper(): number { return 1; }\n");
    writeFileSync(join(repo, "src", "routes.ts"), [
      'import { helper } from "./util";',
      "declare const router: { get: (p: string, h: unknown) => void; post: (p: string, h: unknown) => void; };",
      'router.get("/users", () => helper);',
      "export function listUsers(): number { return helper(); }",
      "",
    ].join("\n"));
    gitCommitAll(repo, "base");
    const base = getHead(repo);

    // head: new route + changed export signature
    writeFileSync(join(repo, "src", "routes.ts"), [
      'import { helper } from "./util";',
      "declare const router: { get: (p: string, h: unknown) => void; post: (p: string, h: unknown) => void; };",
      'router.get("/users", () => helper);',
      'router.post("/users/:id", () => helper);',
      "export function listUsers(extra: string): number { return helper(); }",
      "",
    ].join("\n"));
    gitCommitAll(repo, "head");

    const { status, data } = await postAnalyze({ repoPath: repo, baseRef: base, headRef: "HEAD" });
    assert.equal(status, 200);
    const report = data as AnalyzeResponse;

    const routesFile = report.files.find((f) => f.path === "src/routes.ts");
    assert.ok(routesFile, "routes.ts should be in the report");

    // Routes detected at head revision.
    const routeKeys = routesFile.routes.map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(routeKeys, ["GET /users", "POST /users/:id"]);

    // Relative import resolved against the head tree.
    assert.deepEqual(routesFile.dependsOn, ["src/util.ts"]);
    assert.ok(report.dependencyGraph.some(
      (e) => e.source === "src/routes.ts" && e.target === "src/util.ts",
    ));

    // Export signature change detected between base and head.
    assert.ok(routesFile.exports.some((e) => e.name === "listUsers" && e.signatureChanged));

    // Evidence-backed findings: route change (inferred) + export change (verified).
    const findingIds = routesFile.findings.map((f) => f.id);
    assert.ok(findingIds.includes("route-file-changed"));
    assert.ok(findingIds.includes("export-signature-changed"));
  });

  it("analyzes committed revisions, never the working tree", async () => {
    const repo = fixtureRepo("route-revision");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
    gitCommitAll(repo, "base");
    const base = getHead(repo);

    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
    gitCommitAll(repo, "head");

    // Uncommitted working-tree change: must NOT appear in the analysis.
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 3;\nexport const UNCOMMITTED = true;\n");

    const { status, data } = await postAnalyze({ repoPath: repo, baseRef: base, headRef: "HEAD" });
    assert.equal(status, 200);
    const report = data as AnalyzeResponse;

    const fileA = report.files.find((f) => f.path === "src/a.ts");
    assert.ok(fileA, "src/a.ts should be in the report");

    const names = fileA.exports.map((e) => e.name);
    assert.ok(names.includes("a"));
    assert.ok(!names.includes("UNCOMMITTED"), "working-tree export must not leak into analysis");

    // Committed head (a = 2) differs from base (a = 1).
    assert.ok(fileA.exports.some((e) => e.name === "a" && e.signatureChanged));
  });
});

// ---------------------------------------------------------------------------
// POST /api/analyze — error handling
// ---------------------------------------------------------------------------

describe("POST /api/analyze — error cases", () => {
  it("returns 400 for missing repoPath", async () => {
    const { status, data } = await postAnalyze({ baseRef: "main" });
    assert.equal(status, 400);
    assert.ok((data as any).error);
  });

  it("returns 400 for empty repoPath", async () => {
    const { status, data } = await postAnalyze({ repoPath: "", baseRef: "main" });
    assert.equal(status, 400);
  });

  it("returns 400 for relative repoPath", async () => {
    const { status, data } = await postAnalyze({
      repoPath: "relative/path",
      baseRef: "main",
    });
    assert.equal(status, 400);
  });

  it("returns 422 for non-existent path", async () => {
    const { status, data } = await postAnalyze({
      repoPath: join(tmpRoot, "does-not-exist"),
      baseRef: "main",
    });
    assert.equal(status, 422);
    assert.equal((data as any).error.code, "REPO_NOT_FOUND");
  });

  it("returns 422 for non-git directory", async () => {
    const dir = join(tmpRoot, "not-a-repo");
    mkdirSync(dir, { recursive: true });

    const { status, data } = await postAnalyze({
      repoPath: dir,
      baseRef: "main",
    });
    assert.equal(status, 422);
    assert.equal((data as any).error.code, "NOT_GIT_REPO");
  });

  it("returns 422 for invalid base ref", async () => {
    const repo = fixtureRepo("route-invalid-ref");
    writeFileSync(join(repo, "file.txt"), "hello");
    gitCommitAll(repo, "initial");

    const { status, data } = await postAnalyze({
      repoPath: repo,
      baseRef: "nonexistent-ref",
      headRef: "HEAD",
    });
    assert.equal(status, 422);
    assert.equal((data as any).error.code, "GIT_ERROR");
    assert.match((data as any).error.message, /Git ref "nonexistent-ref" does not exist in this repository/i);
  });

  it("returns 422 for empty diff (same refs)", async () => {
    const repo = fixtureRepo("route-empty");
    writeFileSync(join(repo, "file.txt"), "hello");
    gitCommitAll(repo, "only");
    const head = getHead(repo);

    const { status, data } = await postAnalyze({
      repoPath: repo,
      baseRef: head,
      headRef: head,
    });
    assert.equal(status, 422);
    assert.equal((data as any).error.code, "EMPTY_DIFF");
  });
});