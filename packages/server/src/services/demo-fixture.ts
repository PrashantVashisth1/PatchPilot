// ---------------------------------------------------------------------------
// PatchPilot — Demo Fixture Provisioner
//
// Dynamically provisions a real, isolated temporary Git repository fixture
// with two committed revisions to demonstrate export signature changes,
// downstream consumer propagation, routing additions, and test matching.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

export function ensureDemoFixture(): { repoPath: string; baseRef: string; headRef: string } {
  const repoDir = join(tmpdir(), "patchpilot-fixture-demo");

  // If already initialized as a valid git repo with commits, return it directly
  if (existsSync(join(repoDir, ".git"))) {
    try {
      execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: repoDir, stdio: "ignore" });
      return { repoPath: repoDir, baseRef: "HEAD~1", headRef: "HEAD" };
    } catch {
      // Re-provision if corrupt or incomplete
    }
  }

  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "demo@patchpilot.dev"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "PatchPilot Demo"], { cwd: repoDir, stdio: "ignore" });

  mkdirSync(join(repoDir, "src", "utils"), { recursive: true });
  mkdirSync(join(repoDir, "src", "services"), { recursive: true });
  mkdirSync(join(repoDir, "src", "routes"), { recursive: true });
  mkdirSync(join(repoDir, "tests"), { recursive: true });

  // Base Revision:
  writeFileSync(
    join(repoDir, "src", "utils", "pricing.ts"),
    `export function calculateDiscount(price: number): number {\n  return price * 0.1;\n}\n`
  );

  writeFileSync(
    join(repoDir, "src", "services", "order.ts"),
    `import { calculateDiscount } from "../utils/pricing.js";\n\nexport function createOrder(price: number) {\n  const discount = calculateDiscount(price);\n  return { price, total: price - discount };\n}\n`
  );

  writeFileSync(
    join(repoDir, "src", "routes", "orderRoute.ts"),
    `import { Router } from "express";\nimport { createOrder } from "../services/order.js";\n\nconst router = Router();\nrouter.post("/orders", (req, res) => {\n  res.json(createOrder(100));\n});\nexport default router;\n`
  );

  writeFileSync(
    join(repoDir, "tests", "order.test.ts"),
    `import { createOrder } from "../src/services/order.js";\n\n// Test suite covering orders\n`
  );

  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: repoDir, stdio: "ignore" });

  // Head Revision:
  writeFileSync(
    join(repoDir, "src", "utils", "pricing.ts"),
    `export function calculateDiscount(price: number, tier: string = "standard"): number {\n  return tier === "vip" ? price * 0.2 : price * 0.1;\n}\n`
  );

  writeFileSync(
    join(repoDir, "src", "routes", "orderRoute.ts"),
    `import { Router } from "express";\nimport { createOrder } from "../services/order.js";\n\nconst router = Router();\nrouter.post("/orders", (req, res) => {\n  res.json(createOrder(100));\n});\nrouter.get("/orders/:id", (req, res) => {\n  res.json({ id: req.params.id });\n});\nexport default router;\n`
  );

  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "update pricing signature and order routes"], { cwd: repoDir, stdio: "ignore" });

  return {
    repoPath: repoDir,
    baseRef: "HEAD~1",
    headRef: "HEAD",
  };
}
