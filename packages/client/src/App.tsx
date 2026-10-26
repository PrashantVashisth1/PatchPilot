import { useState } from "react";
import RepoInput from "./components/RepoInput";
import RiskReport from "./components/RiskReport";
import { useAnalysis } from "./hooks/useAnalysis";

export default function App() {
  const [repoPath, setRepoPath] = useState("");
  const [baseRef, setBaseRef] = useState("main");
  const [headRef, setHeadRef] = useState("HEAD");
  const { report, loading, error, run, reset } = useAnalysis();

  const handleSubmit = () => {
    run({ repoPath, baseRef, headRef });
  };

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-logo">⚡</div>
          <div>
            <h1 className="brand-title">PatchPilot</h1>
            <p className="brand-tagline">
              Local-first Git change-risk intelligence &bull; AST regression detection
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="badge-pill">OpenFire Hackathon</span>
          <span className="badge-pill" style={{ borderColor: "var(--accent)" }}>v0.1.0 MVP</span>
        </div>
      </header>

      {/* Input Form */}
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

      {/* Error Banner */}
      {error && (
        <div className="alert-error" id="analysis-error-banner">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Analysis Failed {error.code ? `[${error.code}]` : ""}</strong>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              &times;
            </button>
          </div>
          <div>{error.message}</div>
          {error.details != null && typeof error.details === "object" && (
            <pre style={{ marginTop: "0.5rem", fontSize: "0.75rem", background: "rgba(0,0,0,0.3)", padding: "0.5rem", borderRadius: "4px" }}>
              {JSON.stringify(error.details, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Active Report or Empty Guidance */}
      {report ? (
        <RiskReport report={report} onReset={reset} />
      ) : (
        !loading && (
          <div className="empty-state" style={{ marginTop: "2rem" }}>
            <div className="empty-icon">🛡️</div>
            <div className="empty-title">Ready for Change Analysis</div>
            <p className="empty-desc">
              Enter your local Git repository path and comparison refs above to inspect changed files, trace reverse-dependency blast radius, and view targeted test recommendations.
            </p>
          </div>
        )
      )}
    </div>
  );
}