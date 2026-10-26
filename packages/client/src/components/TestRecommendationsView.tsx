import { useState, type FC } from "react";
import type { TestRecommendation } from "@patchpilot/shared";
import {
  IconShield,
  IconCopy,
  IconCheck,
  IconTerminal,
  IconInfo,
  IconFileCode,
} from "./icons";

interface TestRecommendationsViewProps {
  recommendations: TestRecommendation[];
}

export const TestRecommendationsView: FC<TestRecommendationsViewProps> = ({ recommendations }) => {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [checkedSteps, setCheckedSteps] = useState<Set<string>>(new Set());

  const handleCopyCommand = (testFile: string) => {
    const cmd = `npm test -- ${testFile}`;
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(testFile);
    setTimeout(() => setCopiedCmd(null), 1500);
  };

  const toggleCheck = (stepKey: string) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepKey)) next.delete(stepKey);
      else next.add(stepKey);
      return next;
    });
  };

  return (
    <div id="test-recommendations-section">
      {/* Explicit Advisory Disclaimer Banner */}
      <div className="alert-banner alert-banner-info">
        <IconInfo size={16} />
        <div>
          <strong style={{ color: "var(--text-primary)" }}>Static Test Discovery:</strong>
          <span style={{ marginLeft: "0.35rem" }}>
            Candidate test files are inferred deterministically from AST import paths and file naming proximity.
            <strong> PatchPilot never executes repository code or runs test runners automatically.</strong>
          </span>
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="file-table-container">
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-tertiary)" }}>
            <IconShield size={24} style={{ marginBottom: "0.5rem", opacity: 0.5 }} />
            <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 500 }}>
              No test suites identified
            </div>
            <div style={{ fontSize: "0.78rem" }}>
              No existing test files import the changed modules or share direct naming patterns.
            </div>
          </div>
        </div>
      ) : (
        recommendations.map((rec, recIdx) => {
          const confidencePercent = rec.confidence ? Math.round(rec.confidence * 100) : null;

          return (
            <div key={recIdx} className="rec-card">
              <div className="rec-card-header">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <IconFileCode size={15} style={{ color: "var(--accent-light)" }} />
                    <span className="formatted-path" style={{ fontSize: "0.9rem" }}>
                      <strong>{rec.changedFile}</strong>
                    </span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                    {rec.reason}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {confidencePercent !== null && (
                    <span
                      className="badge"
                      style={{
                        background: confidencePercent >= 80 ? "var(--signal-low-bg)" : "var(--signal-med-bg)",
                        color: confidencePercent >= 80 ? "var(--signal-low)" : "var(--signal-med)",
                        border: confidencePercent >= 80 ? "1px solid var(--signal-low-border)" : "1px solid var(--signal-med-border)",
                      }}
                    >
                      {confidencePercent}% Confidence
                    </span>
                  )}
                  <span className="tab-pill">
                    {rec.recommendedTests.length} candidate suite(s)
                  </span>
                </div>
              </div>

              {/* Recommended Test Suites List */}
              <div style={{ marginTop: "0.85rem" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
                  Discovered Test Suites
                </div>
                {rec.recommendedTests.map((testFile) => {
                  const matchInfo = rec.matches?.find((m) => m.testFile === testFile);

                  return (
                    <div key={testFile} className="test-match-row">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ color: "var(--signal-low)", fontFamily: "var(--font-mono)" }}>🧪</span>
                        <code style={{ color: "#34d399", fontSize: "0.82rem" }}>{testFile}</code>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        {matchInfo && (
                          <div style={{ display: "flex", gap: "0.35rem" }}>
                            {matchInfo.reasons.map((r, rIdx) => (
                              <span key={rIdx} className="depth-pill" title={r.detail}>
                                {r.kind} ({Math.round(matchInfo.confidence * 100)}%)
                              </span>
                            ))}
                          </div>
                        )}

                        <button
                          type="button"
                          className="copy-cmd-btn"
                          onClick={() => handleCopyCommand(testFile)}
                          title="Copy test command to clipboard"
                        >
                          {copiedCmd === testFile ? (
                            <>
                              <IconCheck size={12} style={{ color: "var(--signal-low)" }} />
                              <span>Copied command</span>
                            </>
                          ) : (
                            <>
                              <IconTerminal size={12} />
                              <span>Copy command</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Actionable Verification Checklist */}
              {rec.verificationSteps && rec.verificationSteps.length > 0 && (
                <div className="checklist-box">
                  <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
                    Manual Verification Steps
                  </div>
                  <div>
                    {rec.verificationSteps.map((step, sIdx) => {
                      const stepKey = `${recIdx}-${sIdx}`;
                      const isChecked = checkedSteps.has(stepKey);

                      return (
                        <label
                          key={sIdx}
                          className="checklist-item"
                          style={{ cursor: "pointer", userSelect: "none" }}
                          onClick={() => toggleCheck(stepKey)}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            style={{ accentColor: "var(--accent)" }}
                          />
                          <span style={{ textDecoration: isChecked ? "line-through" : "none", opacity: isChecked ? 0.6 : 1 }}>
                            {step}
                          </span>
                        </label>
                      );
                    })}
                  </div>
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
