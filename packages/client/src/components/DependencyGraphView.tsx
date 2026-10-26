import { useState, type FC } from "react";
import type { DepEdge, ImpactEdge, FileAnalysis } from "@patchpilot/shared";

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

  // Group edges by primary file for clean tree structure
  const groupedEdges = new Map<string, string[]>();
  for (const edge of filteredEdges) {
    const key = viewMode === "forward" ? edge.source : edge.target;
    const related = viewMode === "forward" ? edge.target : edge.source;
    const list = groupedEdges.get(key) ?? [];
    if (!list.includes(related)) list.push(related);
    groupedEdges.set(key, list);
  }

  return (
    <div id="dependency-graph-section" className="tree-container">
      {/* View Switcher & Search Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className={`btn-secondary ${viewMode === "forward" ? "active" : ""}`}
            style={{
              borderColor: viewMode === "forward" ? "var(--accent)" : "var(--border-subtle)",
              color: viewMode === "forward" ? "var(--accent-light)" : "var(--text-secondary)",
            }}
            onClick={() => setViewMode("forward")}
          >
            <span>&rarr; Outgoing Dependencies</span>
            <span className="badge-pill">{dependencyGraph.length}</span>
          </button>
          <button
            type="button"
            className={`btn-secondary ${viewMode === "reverse" ? "active" : ""}`}
            style={{
              borderColor: viewMode === "reverse" ? "var(--accent)" : "var(--border-subtle)",
              color: viewMode === "reverse" ? "var(--accent-light)" : "var(--text-secondary)",
            }}
            onClick={() => setViewMode("reverse")}
          >
            <span>&larr; Incoming Consumers (Impact)</span>
            <span className="badge-pill">{impact.length}</span>
          </button>
        </div>

        <div>
          <input
            type="text"
            className="form-input"
            style={{ width: "240px", padding: "0.4rem 0.75rem", fontSize: "0.82rem" }}
            placeholder="Search files in graph..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        {viewMode === "forward"
          ? "Showing resolved relative imports: Changed File → imports → Target Module"
          : "Showing reverse blast radius: Consumer File → depends on → Changed Target"}
      </div>

      {groupedEdges.size === 0 ? (
        <div className="table-card">
          <div className="empty-state">
            <div className="empty-title">No dependency edges found</div>
            <div className="empty-desc">
              {searchQuery
                ? `No edges matched the search term "${searchQuery}".`
                : viewMode === "forward"
                ? "Changed files have no local relative dependencies within the repository tree."
                : "No consumers import the changed modules."}
            </div>
          </div>
        </div>
      ) : (
        [...groupedEdges.entries()].map(([primaryFile, relatedList]) => (
          <div key={primaryFile} className="tree-node-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>{viewMode === "forward" ? "📤" : "📥"}</span>
                <strong className="file-path">{primaryFile}</strong>
              </div>
              <span className="badge-pill">
                {relatedList.length} {viewMode === "forward" ? "Import(s)" : "Consumer(s)"}
              </span>
            </div>

            <div className="tree-leaf-list">
              {relatedList.map((rel) => (
                <div key={rel} className="tree-leaf-item">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ color: viewMode === "forward" ? "var(--accent)" : "var(--accent-light)" }}>
                      {viewMode === "forward" ? "&rarr;" : "&larr;"}
                    </span>
                    <span style={{ color: "var(--text-primary)" }}>{rel}</span>
                  </div>
                  <span className="depth-badge">
                    {viewMode === "forward" ? "Direct Import" : "Downstream Dep"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default DependencyGraphView;
