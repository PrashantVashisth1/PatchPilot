# PatchPilot

> **Evidence-Backed Change-Risk Intelligence for Pull Requests & Code Reviews**  
> *Built for the OpenFire Hackathon*

PatchPilot is an open-source, local-first developer tool that analyzes Git changes, identifies regression risks through in-memory TypeScript AST parsing, maps affected downstream consumer modules, and recommends targeted test suites with verifiable evidence.

---

## ⚡ The Problem

Modern code reviews frequently overlook subtle regression risks:
- Changing a shared function signature without noticing downstream consumers in other modules.
- Mutating internal API routes or handlers that break frontend consumers or webhooks.
- Merging PRs without running the specific test suites that actually exercise the altered code paths.

**PatchPilot solves this without executing repository code or sending proprietary code to third parties.** It provides an evidence-backed review report separating **verified facts** (deterministic AST and diff observations) from **inferred risks** (heuristic downstream blast radius).

---

## 🏗️ Architecture & Pipeline

PatchPilot is organized as an npm workspaces monorepo:

```
patchpilot/
├── packages/
│   ├── shared/              # Shared types, risk model, and API schemas
│   │   └── src/
│   │       ├── types.ts      # Strict TypeScript contracts (AnalyzeResponse, Finding, etc.)
│   │       └── risk-model.ts # Transparent finding templates and scoring caps
│   ├── server/              # Node.js + Express + TypeScript static analysis engine
│   │   └── src/
│   │       ├── app.ts        # Express app configuration & middleware
│   │       ├── index.ts      # HTTP server listener (port 3001)
│   │       ├── services/
│   │       │   └── git.service.ts   # Safe Git subprocess diff, numstat, and tree reader
│   │       ├── engine/
│   │       │   ├── ast-parser.ts    # TypeScript Compiler API AST extractor
│   │       │   ├── resolve.ts       # Conservative relative import resolution
│   │       │   ├── graph.ts         # Cycle-safe repository-wide reverse dependency DAG
│   │       │   ├── test-discovery.ts# 5-tier evidence-based test ranking
│   │       │   ├── source-reader.ts # Multi-revision concurrent source reader
│   │       │   └── analyzer.ts      # Core orchestration & risk score synthesis
│   │       └── routes/
│   │           └── analyze.ts       # POST /api/analyze with Zod validation
│   └── client/              # React 18 + TypeScript + Vite frontend
│       └── src/
│           ├── App.tsx              # Application shell & cold-start onboarding
│           ├── components/
│           │   ├── icons.tsx        # Bespoke high-precision SVG icon library
│           │   ├── RepoInput.tsx    # Command bar with presets & security guarantee
│           │   ├── RiskReport.tsx   # Tabbed report dashboard with comparison header
│           │   ├── RiskSummary.tsx  # Segmented meter & dual-column findings
│           │   ├── ChangedFilesView.tsx    # Filterable files list with AST exports & routes
│           │   ├── ImpactAnalysisView.tsx  # Downstream blast-radius tree & propagation paths
│           │   ├── TestRecommendationsView.tsx # Ranked test suites with command copy & checklists
│           │   └── DependencyGraphView.tsx # Directional import/consumer dependency surface
│           ├── hooks/
│           │   └── useAnalysis.ts   # React hook managing analysis flow & structured errors
│           └── index.css            # Dark-mode design system with Linear/Stripe polish
├── package.json             # Root npm workspaces
└── tsconfig.base.json       # Base TypeScript compiler settings
```

### The 4-Stage Analysis Pipeline

1. **Git Bounded Diff Extraction**:  
   Runs non-shell `git diff` and `git diff --numstat` between the base ref (`main`, `HEAD~1`, etc.) and head ref (`HEAD`). Safely resolves paths against the repository root without executing shell interpolation.
2. **AST Parsing & Export Comparison**:  
   Fetches file content at both revisions concurrently via `git show <ref>:<path>`. Uses the **TypeScript Compiler API** (`ts.createSourceFile`) to extract named exports, export kinds, signature changes, routing definitions (Express & React Router), and relative imports.
3. **Repository-Wide Reverse Dependency DAG**:  
   Constructs an import graph of all TypeScript/JavaScript files in the repository. Performs cycle-safe Breadth-First Search (BFS) to map every direct (depth 1) and transitive (depth 2+) consumer that imports the changed modules.
4. **Evidence-Backed Risk Scoring**:  
   Calculates an explainable 0–100 regression risk score where:
   - **Verified Facts** (100% confidence): Changed export signatures, deleted/renamed files, configuration changes, and large diff sizes.
   - **Inferred Risks** (capped at 40% of total): Downstream blast radius, modified routing files, or missing test coverage.

---

## 🔒 Security & Local-First Principles

- **Zero Arbitrary Execution**: PatchPilot never runs `npm install`, executes `package.json` scripts, or runs repository tests.
- **Subprocess Safety**: All Git commands execute via `execFile` argument arrays. User input is never passed to a shell.
- **Path Traversal Protection**: Inputs are resolved against the verified Git root; non-existent paths, non-git directories, and symlink escapes are rejected.
- **Resource Quotas**: Strict limits on max diff size, parse duration, graph depth, and consumer counts prevent ReDoS or memory exhaustion on large repositories.

---

## 🚀 Quickstart

### Prerequisites

- Node.js 20+ (Node.js 22 LTS recommended)
- Git 2.30+ installed in system PATH

### Installation & Build

```bash
# Clone the repository
git clone https://github.com/PrashantVashisth1/PatchPilot.git
cd PatchPilot

# Install monorepo dependencies
npm install

# Typecheck all workspaces (shared, server, client)
npm run typecheck

# Run server automated test suite (89 tests across 22 suites)
npm run test -w packages/server

# Build all packages for production
npm run build
```

### Running Locally

```bash
# Start backend server on http://localhost:3001
npm run server

# In a separate terminal, start frontend dev server on http://localhost:5173
npm run client
```

Open `http://localhost:5173` in your browser.

#### Instant 1-Click Demo
Click the **"Load Fixture"** button in the top command bar or hero banner. PatchPilot will automatically provision a dedicated Git repository fixture with:
- An altered export function signature (`calculateDiscount` in `src/utils/pricing.ts`).
- An Express route addition (`GET /orders/:id` in `src/routes/orderRoute.ts`).
- Downstream consumer propagation (`src/services/order.ts`).
- Ranked test discovery matching `tests/order.test.ts`.

---

## 📸 Product Interface & Visual Architecture

PatchPilot features a dark-mode engineering workspace with high-contrast typography, interactive status pills, and segmented risk meters:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  PATCHPILOT  [Local Engine: Active]                  [Load Demo Fixture] [Analyze]│
├──────────────────────────────────────────────────────────────────────────────────┤
│  Repository: %TEMP%/patchpilot-fixture-demo    Base: HEAD~1    Head: HEAD        │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [35 / 100 MEDIUM RISK]    2 Files Changed    3 Impact Edges    2 Tests Rec.    │
│  ══════════════════════════════════════════════════════════════════════════════  │
│                                                                                  │
│  [Overview]  [Changed Files (2)]  [Downstream Impact (3)]  [Test Suites (2)]     │
│                                                                                  │
│  ┌─ VERIFIED FACTS (100% Confidence) ─────────┐ ┌─ INFERRED RISKS (Heuristics) ─┐│
│  │ • Export "calculateDiscount" signature     │ │ • Route definition added      ││
│  │   changed in src/utils/pricing.ts          │ │   GET /orders/:id             ││
│  │ • 2 files modified: +5 / -2 lines          │ │ • Downstream blast radius:    ││
│  │                                            │ │   src/services/order.ts       ││
│  └────────────────────────────────────────────┘ └───────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────┘
```

> **UI Screenshots:** Screenshots for hackathon submission galleries can be captured directly from `http://localhost:5173` upon running the 1-click fixture demonstration.

---

## 📡 API Reference

### `POST /api/analyze`

**Request Body:**
```json
{
  "repoPath": "C:\\projects\\my-app",
  "baseRef": "HEAD~1",
  "headRef": "HEAD",
  "maxFiles": 500,
  "maxGraphFiles": 5000,
  "maxTransitiveDepth": 5,
  "maxConsumersPerTarget": 200
}
```

**Response (Summary):**
```json
{
  "summary": {
    "totalFilesChanged": 2,
    "errorCount": 0,
    "riskScore": {
      "value": 35,
      "label": "medium",
      "findings": [...]
    },
    "testsRecommended": 2
  },
  "files": [...],
  "dependencyGraph": [...],
  "impact": [
    {
      "consumer": "src/services/order.ts",
      "target": "src/utils/pricing.ts",
      "depth": 1,
      "relationship": "direct",
      "path": ["src/utils/pricing.ts", "src/services/order.ts"]
    }
  ],
  "impactDetails": [...],
  "scanComplete": true,
  "recommendations": [
    {
      "changedFile": "src/utils/pricing.ts",
      "recommendedTests": ["tests/order.test.ts"],
      "reason": "1 test file(s) discovered covering this change...",
      "confidence": 0.7,
      "matches": [...]
    }
  ],
  "errors": []
}
```

### `GET /api/demo-fixture`
Provisions or returns coordinates for the isolated multi-commit demo repository:
```json
{
  "repoPath": "C:\\Users\\...\\AppData\\Local\\Temp\\patchpilot-fixture-demo",
  "baseRef": "HEAD~1",
  "headRef": "HEAD"
}
```

### `GET /health`
Returns `{"status": "ok", "uptime": <seconds>}`.

---

## 🧪 Automated Tests

The test suite validates:
- Real Git repository diffs, additions, deletions, renames, and shorthand refs (`HEAD~1..HEAD`).
- Error conditions: non-absolute paths, non-git directories, invalid refs (with actionable revision guidance), empty diffs.
- TypeScript AST parsing: named exports, default exports, type-only exports, relative imports, and Express/React Router routes.
- Base/head export signature comparison and whitespace normalization.
- Repository-wide reverse dependency DAGs, cycle termination, depth boundaries, and deduplication.
- Test discovery: naming heuristics, direct imports, transitive imports, and proximity matching.

```bash
npm run test -w packages/server
# 89 tests passing across 22 suites (100% clean)
```

---

## ⚖️ Honest Limitations

1. **Relative Imports Only**: Third-party package imports (`node_modules`) are intentionally excluded; analysis focuses exclusively on workspace source relationships.
2. **Advisory Test Recommendations**: Test recommendations are statically discovered candidates. PatchPilot does not run test suites automatically, maintaining a zero-code-execution guarantee.
3. **Graph Truncation on Very Large Codebases**: In monorepos with $>5,000$ JS/TS files, graph building caps traversal at configured limits and surfaces an explicit `scanComplete: false` warning rather than guessing unverified relationships.

---

## 📄 License

MIT &bull; Open-source tool developed for the OpenFire Hackathon.
