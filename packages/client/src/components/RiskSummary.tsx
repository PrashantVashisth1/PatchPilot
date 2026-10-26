import type { FC } from "react";
import type { AnalyzeResponse, Finding } from "@patchpilot/shared";
import {
  IconShield,
  IconFileCode,
  IconRoute,
  IconCheckCircle,
  IconAlertTriangle,
  IconInfo,
} from "./icons";

interface RiskSummaryProps {
  report: AnalyzeResponse;
}

export const RiskSummary: FC<RiskSummaryProps> = ({ report }) => {
  const { summary, impact, scanComplete, scanNote } = report;
  const { riskScore, totalFilesChanged, testsRecommended } = summary;

  // Separate Verified (deterministic AST/diff facts) from Inferred (heuristic downstream/context risks)
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

  const scoreVal = riskScore.value;
  const activeBand =
    riskScore.label === "high"
      ? "active-high"
      : riskScore.label === "medium"
      ? "active-med"
      : "active-low";

  const badgeClass =
    riskScore.label === "high"
      ? "badge-high"
      : riskScore.label === "medium"
      ? "badge-med"
      : "badge-low";

  return (
    <div id="risk-summary-section" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Scan Truncation Alert */}
      {!scanComplete && (
        <div className="alert-banner alert-banner-warning" id="scan-truncated-warning">
          <IconAlertTriangle size={16} />
          <div>
            <strong>Partial Analysis Tree:</strong> {scanNote ?? "Repository limit reached during traversal. Some downstream consumers may be unmapped."}
          </div>
        </div>
      )}

      {/* Top Engineering Metrics Grid */}
      <div className="summary-metrics-grid">
        {/* Risk Score Panel */}
        <div className="metric-panel">
          <div>
            <div className="metric-header">
              <span>Regression Risk Signal</span>
              <span className={`badge ${badgeClass}`}>{riskScore.label}</span>
            </div>
            <div className="metric-num-wrap">
              <span className="metric-large-num">{scoreVal}</span>
              <span style={{ color: "var(--text-tertiary)", fontSize: "1rem", fontFamily: "var(--font-mono)" }}>/100</span>
            </div>
          </div>
          <div>
            {/* Segmented Risk Meter Bar */}
            <div className="risk-meter-bar" title={`Score: ${scoreVal}/100 (${riskScore.label})`}>
              <div className={`risk-meter-segment ${scoreVal >= 0 ? activeBand : ""}`} />
              <div className={`risk-meter-segment ${scoreVal > 25 ? activeBand : ""}`} />
              <div className={`risk-meter-segment ${scoreVal > 60 ? activeBand : ""}`} />
              <div className={`risk-meter-segment ${scoreVal > 80 ? activeBand : ""}`} />
            </div>
            <div className="metric-context">
              Aggregated from {riskScore.findings.length} evidence finding(s)
            </div>
          </div>
        </div>

        {/* Files Panel */}
        <div className="metric-panel">
          <div>
            <div className="metric-header">
              <span>Changed Surface</span>
              <IconFileCode size={14} />
            </div>
            <div className="metric-num-wrap">
              <span className="metric-large-num">{totalFilesChanged}</span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>files</span>
            </div>
          </div>
          <div className="metric-context">
            Included in base...head Git diff
          </div>
        </div>

        {/* Impact Reach Panel */}
        <div className="metric-panel">
          <div>
            <div className="metric-header">
              <span>Blast Radius</span>
              <IconRoute size={14} />
            </div>
            <div className="metric-num-wrap">
              <span className="metric-large-num">{impact.length}</span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>edges</span>
            </div>
          </div>
          <div className="metric-context">
            Direct &amp; transitive consumer modules
          </div>
        </div>

        {/* Test Candidates Panel */}
        <div className="metric-panel">
          <div>
            <div className="metric-header">
              <span>Targeted Tests</span>
              <IconShield size={14} />
            </div>
            <div className="metric-num-wrap">
              <span className="metric-large-num">{testsRecommended}</span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>suites</span>
            </div>
          </div>
          <div className="metric-context">
            Candidate suites to run for review
          </div>
        </div>
      </div>

      {/* Dual Column Findings: Verified vs Inferred */}
      <div className="findings-dual-grid">
        {/* Column 1: Deterministic Verified Facts */}
        <div className="column-box">
          <div className="column-box-header">
            <div className="column-box-title">
              <span className="badge badge-verified">Verified</span>
              <span>Deterministic AST &amp; Git Facts</span>
            </div>
            <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {verifiedFindings.length} observation(s)
            </span>
          </div>

          {verifiedFindings.length === 0 ? (
            <div style={{ color: "var(--text-tertiary)", fontSize: "0.82rem", padding: "1.5rem 0", textAlign: "center" }}>
              <IconCheckCircle size={18} style={{ color: "var(--signal-low)", marginBottom: "0.5rem" }} />
              <div>No deterministic high-risk events observed (no export signature removals, config disruptions, or deletions).</div>
            </div>
          ) : (
            verifiedFindings.map((finding) => (
              <div key={finding.id} className="finding-tile">
                <div className="finding-tile-header">
                  <span className="finding-tile-title">{finding.id}</span>
                  <span className={`badge ${finding.severity === "high" ? "badge-high" : finding.severity === "medium" ? "badge-med" : "badge-low"}`}>
                    {finding.severity}
                  </span>
                </div>
                <div className="finding-tile-meta">
                  Confidence: 100% (Deterministic) &bull; Score Contribution: +{Math.round(finding.contribution * 100)}%
                </div>
                <div className="evidence-items-list">
                  {finding.evidence.map((ev, idx) => (
                    <div key={idx} className="evidence-block verified">
                      <div>{ev.description}</div>
                      <div className="evidence-block-meta">
                        <span>source: {ev.source}</span>
                        <span>&bull;</span>
                        <code style={{ color: "var(--text-primary)" }}>{ev.file}</code>
                        {ev.lineStart && <span>(L{ev.lineStart}{ev.lineEnd ? `-${ev.lineEnd}` : ""})</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Column 2: Inferred Downstream Risks */}
        <div className="column-box">
          <div className="column-box-header">
            <div className="column-box-title">
              <span className="badge badge-inferred">Inferred</span>
              <span>Heuristic Downstream Risks</span>
            </div>
            <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              Capped at 40% weight
            </span>
          </div>

          {inferredFindings.length === 0 ? (
            <div style={{ color: "var(--text-tertiary)", fontSize: "0.82rem", padding: "1.5rem 0", textAlign: "center" }}>
              <IconInfo size={18} style={{ color: "var(--text-tertiary)", marginBottom: "0.5rem" }} />
              <div>No significant heuristic downstream risks or broad blast radius detected.</div>
            </div>
          ) : (
            inferredFindings.map((finding) => (
              <div key={finding.id} className="finding-tile">
                <div className="finding-tile-header">
                  <span className="finding-tile-title">{finding.id}</span>
                  <span className={`badge ${finding.severity === "high" ? "badge-high" : finding.severity === "medium" ? "badge-med" : "badge-low"}`}>
                    {finding.severity}
                  </span>
                </div>
                <div className="finding-tile-meta">
                  Confidence: {Math.round(finding.confidence * 100)}% &bull; Score Contribution: +{Math.round(finding.contribution * 100)}%
                </div>
                <div className="evidence-items-list">
                  {finding.evidence.map((ev, idx) => (
                    <div key={idx} className="evidence-block inferred">
                      <div>{ev.description}</div>
                      <div className="evidence-block-meta">
                        <span>source: {ev.source}</span>
                        <span>&bull;</span>
                        <code style={{ color: "var(--text-primary)" }}>{ev.file}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default RiskSummary;
