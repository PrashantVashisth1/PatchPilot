import { useState } from "react";
import RepoInput from "./components/RepoInput";
import RiskReport from "./components/RiskReport";
import { useAnalysis } from "./hooks/useAnalysis";
import {
  IconLogo,
  IconAlertTriangle,
  IconX,
  IconCornerDownRight,
  IconFileCode,
  IconCheckCircle,
  IconShield,
  IconTerminal,
} from "./components/icons";

export default function App() {
  const [repoPath, setRepoPath] = useState("");
  const [baseRef, setBaseRef] = useState("HEAD~1");
  const [headRef, setHeadRef] = useState("HEAD");
  const { report, loading, error, run, reset } = useAnalysis();

  const handleSubmit = () => {
    run({ repoPath, baseRef, headRef });
  };

  const loadSampleFixture = async () => {
    try {
      const res = await fetch("/api/demo-fixture");
      if (res.ok) {
        const data = (await res.json()) as { repoPath: string; baseRef: string; headRef: string };
        setRepoPath(data.repoPath);
        setBaseRef(data.baseRef);
        setHeadRef(data.headRef);
        return;
      }
    } catch {
      // fallback
    }
    setRepoPath("C:\\Users\\prash\\AppData\\Local\\Temp\\patchpilot-fixture-demo");
    setBaseRef("HEAD~1");
    setHeadRef("HEAD");
  };

  return (
    <div className="app-wrapper">
      {/* Top Application Header */}
      <header className="top-nav">
        <div className="top-nav-inner">
          <div className="brand-identity">
            <div className="brand-mark">
              <IconLogo size={15} />
            </div>
            <div className="brand-title">
              <span>PatchPilot</span>
              <span className="brand-version">v0.1.0</span>
            </div>
          </div>

          <div className="nav-actions">
            <div className="status-indicator">
              <span className="status-dot" />
              <span>Local Engine Connected</span>
            </div>
            <span
              style={{
                fontSize: "0.7rem",
                color: "var(--text-tertiary)",
                border: "1px solid var(--border-subtle)",
                padding: "0.15rem 0.45rem",
                borderRadius: "var(--radius-xs)",
                fontFamily: "var(--font-mono)",
              }}
            >
              OpenFire Hackathon
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="main-content">
        {/* Repo Input Command Bar */}
        <RepoInput
          repoPath={repoPath}
          baseRef={baseRef}
          headRef={headRef}
          onRepoPathChange={setRepoPath}
          onBaseRefChange={setBaseRef}
          onHeadRefChange={setHeadRef}
          onSubmit={handleSubmit}
          disabled={loading}
        />

        {/* Actionable Error Banner */}
        {error && (
          <div className="alert-banner alert-banner-error" id="analysis-error-banner">
            <IconAlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>
                  Analysis Failed {error.code ? `(${error.code})` : ""}
                </strong>
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Dismiss error"
                >
                  <IconX size={14} />
                </button>
              </div>
              <div style={{ marginTop: "0.25rem", color: "var(--text-primary)" }}>{error.message}</div>
              {error.details != null && typeof error.details === "object" && (
                <pre
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "0.72rem",
                    background: "rgba(0,0,0,0.4)",
                    padding: "0.5rem",
                    borderRadius: "var(--radius-xs)",
                    overflowX: "auto",
                  }}
                >
                  {JSON.stringify(error.details, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Active Analysis Report or Purposeful Engineering Workspace Hero */}
        {report ? (
          <RiskReport
            report={report}
            repoPath={repoPath}
            baseRef={baseRef}
            headRef={headRef}
            onReset={reset}
          />
        ) : (
          !loading && (
            <div className="workspace-hero" id="workspace-hero">
              {/* Left Column: Purpose & Technical Value Proposition */}
              <div className="hero-narrative-card">
                <div>
                  <div className="hero-eyebrow">
                    <IconShield size={12} />
                    <span>Change Risk &amp; Blast Radius Radar</span>
                  </div>
                  <h1 className="hero-headline">
                    Understand what code can break before you merge.
                  </h1>
                  <p className="hero-body">
                    PatchPilot analyzes Git revisions in-memory, parses TypeScript ASTs to detect altered export signatures, maps reverse-dependency consumer reach, and surfaces targeted test suites with verified evidence.
                  </p>

                  {/* Sample Repository Diff Pre-fill CTA */}
                  <div className="hero-sample-prompt">
                    <div className="sample-prompt-header">
                      <span>Ready-to-test local fixture</span>
                      <button
                        type="button"
                        className="btn-sample-load"
                        onClick={loadSampleFixture}
                        id="btn-load-sample"
                      >
                        Load Preset Diff
                      </button>
                    </div>
                    <div className="sample-path-preview">
                      patchpilot-fixture-demo &bull; HEAD~1 &rarr; HEAD
                    </div>
                  </div>
                </div>

                {/* 3 Core Engineering Guarantees */}
                <div className="hero-guarantees">
                  <div className="guarantee-item">
                    <div className="guarantee-label">
                      <IconCheckCircle size={13} style={{ color: "var(--signal-low)" }} />
                      <span>Deterministic</span>
                    </div>
                    <div className="guarantee-sub">
                      Fact-based AST analysis without LLM hallucinations.
                    </div>
                  </div>

                  <div className="guarantee-item">
                    <div className="guarantee-label">
                      <IconShield size={13} style={{ color: "var(--signal-verified)" }} />
                      <span>Zero Execution</span>
                    </div>
                    <div className="guarantee-sub">
                      Never executes repository scripts or installs packages.
                    </div>
                  </div>

                  <div className="guarantee-item">
                    <div className="guarantee-label">
                      <IconTerminal size={13} style={{ color: "var(--accent-light)" }} />
                      <span>Local-First</span>
                    </div>
                    <div className="guarantee-sub">
                      Runs 100% locally on your machine via Node &amp; Git.
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Concrete Technical Schematic of Change Propagation */}
              <div className="hero-schematic-card">
                <div>
                  <div className="schematic-header">
                    <div className="schematic-title">
                      <IconFileCode size={13} />
                      <span>Static Analysis Propagation Pipeline</span>
                    </div>
                    <span className="tab-pill">DAG Reach</span>
                  </div>

                  {/* Stage 1: Export Signature Mutation */}
                  <div className="schematic-node">
                    <div className="schematic-node-head">
                      <span>Stage 1 &bull; Source Export Delta</span>
                      <span className="badge badge-high" style={{ fontSize: "0.62rem" }}>Modified Export</span>
                    </div>
                    <div className="code-diff-preview">
                      <div className="diff-del-line">- export function calculateDiscount(price: number): number</div>
                      <div className="diff-add-line">+ export function calculateDiscount(price: number, tier = "std"): number</div>
                    </div>
                  </div>

                  {/* Arrow: Downstream Consumer Blast Radius */}
                  <div className="schematic-arrow-row">
                    <IconCornerDownRight size={12} style={{ color: "var(--accent)" }} />
                    <span>Traced via AST reverse dependency index</span>
                  </div>

                  {/* Stage 2: Dependent Consumer Blast Radius */}
                  <div className="schematic-node">
                    <div className="schematic-node-head">
                      <span>Stage 2 &bull; Consumer Blast Radius</span>
                      <span className="badge badge-med" style={{ fontSize: "0.62rem" }}>2 Impacted Modules</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-primary)" }}>&larr; src/services/order.ts</span>
                        <span className="depth-pill">Depth 1 (Direct)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--text-primary)" }}>&larr; src/routes/orderRoute.ts</span>
                        <span className="depth-pill">Depth 2 (Route: POST /orders)</span>
                      </div>
                    </div>
                  </div>

                  {/* Arrow: Test Suite Matching */}
                  <div className="schematic-arrow-row">
                    <IconCornerDownRight size={12} style={{ color: "var(--signal-low)" }} />
                    <span>Ranked against test files by import &amp; proximity</span>
                  </div>

                  {/* Stage 3: Targeted Test Recommendations */}
                  <div className="schematic-node" style={{ marginBottom: 0 }}>
                    <div className="schematic-node-head">
                      <span>Stage 3 &bull; Targeted Verification Candidates</span>
                      <span className="badge badge-low" style={{ fontSize: "0.62rem" }}>Candidate Suite</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}>
                      <span style={{ color: "#34d399" }}>🧪 tests/order.test.ts</span>
                      <span className="depth-pill">100% Match &bull; npm test</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                  <span>Result: 35 / 100 Medium Risk</span>
                  <span style={{ color: "var(--accent-light)" }}>Evidence-backed review</span>
                </div>
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
}