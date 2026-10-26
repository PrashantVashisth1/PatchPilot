import { useState, type FC } from "react";
import type { FileAnalysis, FileStatus } from "@patchpilot/shared";

interface ChangedFilesViewProps {
  files: FileAnalysis[];
}

export const ChangedFilesView: FC<ChangedFilesViewProps> = ({ files }) => {
  const [filter, setFilter] = useState<string>("all");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(files.slice(0, 3).map((f) => f.path)));

  const toggleExpand = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const filteredFiles = files.filter((f) => {
    if (filter === "all") return true;
    return f.status === filter;
  });

  const getStatusBadgeClass = (status: FileStatus) => {
    switch (status) {
      case "added":
        return "badge-added";
      case "modified":
        return "badge-modified";
      case "deleted":
        return "badge-deleted";
      case "renamed":
        return "badge-renamed";
      default:
        return "";
    }
  };

  return (
    <div id="changed-files-section">
      {/* Filters Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["all", "modified", "added", "deleted", "renamed"] as const).map((st) => {
            const count = st === "all" ? files.length : files.filter((f) => f.status === st).length;
            if (st !== "all" && count === 0) return null;
            return (
              <button
                key={st}
                type="button"
                className={`btn-secondary ${filter === st ? "active" : ""}`}
                style={{
                  padding: "0.3rem 0.75rem",
                  fontSize: "0.8rem",
                  borderColor: filter === st ? "var(--accent)" : "var(--border-subtle)",
                  color: filter === st ? "var(--accent-light)" : "var(--text-secondary)",
                }}
                onClick={() => setFilter(st)}
              >
                <span style={{ textTransform: "capitalize" }}>{st}</span>
                <span style={{ opacity: 0.6 }}>({count})</span>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Showing {filteredFiles.length} of {files.length} changed file(s)
        </div>
      </div>

      {/* Files List */}
      <div className="table-card">
        {filteredFiles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">No matching files</div>
            <div className="empty-desc">No files in this commit range matched the selected status filter.</div>
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isExpanded = expandedFiles.has(file.path);
            const hasAstData =
              file.exports.length > 0 ||
              file.routes.length > 0 ||
              file.imports.length > 0 ||
              file.dependedOnBy.length > 0 ||
              file.testFiles.length > 0;

            return (
              <div key={file.path} className="file-row">
                <div
                  className="file-header"
                  onClick={() => toggleExpand(file.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      toggleExpand(file.path);
                    }
                  }}
                >
                  <div className="file-title-group">
                    <span className={`badge ${getStatusBadgeClass(file.status)}`}>
                      {file.status}
                    </span>
                    <span className="file-path">{file.path}</span>
                    {file.oldPath && (
                      <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        (from {file.oldPath})
                      </span>
                    )}
                  </div>

                  <div className="file-stats">
                    {file.additions !== undefined && file.deletions !== undefined && (
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <span className="stat-add">+{file.additions}</span>
                        <span className="stat-del">-{file.deletions}</span>
                      </div>
                    )}
                    {file.routes.length > 0 && (
                      <span className="badge-pill" style={{ borderColor: "var(--accent)" }}>
                        {file.routes.length} route(s)
                      </span>
                    )}
                    {file.dependedOnBy.length > 0 && (
                      <span className="badge-pill">
                        {file.dependedOnBy.length} consumer(s)
                      </span>
                    )}
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="file-details">
                    {/* Exports Block */}
                    <div className="detail-block">
                      <div className="detail-title">
                        <span>Declared Exports</span>
                        <span className="badge-pill">{file.exports.length}</span>
                      </div>
                      {file.exports.length === 0 ? (
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No exported symbols detected.</span>
                      ) : (
                        <div className="tag-list">
                          {file.exports.map((exp) => (
                            <span
                              key={exp.name}
                              className={`tag-item ${exp.signatureChanged ? "signature-changed" : ""}`}
                              title={exp.signatureChanged ? "Export signature was altered between base and head" : undefined}
                            >
                              <span style={{ color: "var(--text-muted)", marginRight: "0.2rem" }}>{exp.kind}</span>
                              <strong>{exp.name}</strong>
                              {exp.signatureChanged && <span style={{ marginLeft: "0.3rem" }}>⚠️ modified</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Detected Routes */}
                    {file.routes.length > 0 && (
                      <div className="detail-block">
                        <div className="detail-title">
                          <span>Detected API / App Routes</span>
                          <span className="badge-pill">{file.routes.length}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                          {file.routes.map((rt, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                fontSize: "0.82rem",
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              <span
                                className="badge"
                                style={{
                                  background: "var(--accent-bg)",
                                  color: "var(--accent-light)",
                                  fontSize: "0.7rem",
                                }}
                              >
                                {rt.method}
                              </span>
                              <span style={{ color: "var(--text-primary)" }}>{rt.path}</span>
                              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>(L{rt.line})</span>
                              {rt.framework && (
                                <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                                  [{rt.framework}]
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reverse Consumers */}
                    <div className="detail-block">
                      <div className="detail-title">
                        <span>Direct Consumers (Reverse Dependencies)</span>
                        <span className="badge-pill">{file.dependedOnBy.length}</span>
                      </div>
                      {file.dependedOnBy.length === 0 ? (
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No direct reverse dependencies in tree.</span>
                      ) : (
                        <div className="tag-list">
                          {file.dependedOnBy.map((consumer) => (
                            <span key={consumer} className="tag-item">
                              {consumer}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Targeted Tests */}
                    <div className="detail-block">
                      <div className="detail-title">
                        <span>Matched Test Candidates</span>
                        <span className="badge-pill">{file.testFiles.length}</span>
                      </div>
                      {file.testFiles.length === 0 ? (
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No direct test file matches found.</span>
                      ) : (
                        <div className="tag-list">
                          {file.testFiles.map((tf) => (
                            <span key={tf} className="tag-item" style={{ borderColor: "var(--risk-low-border)", color: "#34d399" }}>
                              🧪 {tf}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChangedFilesView;
