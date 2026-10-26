// ---------------------------------------------------------------------------
// Tests: git.service.ts
// ---------------------------------------------------------------------------

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { runGitDiff, runGitNumstat } from "../services/git.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;
let fixtureCounter = 0;

function fixtureDir(name: string): string {
  const dir = join(tmpRoot, `fixture-${fixtureCounter++}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createGitRepo(dir: string): string {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@patchpilot.dev"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "PatchPilot Test"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function gitCommitAll(dir: string, message: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "pipe" });
}

function getHead(dir: string): string {
  return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "patchpilot-test-"));
});

after(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runGitDiff — happy path
// ---------------------------------------------------------------------------

describe("runGitDiff", () => {
  it("returns modified and added files between two commits", async () => {
    const repo = createGitRepo(fixtureDir("basic"));
    writeFileSync(join(repo, "a.ts"), 'export const x = 1;\n');
    writeFileSync(join(repo, "b.js"), 'module.exports = {};\n');
    gitCommitAll(repo, "first commit");
    const baseCommit = getHead(repo);

    // Make changes: modify a.ts, add c.tsx
    writeFileSync(join(repo, "a.ts"), 'export const x = 2;\nexport const y = 3;\n');
    writeFileSync(join(repo, "c.tsx"), 'const Component = () => <div/>;\n');
    gitCommitAll(repo, "second commit");

    const result = await runGitDiff({
      repoPath: repo,
      baseRef: baseCommit,
      headRef: "HEAD",
    });

    assert.equal(result.files.length, 2, "should have 2 files");

    const byPath = new Map(result.files.map((f) => [f.path, f]));

    assert.ok(byPath.has("a.ts"));
    assert.equal(byPath.get("a.ts")!.status, "modified");

    assert.ok(byPath.has("c.tsx"));
    assert.equal(byPath.get("c.tsx")!.status, "added");

    // shortstat should report non-zero lines
    assert.ok(result.additions > 0, "should have additions");
    assert.ok(result.deletions >= 0, "should have deletions");
  });

  it("detects deleted files", async () => {
    const repo = createGitRepo(fixtureDir("deleted"));
    writeFileSync(join(repo, "removed.ts"), 'export const foo = 1;\n');
    gitCommitAll(repo, "first commit");
    const baseCommit = getHead(repo);

    rmSync(join(repo, "removed.ts"));
    gitCommitAll(repo, "delete file");

    const result = await runGitDiff({
      repoPath: repo,
      baseRef: baseCommit,
      headRef: "HEAD",
    });

    const deleted = result.files.find((f) => f.path === "removed.ts");
    assert.ok(deleted, "should include deleted file");
    assert.equal(deleted!.status, "deleted");
  });

  it("handles HEAD~1..HEAD shorthand", async () => {
    const repo = createGitRepo(fixtureDir("shorthand"));
    writeFileSync(join(repo, "a.ts"), 'export const x = 1;\n');
    gitCommitAll(repo, "first commit");
    writeFileSync(join(repo, "b.ts"), 'export const y = 2;\n');
    gitCommitAll(repo, "second commit");

    const result = await runGitDiff({
      repoPath: repo,
      baseRef: "HEAD~1",
      headRef: "HEAD",
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, "b.ts");
    assert.equal(result.files[0].status, "added");
  });

  it("detects renamed files", async () => {
    const repo = createGitRepo(fixtureDir("renamed"));
    writeFileSync(join(repo, "old.ts"), 'export const a = 1;\n');
    gitCommitAll(repo, "first commit");
    const baseCommit = getHead(repo);

    // Git detects renames when you mv and commit (default similarity threshold).
    execSync("git mv old.ts new.ts", { cwd: repo, stdio: "pipe" });
    gitCommitAll(repo, "rename file");

    const result = await runGitDiff({
      repoPath: repo,
      baseRef: baseCommit,
      headRef: "HEAD",
    });

    const renamed = result.files.find((f) => f.status === "renamed");
    assert.ok(renamed, "should detect a renamed file");
    assert.ok(renamed!.oldPath, "should have oldPath");
  });
});

// ---------------------------------------------------------------------------
// runGitDiff — error paths
// ---------------------------------------------------------------------------

describe("runGitDiff errors", () => {
  it("rejects non-absolute paths", async () => {
    await assert.rejects(
      runGitDiff({ repoPath: "relative/path", baseRef: "main", headRef: "HEAD" }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 400);
        return true;
      },
      "should reject relative path",
    );
  });

  it("rejects non-existent paths", async () => {
    const nonExistent = resolve(tmpdir(), "definitely-does-not-exist-xyz");
    await assert.rejects(
      runGitDiff({ repoPath: nonExistent, baseRef: "main", headRef: "HEAD" }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 422);
        assert.equal((err as any).code, "REPO_NOT_FOUND");
        return true;
      },
      "should reject non-existent path",
    );
  });

  it("rejects non-git directories", async () => {
    const dir = fixtureDir("not-a-repo");
    // Directory exists but is not a git repo
    await assert.rejects(
      runGitDiff({ repoPath: dir, baseRef: "main", headRef: "HEAD" }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 422);
        assert.equal((err as any).code, "NOT_GIT_REPO");
        return true;
      },
      "should reject non-git directory",
    );
  });

  it("rejects invalid refs", async () => {
    const repo = createGitRepo(fixtureDir("invalid-ref"));
    writeFileSync(join(repo, "file.txt"), "hello");
    gitCommitAll(repo, "initial");

    await assert.rejects(
      runGitDiff({ repoPath: repo, baseRef: "nonexistent-branch", headRef: "HEAD" }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 422);
        assert.equal((err as any).code, "GIT_ERROR");
        assert.match(err.message, /Git ref "nonexistent-branch" does not exist in this repository/i);
        return true;
      },
      "should reject invalid refs",
    );
  });

  it("returns EMPTY_DIFF when refs point to the same commit", async () => {
    const repo = createGitRepo(fixtureDir("empty-diff"));
    writeFileSync(join(repo, "file.txt"), "hello");
    gitCommitAll(repo, "only commit");
    const head = getHead(repo);

    await assert.rejects(
      runGitDiff({ repoPath: repo, baseRef: head, headRef: head }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 422);
        assert.equal((err as any).code, "EMPTY_DIFF");
        return true;
      },
      "should return EMPTY_DIFF for same refs",
    );
  });
});

// ---------------------------------------------------------------------------
// runGitNumstat
// ---------------------------------------------------------------------------

describe("runGitNumstat", () => {
  it("returns per-file line stats", async () => {
    const repo = createGitRepo(fixtureDir("numstat"));
    writeFileSync(join(repo, "a.ts"), 'export const x = 1;\n');
    gitCommitAll(repo, "first commit");
    const baseCommit = getHead(repo);

    writeFileSync(join(repo, "a.ts"), 'export const x = 2;\nexport const y = 3;\nexport const z = 4;\n');
    gitCommitAll(repo, "second commit");

    const stats = await runGitNumstat(repo, baseCommit, "HEAD");
    const fileStats = stats.get("a.ts");
    assert.ok(fileStats, "should have stats for a.ts");
    assert.ok(fileStats!.additions > 0, "should have additions");
  });

  it("returns empty map for invalid repo", async () => {
    const stats = await runGitNumstat(
      resolve(tmpdir(), "nonexistent-xyz-repo"),
      "main",
      "HEAD",
    );
    assert.equal(stats.size, 0, "should return empty map on error");
  });
});