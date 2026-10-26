import { useState, type FC } from "react";
import type { ImpactEdge, ImpactDetail } from "@patchpilot/shared";
import {
  IconCornerDownRight,
  IconAlertTriangle,
  IconRoute,
  IconArrowRight,
  IconFileCode,
} from "./icons";

interface ImpactAnalysisViewProps {
  impact: ImpactEdge[];
  impactDetails: ImpactDetail[];
  scanComplete: boolean;
  scanNote?: string;
}

export const ImpactAnalysisView: FC<ImpactAnalysisViewProps> = ({
  impact,
  impactDetails,
  scanComplete,
  scanNote,
}) => {
  const [selectedTarget, setSelectedTarget] = useState<string>("all");

  const filesWithImpact = impactDetails.filter(
    (d) => d.directConsumers.length > 0 || d.transitiveConsumers.length > 0
  );

  const displayedDetails =
    selectedTarget === "all"
      ? impactDetails
      : impactDetails.filter((d) => d.file === selectedTarget);

  return (
    <div id="impact-analysis-section">
      {/* Scan Truncation Alert */}
      {!scanComplete && (
        <div className="alert-banner alert-banner-warning" id="impact-scan-alert">
          <IconAlertTriangle size={16} />
          <div>
            <strong>Partial Impact Scan:</strong> {scanNote ?? "Repository limit reached during traversal. Some transitive paths may be omitted."}
          </div>
        </div>
      )}

      {/* Target Selector Bar */}
      <div className="filter-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontWeight: 500 }}>
            Scope by changed file:
          </span>
          <button
            type="button"
            className={`filter-btn ${selectedTarget === "all" ? "active" : ""}`}
            onClick={() => setSelectedTarget("all")}
          >
            All Files ({impactDetails.length})
          </button>
          {filesWithImpact.map((d) => (
            <button
              key={d.file}
              type="button"
              className={`filter-btn ${selectedTarget === d.file ? "active" : ""}`}
              onClick={() => setSelectedTarget(d.file)}
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {d.file.split("/").pop()} ({d.directConsumers.length + d.transitiveConsumers.length})
            </button>
          ))}
        </div>

        <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {impact.length} consumer edge(s) mapped
        </div>
      </div>

      {/* Impact Tree Cards */}
      {displayedDetails.length === 0 ? (
        <div className="file-table-container">
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-tertiary)" }}>
            <IconRoute size={24} style={{ marginBottom: "0.5rem", opacity: 0.5 }} />
            <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 500 }}>No downstream impact</div>
            <div style={{ fontSize: "0.78rem" }}>No other internal workspace modules import the selected target(s).</div>
          </div>
        </div>
      ) : (
        displayedDetails.map((detail) => {
          const targetEdges = impact.filter((e) => e.target === detail.file);
          const directEdges = targetEdges.filter((e) => e.depth === 1);
          const transitiveEdges = targetEdges.filter((e) => e.depth > 1);
          const hasConsumers = directEdges.length > 0 || transitiveEdges.length > 0;

          return (
            <div key={detail.file} className="impact-chain-card">
              <div className="impact-chain-header">
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <IconFileCode size={16} style={{ color: "var(--accent-light)" }} />
                  <span className="formatted-path" style={{ fontSize: "0.9rem" }}>
                    <strong>{detail.file}</strong>
                  </span>
                </div>

                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <span className="tab-pill">
                    {detail.directConsumers.length} Direct
                  </span>
                  <span className="tab-pill">
                    {detail.transitiveCount} Transitive
                  </span>
                  {detail.truncated && (
                    <span className="badge badge-med" title="Hit maximum consumer limit">
                      Truncated
                    </span>
                  )}
                </div>
              </div>

              {!hasConsumers ? (
                <div style={{ fontSize: "0.78rem", color: "var(--text-tertiary)", fontStyle: "italic", padding: "0.5rem 0" }}>
                  Isolated change leaf — no downstream modules import this file.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {/* Direct Consumers (Depth 1) */}
                  {directEdges.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
                        Direct Consumers (Depth 1)
                      </div>
                      <div className="tree-branch">
                        {directEdges.map((edge) => (
                          <div key={edge.consumer} className="tree-leaf-row">
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <IconCornerDownRight size={13} style={{ color: "var(--accent)" }} />
                              <span style={{ color: "var(--text-primary)" }}>{edge.consumer}</span>
                            </div>
                            <span className="depth-pill">Direct Import</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transitive Consumers (Depth 2+) */}
                  {transitiveEdges.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
                        Transitive Propagation (Depth 2+)
                      </div>
                      <div className="tree-branch">
                        {transitiveEdges.map((edge) => (
                          <div key={edge.consumer} className="tree-leaf-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.35rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <IconCornerDownRight size={13} style={{ color: "var(--accent-light)" }} />
                                <span style={{ color: "var(--text-primary)" }}>{edge.consumer}</span>
                              </div>
                              <span className="depth-pill">Depth {edge.depth}</span>
                            </div>

                            {edge.path && edge.path.length > 1 && (
                              <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", paddingLeft: "1.25rem" }}>
                                <span style={{ color: "var(--text-secondary)" }}>Propagation chain:</span>
                                {edge.path.map((step, idx) => (
                                  <span key={idx} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                                    <code style={{ color: "var(--text-secondary)" }}>{step.split("/").pop()}</code>
                                    {idx < edge.path.length - 1 && <IconArrowRight size={10} style={{ color: "var(--text-tertiary)" }} />}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default ImpactAnalysisView;
