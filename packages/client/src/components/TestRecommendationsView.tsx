import type { FC } from "react";
import type { TestRecommendation } from "@patchpilot/shared";

interface TestRecommendationsViewProps {
  recommendations: TestRecommendation[];
}

export const TestRecommendationsView: FC<TestRecommendationsViewProps> = ({ recommendations }) => {
  return (
    <div id="test-recommendations-section">
      {/* Explicit Disclaimer Notice */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderLeft: "3px solid var(--accent)",
          borderRadius: "var(--radius-md)",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        <span style={{ fontSize: "1.3rem" }}>ℹ️</span>
        <div>
          <strong style={{ color: "var(--text-primary)" }}>Advisory Test Suite Recommendations:</strong>
          <p style={{ fontSize: "0.83rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            These test suites are statically inferred from AST imports, module proximity, and naming conventions.
            <strong> PatchPilot never executes repository code or runs tests automatically.</strong> Use the verification steps below to validate these targeted tests locally or in CI.
          </p>
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="table-card">
          <div className="empty-state">
            <div className="empty-icon">🧪</div>
            <div className="empty-title">No test recommendations generated</div>
            <div className="empty-desc">
              No matching test suites could be found for the changed files based on naming conventions, directory structure, or AST import graphs.
            </div>
          </div>
        </div>
      ) : (
        recommendations.map((rec, idx) => {
          const confidencePercent = rec.confidence ? Math.round(rec.confidence * 100) : null;

          return (
            <div key={idx} className="test-rec-card">
              <div className="test-rec-header">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ fontSize: "1rem" }}>🎯</span>
                    <strong className="file-path">{rec.changedFile}</strong>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "0.3rem" }}>
                    {rec.reason}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {confidencePercent !== null && (
                    <span
                      className="badge"
                      style={{
                        background: confidencePercent >= 80 ? "var(--risk-low-bg)" : "var(--risk-med-bg)",
                        color: confidencePercent >= 80 ? "var(--risk-low)" : "var(--risk-med)",
                        border: confidencePercent >= 80 ? "1px solid var(--risk-low-border)" : "1px solid var(--risk-med-border)",
                      }}
                    >
                      {confidencePercent}% Confidence
                    </span>
                  )}
                  <span className="badge-pill">
                    {rec.recommendedTests.length} Candidate Test File(s)
                  </span>
                </div>
              </div>

              {/* Matched Test Files */}
              <div style={{ marginTop: "1rem" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "0.4rem" }}>
                  Candidate Test Suites
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {rec.recommendedTests.map((testFile) => {
                    const matchInfo = rec.matches?.find((m) => m.testFile === testFile);
                    return (
                      <div
                        key={testFile}
                        style={{
                          background: "var(--bg-base)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-md)",
                          padding: "0.6rem 0.85rem",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "0.5rem",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ color: "var(--risk-low)" }}>🧪</span>
                          <span className="file-path" style={{ color: "#34d399" }}>
                            {testFile}
                          </span>
                        </div>

                        {matchInfo && (
                          <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                            {matchInfo.reasons.map((r, rIdx) => (
                              <span
                                key={rIdx}
                                className="depth-badge"
                                title={r.detail}
                              >
                                {r.kind} ({Math.round(matchInfo.confidence * 100)}%)
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actionable Verification Steps Checklist */}
              {rec.verificationSteps && rec.verificationSteps.length > 0 && (
                <div style={{ marginTop: "1.25rem", paddingTop: "0.85rem", borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                    Recommended Verification Steps
                  </div>
                  <ul className="test-checklist">
                    {rec.verificationSteps.map((step, sIdx) => (
                      <li key={sIdx} className="test-checklist-item">
                        <span className="check-bullet">&bull;</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default TestRecommendationsView;
