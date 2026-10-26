import { useState, type FC } from "react";
import type { AnalyzeResponse } from "@patchpilot/shared";
import RiskSummary from "./RiskSummary";
import ChangedFilesView from "./ChangedFilesView";
import ImpactAnalysisView from "./ImpactAnalysisView";
import TestRecommendationsView from "./TestRecommendationsView";
import DependencyGraphView from "./DependencyGraphView";
import {
  IconGitBranch,
  IconGitCommit,
  IconArrowRight,
  IconRefresh,
  IconAlertTriangle,
  IconFileCode,
  IconRoute,
  IconShield,
  IconBox,
} from "./icons";

interface RiskReportProps {
  report: AnalyzeResponse;
  repoPath: string;
  baseRef: string;
  headRef: string;
  onReset: () => void;
}

type TabKey = "overview" | "files" | "impact" | "tests" | "graph" | "errors";

export const RiskReport: FC<RiskReportProps> = ({
  report,
  repoPath,
  baseRef,
  headRef,
  onReset,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const { summary, files, dependencyGraph, impact, impactDetails, scanComplete, scanNote, recommendations, errors } = report;

  return (
    <div id="patchpilot-report-view">
      {/* Target Comparison Header Card */}
      <div className="report-header-card">
        <div className="report-target-meta">
          <div className="target-breadcrumbs">
            <span className="commit-badge">
              <IconGitBranch size={13} style={{ color: "var(--accent-light)" }} />
              <span>{baseRef}</span>
            </span>
            <IconArrowRight size={13} style={{ color: "var(--text-tertiary)" }} />
            <span className="commit-badge">
              <IconGitCommit size={13} style={{ color: "var(--accent-light)" }} />
              <span>{headRef || "HEAD"}</span>
            </span>
          </div>
          <div className="target-repo-path">
            <span>Repository: </span>
            <code>{repoPath}</code>
          </div>
        </div>

        <button
          id="btn-new-analysis"
          type="button"
          className="btn-ghost"
          onClick={onReset}
        >
          <IconRefresh size={13} />
          <span>New Comparison</span>
        </button>
      </div>

      {/* Tabs Bar */}
      <div className="nav-tabs-bar" role="tablist">
        <button
          id="tab-overview"
          type="button"
          role="tab"
          aria-selected={activeTab === "overview"}
          className={`tab-item ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <IconShield size={14} />
          <span>Risk Overview</span>
          <span className="tab-pill">{summary.riskScore.value}/100</span>
        </button>

        <button
          id="tab-files"
          type="button"
          role="tab"
          aria-selected={activeTab === "files"}
          className={`tab-item ${activeTab === "files" ? "active" : ""}`}
          onClick={() => setActiveTab("files")}
        >
          <IconFileCode size={14} />
          <span>Changed Files</span>
          <span className="tab-pill">{files.length}</span>
        </button>

        <button
          id="tab-impact"
          type="button"
          role="tab"
          aria-selected={activeTab === "impact"}
          className={`tab-item ${activeTab === "impact" ? "active" : ""}`}
          onClick={() => setActiveTab("impact")}
        >
          <IconRoute size={14} />
          <span>Downstream Impact</span>
          <span className="tab-pill">{impact.length}</span>
        </button>

        <button
          id="tab-tests"
          type="button"
          role="tab"
          aria-selected={activeTab === "tests"}
          className={`tab-item ${activeTab === "tests" ? "active" : ""}`}
          onClick={() => setActiveTab("tests")}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85em" }}>🧪</span>
          <span>Test Recommendations</span>
          <span className="tab-pill">{recommendations.length}</span>
        </button>

        <button
          id="tab-graph"
          type="button"
          role="tab"
          aria-selected={activeTab === "graph"}
          className={`tab-item ${activeTab === "graph" ? "active" : ""}`}
          onClick={() => setActiveTab("graph")}
        >
          <IconBox size={14} />
          <span>Dependency Graph</span>
          <span className="tab-pill">{dependencyGraph.length}</span>
        </button>

        {errors.length > 0 && (
          <button
            id="tab-errors"
            type="button"
            role="tab"
            aria-selected={activeTab === "errors"}
            className={`tab-item ${activeTab === "errors" ? "active" : ""}`}
            onClick={() => setActiveTab("errors")}
          >
            <IconAlertTriangle size={14} style={{ color: "var(--signal-med)" }} />
            <span style={{ color: "var(--signal-med)" }}>Diagnostics</span>
            <span
              className="tab-pill"
              style={{ background: "var(--signal-med-bg)", color: "var(--signal-med)" }}
            >
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
        <div id="diagnostics-panel" className="file-table-container" style={{ padding: "1.25rem" }}>
          <div style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--signal-med)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <IconAlertTriangle size={16} />
            <span>Analysis Diagnostics &amp; Warnings ({errors.length})</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {errors.map((err, i) => (
              <div
                key={i}
                style={{
                  padding: "0.6rem 0.85rem",
                  background: "var(--bg-code)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.8rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <div>
                  <span style={{ color: "var(--text-tertiary)", marginRight: "0.5rem" }}>[{err.code}]</span>
                  <span style={{ color: "var(--text-primary)" }}>{err.file}</span>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "0.2rem" }}>
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