import { useState, type FC } from "react";
import type { ImpactEdge, ImpactDetail } from "@patchpilot/shared";

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
    (d) => d.directConsumers.length > 0 || d.transitiveConsumers.length > 0,
  );

  const displayedDetails =
    selectedTarget === "all"
      ? impactDetails
      : impactDetails.filter((d) => d.file === selectedTarget);

  return (
    <div id="impact-analysis-section" className="tree-container">
      {/* Scan Completeness Warning */}
      {!scanComplete && (
        <div className="alert-warning" id="impact-scan-alert">
          <span style={{ fontSize: "1.2rem" }}>⚠️</span>
          <div>
            <strong>Partial Impact Scan:</strong> {scanNote ?? "Repository limit reached. Transitive dependencies may be incomplete."}
          </div>
        </div>
      )}

      {/* Target File Filter Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600 }}>
            Filter by target:
          </span>
          <button
            type="button"
            className={`btn-secondary ${selectedTarget === "all" ? "active" : ""}`}
            style={{
              padding: "0.3rem 0.65rem",
              fontSize: "0.8rem",
              borderColor: selectedTarget === "all" ? "var(--accent)" : "var(--border-subtle)",
              color: selectedTarget === "all" ? "var(--accent-light)" : "var(--text-secondary)",
            }}
            onClick={() => setSelectedTarget("all")}
          >
            All Changed Files ({impactDetails.length})
          </button>
          {filesWithImpact.map((d) => (
            <button
              key={d.file}
              type="button"
              className={`btn-secondary ${selectedTarget === d.file ? "active" : ""}`}
              style={{
                padding: "0.3rem 0.65rem",
                fontSize: "0.8rem",
                fontFamily: "var(--font-mono)",
                borderColor: selectedTarget === d.file ? "var(--accent)" : "var(--border-subtle)",
                color: selectedTarget === d.file ? "var(--accent-light)" : "var(--text-secondary)",
              }}
              onClick={() => setSelectedTarget(d.file)}
            >
              {d.file.split("/").pop()} ({d.directConsumers.length + d.transitiveConsumers.length})
            </button>
          ))}
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Total Impact Edges: <strong>{impact.length}</strong>
        </div>
      </div>

      {/* Impact Details per Changed File */}
      {displayedDetails.length === 0 ? (
        <div className="table-card">
          <div className="empty-state">
            <div className="empty-title">No impact detected</div>
            <div className="empty-desc">No internal downstream modules import the changed files.</div>
          </div>
        </div>
      ) : (
        displayedDetails.map((detail) => {
          // Find matching impact edges for this target
          const targetEdges = impact.filter((e) => e.target === detail.file);
          const directEdges = targetEdges.filter((e) => e.depth === 1);
          const transitiveEdges = targetEdges.filter((e) => e.depth > 1);
          const hasConsumers = directEdges.length > 0 || transitiveEdges.length > 0;

          return (
            <div key={detail.file} className="tree-node-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ fontSize: "1.1rem" }}>📦</span>
                  <strong className="file-path">{detail.file}</strong>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span className="badge-pill">
                    {detail.directConsumers.length} Direct Consumer(s)
                  </span>
                  <span className="badge-pill">
                    {detail.transitiveCount} Transitive Consumer(s)
                  </span>
                  {detail.truncated && (
                    <span className="badge badge-medium" title="Consumer search hit max consumers limit">
                      Truncated
                    </span>
                  )}
                </div>
              </div>

              {!hasConsumers ? (
                <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontStyle: "italic", padding: "0.5rem 0" }}>
                  No downstream modules import this file. Safe isolated change leaf.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.75rem" }}>
                  {/* Direct Consumers (Depth 1) */}
                  {directEdges.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.4rem", textTransform: "uppercase" }}>
                        Direct Consumers (Depth 1)
                      </div>
                      <div className="tree-leaf-list">
                        {directEdges.map((edge) => (
                          <div key={edge.consumer} className="tree-leaf-item">
                            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                              <span style={{ color: "var(--accent)" }}>&larr;</span>
                              <span style={{ color: "var(--text-primary)" }}>{edge.consumer}</span>
                            </div>
                            <span className="depth-badge">Direct Import</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transitive Consumers (Depth 2+) */}
                  {transitiveEdges.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.4rem", textTransform: "uppercase" }}>
                        Transitive Consumers (Depth 2+)
                      </div>
                      <div className="tree-leaf-list">
                        {transitiveEdges.map((edge) => (
                          <div key={edge.consumer} className="tree-leaf-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.35rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                                <span style={{ color: "var(--accent-light)" }}>&larr;</span>
                                <span style={{ color: "var(--text-primary)" }}>{edge.consumer}</span>
                              </div>
                              <span className="depth-badge">Depth {edge.depth}</span>
                            </div>
                            {edge.path && edge.path.length > 1 && (
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                                <span>Chain:</span>
                                {edge.path.map((step, idx) => (
                                  <span key={idx}>
                                    <code>{step.split("/").pop()}</code>
                                    {idx < edge.path.length - 1 && <span style={{ margin: "0 0.25rem" }}>&rarr;</span>}
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
