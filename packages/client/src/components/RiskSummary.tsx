import type { FC } from "react";
import type { AnalyzeResponse, Finding } from "@patchpilot/shared";

interface RiskSummaryProps {
  report: AnalyzeResponse;
}

export const RiskSummary: FC<RiskSummaryProps> = ({ report }) => {
  const { summary, impact, scanComplete, scanNote } = report;
  const { riskScore, totalFilesChanged, testsRecommended, errorCount } = summary;

  // Split findings into Verified (facts observed deterministically) and Inferred (heuristic risks)
  const verifiedFindings: Finding[] = [];
  const inferredFindings: Finding[] = [];

  for (const finding of riskScore.findings) {
    const isVerified = finding.evidence.every((e) => e.classification === "verified");
    if (isVerified) {
      verifiedFindings.push(finding);
    } else {
      inferredFindings.push(finding);
    }
  }

  const riskCardClass =
    riskScore.label === "high"
      ? "card-risk-high"
      : riskScore.label === "medium"
      ? "card-risk-med"
      : "card-risk-low";

  const riskBadgeClass =
    riskScore.label === "high"
      ? "badge-high"
      : riskScore.label === "medium"
      ? "badge-medium"
      : "badge-low";

  return (
    <div id="risk-summary-section" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Scan Truncation Alert */}
      {!scanComplete && (
        <div className="alert-warning" id="scan-truncated-warning">
          <span style={{ fontSize: "1.2rem" }}>⚠️</span>
          <div>
            <strong>Partial Repository Scan:</strong> {scanNote ?? "Repository scan limits reached. Some downstream consumers may not be mapped."}
          </div>
        </div>
      )}

      {/* Top Metrics Grid */}
      <div className="metrics-grid">
        <div className={`metric-card ${riskCardClass}`}>
          <div className="metric-label">Regression Risk Score</div>
          <div className="metric-value-row">
            <span className="metric-value">{riskScore.value}</span>
            <span style={{ fontSize: "1.1rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>/100</span>
            <span className={`badge ${riskBadgeClass}`}>{riskScore.label} Risk</span>
          </div>
          <div className="metric-sub">
            Derived from {riskScore.findings.length} evidence-backed observation(s)
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Changed Files</div>
          <div className="metric-value-row">
            <span className="metric-value">{totalFilesChanged}</span>
          </div>
          <div className="metric-sub">
            In Git diff across selected refs
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Downstream Impact</div>
          <div className="metric-value-row">
            <span className="metric-value">{impact.length}</span>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>edge(s)</span>
          </div>
          <div className="metric-sub">
            Direct &amp; transitive consumer modules
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Recommended Tests</div>
          <div className="metric-value-row">
            <span className="metric-value">{testsRecommended}</span>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>candidate suite(s)</span>
          </div>
          <div className="metric-sub">
            Targeted verification candidates
          </div>
        </div>
      </div>

      {/* Explanatory Risk Findings */}
      <div className="findings-container">
        <div className="findings-columns">
          {/* Column 1: Verified Facts */}
          <div>
            <div className="column-header">
              <div className="column-title">
                <span className="badge badge-verified">Verified</span>
                <span>Deterministic Facts</span>
              </div>
              <span className="badge-pill">{verifiedFindings.length} observation(s)</span>
            </div>

            {verifiedFindings.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "1rem 0" }}>
                No critical verified risk triggers (e.g. deleted files, config modifications, or broken export signatures).
              </div>
            ) : (
              verifiedFindings.map((finding) => (
                <div key={finding.id} className="finding-card">
                  <div className="finding-header">
                    <span className="finding-name">{finding.id}</span>
                    <span className={`badge badge-${finding.severity}`}>{finding.severity}</span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                    Confidence: 100% (Deterministic) &bull; Score Weight: +{Math.round(finding.contribution * 100)}%
                  </div>
                  <ul className="evidence-list">
                    {finding.evidence.map((ev, idx) => (
                      <li key={idx} className="evidence-item verified">
                        <div>{ev.description}</div>
                        <div className="evidence-meta">
                          <span>source: {ev.source}</span>
                          <span>&bull;</span>
                          <span>file: {ev.file}</span>
                          {ev.lineStart && <span>(L{ev.lineStart}{ev.lineEnd ? `-${ev.lineEnd}` : ""})</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          {/* Column 2: Inferred Risks */}
          <div>
            <div className="column-header">
              <div className="column-title">
                <span className="badge badge-inferred">Inferred</span>
                <span>Heuristic Risks (Capped at 40%)</span>
              </div>
              <span className="badge-pill">{inferredFindings.length} observation(s)</span>
            </div>

            {inferredFindings.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "1rem 0" }}>
                No significant downstream blast radius or heuristic risk factors flagged.
              </div>
            ) : (
              inferredFindings.map((finding) => (
                <div key={finding.id} className="finding-card">
                  <div className="finding-header">
                    <span className="finding-name">{finding.id}</span>
                    <span className={`badge badge-${finding.severity}`}>{finding.severity}</span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                    Confidence: {Math.round(finding.confidence * 100)}% &bull; Score Weight: +{Math.round(finding.contribution * 100)}%
                  </div>
                  <ul className="evidence-list">
                    {finding.evidence.map((ev, idx) => (
                      <li key={idx} className="evidence-item inferred">
                        <div>{ev.description}</div>
                        <div className="evidence-meta">
                          <span>source: {ev.source}</span>
                          <span>&bull;</span>
                          <span>file: {ev.file}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RiskSummary;
