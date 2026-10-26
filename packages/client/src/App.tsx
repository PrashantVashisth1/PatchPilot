import { useState } from "react";
import RepoInput from "./components/RepoInput";
import RiskReport from "./components/RiskReport";
import { useAnalysis } from "./hooks/useAnalysis";
import { IconLogo, IconAlertTriangle, IconShield, IconX } from "./components/icons";

export default function App() {
  const [repoPath, setRepoPath] = useState("");
  const [baseRef, setBaseRef] = useState("main");
  const [headRef, setHeadRef] = useState("HEAD");
  const { report, loading, error, run, reset } = useAnalysis();

  const handleSubmit = () => {
    run({ repoPath, baseRef, headRef });
  };

  return (
    <div className="app-wrapper">
      {/* Top Application Header */}
      <header className="top-nav">
        <div className="top-nav-inner">
          <div className="brand-identity">
            <div className="brand-mark">
              <IconLogo size={16} />
            </div>
            <div className="brand-title">
              <span>PatchPilot</span>
              <span className="brand-version">v0.1.0</span>
            </div>
          </div>

          <div className="nav-actions">
            <div className="status-indicator">
              <span className="status-dot" />
              <span>Local Engine Ready</span>
            </div>
            <span
              style={{
                fontSize: "0.72rem",
                color: "var(--text-tertiary)",
                border: "1px solid var(--border-subtle)",
                padding: "0.2rem 0.5rem",
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

        {/* Active Analysis Report or Focused Onboarding Empty State */}
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
            <div className="empty-onboarding" id="onboarding-empty-state">
              <div className="onboarding-icon-wrap">
                <IconShield size={24} />
              </div>
              <h2 className="onboarding-title">Evidence-Backed Change Risk Intelligence</h2>
              <p className="onboarding-desc">
                PatchPilot parses your Git revisions and TypeScript AST in-memory to trace breaking export signatures, calculate downstream blast radius, and recommend targeted regression test suites before you merge.
              </p>

              {/* 4 Pipeline Pillars */}
              <div className="pipeline-steps">
                <div className="pipeline-step">
                  <div className="step-num">01 / REFS</div>
                  <div className="step-title">Git Bounded Diff</div>
                  <div className="step-detail">Extracts per-file change statistics and tree revisions safely.</div>
                </div>

                <div className="pipeline-step">
                  <div className="step-num">02 / AST</div>
                  <div className="step-title">Source Facts</div>
                  <div className="step-detail">Extracts named exports, routing definitions, and relative imports.</div>
                </div>

                <div className="pipeline-step">
                  <div className="step-num">03 / DAG</div>
                  <div className="step-title">Downstream Reach</div>
                  <div className="step-detail">Computes direct and transitive reverse-dependency consumers.</div>
                </div>

                <div className="pipeline-step">
                  <div className="step-num">04 / SIGNAL</div>
                  <div className="step-title">Risk Scoring</div>
                  <div className="step-detail">Deterministic facts separated from heuristic inferred risks.</div>
                </div>
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
}