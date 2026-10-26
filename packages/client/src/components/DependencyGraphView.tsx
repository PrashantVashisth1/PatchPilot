import { useState, type FC } from "react";
import type { DepEdge, ImpactEdge, FileAnalysis } from "@patchpilot/shared";
import {
  IconSearch,
  IconArrowRight,
  IconCornerDownRight,
  IconBox,
} from "./icons";

interface DependencyGraphViewProps {
  files: FileAnalysis[];
  dependencyGraph: DepEdge[];
  impact: ImpactEdge[];
}

export const DependencyGraphView: FC<DependencyGraphViewProps> = ({
  files,
  dependencyGraph,
  impact,
}) => {
  const [viewMode, setViewMode] = useState<"forward" | "reverse">("forward");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEdges = (
    viewMode === "forward" ? dependencyGraph : impact.map((i) => ({ source: i.consumer, target: i.target }))
  ).filter((edge) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return edge.source.toLowerCase().includes(q) || edge.target.toLowerCase().includes(q);
  });

  const groupedEdges = new Map<string, string[]>();
  for (const edge of filteredEdges) {
    const key = viewMode === "forward" ? edge.source : edge.target;
    const related = viewMode === "forward" ? edge.target : edge.source;
    const list = groupedEdges.get(key) ?? [];
    if (!list.includes(related)) list.push(related);
    groupedEdges.set(key, list);
  }

  return (
    <div id="dependency-graph-section">
      {/* Switcher & Search Bar */}
      <div className="filter-toolbar">
        <div className="filter-btn-group">
          <button
            type="button"
            className={`filter-btn ${viewMode === "forward" ? "active" : ""}`}
            onClick={() => setViewMode("forward")}
          >
            <span>&rarr; Outgoing Dependencies</span>
            <span style={{ opacity: 0.6, fontFamily: "var(--font-mono)" }}>{dependencyGraph.length}</span>
          </button>
          <button
            type="button"
            className={`filter-btn ${viewMode === "reverse" ? "active" : ""}`}
            onClick={() => setViewMode("reverse")}
          >
            <span>&larr; Incoming Consumers</span>
            <span style={{ opacity: 0.6, fontFamily: "var(--font-mono)" }}>{impact.length}</span>
          </button>
        </div>

        <div className="field-input-wrapper" style={{ width: "240px" }}>
          <span className="field-input-icon">
            <IconSearch size={13} />
          </span>
          <input
            type="text"
            className="text-input"
            style={{ height: "30px", fontSize: "0.78rem" }}
            placeholder="Search module..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "1rem" }}>
        {viewMode === "forward"
          ? "Resolved relative imports: Changed File → imports → Target Internal Module"
          : "Downstream reverse blast radius: Consumer File → imports → Changed Target"}
      </div>

      {groupedEdges.size === 0 ? (
        <div className="file-table-container">
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-tertiary)" }}>
            <IconBox size={24} style={{ marginBottom: "0.5rem", opacity: 0.5 }} />
            <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 500 }}>
              No relationships mapped
            </div>
            <div style={{ fontSize: "0.78rem" }}>
              {searchQuery
                ? `No dependency edges match "${searchQuery}".`
                : "No relative internal dependency edges recorded."}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {[...groupedEdges.entries()].map(([primaryFile, relatedList]) => (
            <div key={primaryFile} className="impact-chain-card" style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <IconBox size={14} style={{ color: "var(--accent-light)" }} />
                  <span className="formatted-path">
                    <strong>{primaryFile}</strong>
                  </span>
                </div>
                <span className="tab-pill">
                  {relatedList.length} {viewMode === "forward" ? "import(s)" : "consumer(s)"}
                </span>
              </div>

              <div className="tree-branch">
                {relatedList.map((rel) => (
                  <div key={rel} className="tree-leaf-row">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <IconCornerDownRight
                        size={13}
                        style={{ color: viewMode === "forward" ? "var(--accent)" : "var(--accent-light)" }}
                      />
                      <span style={{ color: "var(--text-primary)" }}>{rel}</span>
                    </div>
                    <span className="depth-pill">
                      {viewMode === "forward" ? "Imports" : "Depends on"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DependencyGraphView;
