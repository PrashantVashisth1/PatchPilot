import { useState, type FC } from "react";
import type { AnalyzeResponse } from "@patchpilot/shared";
import RiskSummary from "./RiskSummary";
import ChangedFilesView from "./ChangedFilesView";
import ImpactAnalysisView from "./ImpactAnalysisView";
import TestRecommendationsView from "./TestRecommendationsView";
import DependencyGraphView from "./DependencyGraphView";

interface RiskReportProps {
  report: AnalyzeResponse;
  onReset: () => void;
}

type TabKey = "overview" | "files" | "impact" | "tests" | "graph" | "errors";

export const RiskReport: FC<RiskReportProps> = ({ report, onReset }) => {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const { summary, files, dependencyGraph, impact, impactDetails, scanComplete, scanNote, recommendations, errors } = report;

  return (
    <div id="patchpilot-report-view" style={{ marginTop: "1.5rem" }}>
      {/* Report Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
          padding: "1rem 1.25rem",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.2rem" }}>📊</span>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
              Git Change Risk Analysis
            </h2>
          </div>
          <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
            Deterministic static analysis &bull; AST extract &bull; Reverse dependency impact
          </p>
        </div>

        <button
          id="btn-new-analysis"
          type="button"
          className="btn-secondary"
          onClick={onReset}
        >
          <span>↺ Analyze Another Diff</span>
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="tabs-bar" role="tablist">
        <button
          id="tab-overview"
          type="button"
          role="tab"
          aria-selected={activeTab === "overview"}
          className={`tab-btn ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <span>Risk Overview</span>
          <span className="tab-count">{summary.riskScore.value}/100</span>
        </button>

        <button
          id="tab-files"
          type="button"
          role="tab"
          aria-selected={activeTab === "files"}
          className={`tab-btn ${activeTab === "files" ? "active" : ""}`}
          onClick={() => setActiveTab("files")}
        >
          <span>Changed Files</span>
          <span className="tab-count">{files.length}</span>
        </button>

        <button
          id="tab-impact"
          type="button"
          role="tab"
          aria-selected={activeTab === "impact"}
          className={`tab-btn ${activeTab === "impact" ? "active" : ""}`}
          onClick={() => setActiveTab("impact")}
        >
          <span>Downstream Impact</span>
          <span className="tab-count">{impact.length}</span>
        </button>

        <button
          id="tab-tests"
          type="button"
          role="tab"
          aria-selected={activeTab === "tests"}
          className={`tab-btn ${activeTab === "tests" ? "active" : ""}`}
          onClick={() => setActiveTab("tests")}
        >
          <span>Test Recommendations</span>
          <span className="tab-count">{recommendations.length}</span>
        </button>

        <button
          id="tab-graph"
          type="button"
          role="tab"
          aria-selected={activeTab === "graph"}
          className={`tab-btn ${activeTab === "graph" ? "active" : ""}`}
          onClick={() => setActiveTab("graph")}
        >
          <span>Dependency Graph</span>
          <span className="tab-count">{dependencyGraph.length}</span>
        </button>

        {errors.length > 0 && (
          <button
            id="tab-errors"
            type="button"
            role="tab"
            aria-selected={activeTab === "errors"}
            className={`tab-btn ${activeTab === "errors" ? "active" : ""}`}
            onClick={() => setActiveTab("errors")}
          >
            <span style={{ color: "var(--risk-med)" }}>Diagnostics</span>
            <span className="tab-count" style={{ background: "var(--risk-med-bg)", color: "var(--risk-med)" }}>
              {errors.length}
            </span>
          </button>
        )}
      </div>

      {/* Tab Panels */}
      {activeTab === "overview" && <RiskSummary report={report} />}

      {activeTab === "files" && <ChangedFilesView files={files} />}

      {activeTab === "impact" && (
        <ImpactAnalysisView
          impact={impact}
          impactDetails={impactDetails}
          scanComplete={scanComplete}
          scanNote={scanNote}
        />
      )}

      {activeTab === "tests" && (
        <TestRecommendationsView recommendations={recommendations} />
      )}

      {activeTab === "graph" && (
        <DependencyGraphView
          files={files}
          dependencyGraph={dependencyGraph}
          impact={impact}
        />
      )}

      {activeTab === "errors" && errors.length > 0 && (
        <div id="diagnostics-panel" className="table-card" style={{ padding: "1.25rem" }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--risk-med)" }}>
            Non-Fatal Analysis Diagnostics ({errors.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {errors.map((err, i) => (
              <div
                key={i}
                style={{
                  padding: "0.6rem 0.85rem",
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.83rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <div>
                  <span style={{ color: "var(--text-muted)", marginRight: "0.5rem" }}>[{err.code}]</span>
                  <span style={{ color: "var(--text-primary)" }}>{err.file}</span>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.78rem", marginTop: "0.2rem" }}>
                    {err.message}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RiskReport;