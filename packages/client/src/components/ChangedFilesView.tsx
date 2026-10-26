import { useState, type FC } from "react";
import type { FileAnalysis, FileStatus } from "@patchpilot/shared";
import {
  IconFileCode,
  IconChevronRight,
  IconChevronDown,
  IconSearch,
  IconCopy,
  IconCheck,
  IconRoute,
  IconBox,
} from "./icons";

interface ChangedFilesViewProps {
  files: FileAnalysis[];
}

export const ChangedFilesView: FC<ChangedFilesViewProps> = ({ files }) => {
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    new Set(files.slice(0, 3).map((f) => f.path))
  );
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const toggleExpand = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const handleCopy = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const filteredFiles = files.filter((f) => {
    if (filter !== "all" && f.status !== filter) return false;
    if (searchQuery.trim() && !f.path.toLowerCase().includes(searchQuery.toLowerCase().trim())) {
      return false;
    }
    return true;
  });

  const getStatusBadge = (status: FileStatus) => {
    switch (status) {
      case "added":
        return <span className="badge-status badge-status-a" title="Added">A</span>;
      case "modified":
        return <span className="badge-status badge-status-m" title="Modified">M</span>;
      case "deleted":
        return <span className="badge-status badge-status-d" title="Deleted">D</span>;
      case "renamed":
        return <span className="badge-status badge-status-r" title="Renamed">R</span>;
      default:
        return null;
    }
  };

  // Helper to format directory dimmed and filename bright
  const renderPath = (fullPath: string) => {
    const lastSlash = fullPath.lastIndexOf("/");
    if (lastSlash === -1) {
      return <span className="path-file">{fullPath}</span>;
    }
    const dir = fullPath.slice(0, lastSlash + 1);
    const file = fullPath.slice(lastSlash + 1);
    return (
      <span className="formatted-path">
        <span className="path-dir">{dir}</span>
        <span className="path-file">{file}</span>
      </span>
    );
  };

  return (
    <div id="changed-files-section">
      {/* Filter and Search Toolbar */}
      <div className="filter-toolbar">
        <div className="filter-btn-group">
          {(["all", "modified", "added", "deleted", "renamed"] as const).map((st) => {
            const count = st === "all" ? files.length : files.filter((f) => f.status === st).length;
            if (st !== "all" && count === 0) return null;
            return (
              <button
                key={st}
                type="button"
                className={`filter-btn ${filter === st ? "active" : ""}`}
                onClick={() => setFilter(st)}
              >
                <span style={{ textTransform: "capitalize" }}>{st}</span>
                <span style={{ opacity: 0.6, fontFamily: "var(--font-mono)" }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div className="field-input-wrapper" style={{ width: "220px" }}>
            <span className="field-input-icon">
              <IconSearch size={13} />
            </span>
            <input
              type="text"
              className="text-input"
              style={{ height: "30px", fontSize: "0.78rem" }}
              placeholder="Filter file path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Files List Table */}
      <div className="file-table-container">
        {filteredFiles.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-tertiary)" }}>
            <IconFileCode size={24} style={{ marginBottom: "0.5rem", opacity: 0.5 }} />
            <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 500 }}>No matching files</div>
            <div style={{ fontSize: "0.78rem" }}>No files match the active status or path query.</div>
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isExpanded = expandedFiles.has(file.path);

            return (
              <div key={file.path} className="file-row-item">
                <div
                  className="file-row-summary"
                  onClick={() => toggleExpand(file.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") toggleExpand(file.path);
                  }}
                >
                  <div className="file-path-group">
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </span>
                    {getStatusBadge(file.status)}
                    {renderPath(file.path)}
                    {file.oldPath && (
                      <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                        &larr; {file.oldPath}
                      </span>
                    )}
                    <button
                      type="button"
                      className="copy-cmd-btn"
                      onClick={(e) => handleCopy(file.path, e)}
                      title="Copy file path"
                      style={{ height: "20px", padding: "0 4px" }}
                    >
                      {copiedPath === file.path ? <IconCheck size={11} style={{ color: "var(--signal-low)" }} /> : <IconCopy size={11} />}
                    </button>
                  </div>

                  <div className="file-quick-stats">
                    {file.additions !== undefined && file.deletions !== undefined && (
                      <div className="diff-stat">
                        <span className="diff-stat-add">+{file.additions}</span>
                        <span className="diff-stat-del">-{file.deletions}</span>
                      </div>
                    )}
                    {file.routes.length > 0 && (
                      <span className="tab-pill" style={{ color: "var(--accent-light)", background: "var(--accent-subtle)" }}>
                        {file.routes.length} route(s)
                      </span>
                    )}
                    {file.dependedOnBy.length > 0 && (
                      <span className="tab-pill">
                        {file.dependedOnBy.length} consumer(s)
                      </span>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="file-expanded-panel">
                    {/* Declared Exports */}
                    <div className="subpanel-card">
                      <div className="subpanel-title">
                        <span>Declared Exports</span>
                        <span className="tab-pill">{file.exports.length}</span>
                      </div>
                      {file.exports.length === 0 ? (
                        <div style={{ fontSize: "0.76rem", color: "var(--text-tertiary)" }}>No exported symbols detected.</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                          {file.exports.map((exp) => (
                            <span
                              key={exp.name}
                              className="chip"
                              style={{
                                borderColor: exp.signatureChanged ? "var(--signal-med-border)" : "var(--border-subtle)",
                                color: exp.signatureChanged ? "var(--signal-med)" : "var(--text-secondary)",
                                background: exp.signatureChanged ? "var(--signal-med-bg)" : "var(--bg-surface)",
                              }}
                              title={exp.signatureChanged ? "Export signature was altered between base and head" : undefined}
                            >
                              <span style={{ color: "var(--text-tertiary)", marginRight: "0.25rem" }}>{exp.kind}</span>
                              <strong>{exp.name}</strong>
                              {exp.signatureChanged && <span style={{ marginLeft: "0.25rem", fontSize: "0.65rem" }}>[MODIFIED]</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Detected Routes */}
                    {file.routes.length > 0 && (
                      <div className="subpanel-card">
                        <div className="subpanel-title">
                          <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                            <IconRoute size={13} />
                            <span>Routing Surface</span>
                          </span>
                          <span className="tab-pill">{file.routes.length}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                          {file.routes.map((rt, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.45rem",
                                fontSize: "0.78rem",
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              <span
                                className="badge"
                                style={{
                                  background: "var(--accent-subtle)",
                                  color: "var(--accent-light)",
                                  fontSize: "0.68rem",
                                  padding: "0.1rem 0.35rem",
                                }}
                              >
                                {rt.method}
                              </span>
                              <span style={{ color: "var(--text-primary)" }}>{rt.path}</span>
                              <span style={{ color: "var(--text-tertiary)", fontSize: "0.7rem" }}>(L{rt.line})</span>
                              {rt.framework && (
                                <span style={{ color: "var(--text-tertiary)", fontSize: "0.68rem" }}>
                                  [{rt.framework}]
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Direct Consumers */}
                    <div className="subpanel-card">
                      <div className="subpanel-title">
                        <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                          <IconBox size={13} />
                          <span>Direct Consumers</span>
                        </span>
                        <span className="tab-pill">{file.dependedOnBy.length}</span>
                      </div>
                      {file.dependedOnBy.length === 0 ? (
                        <div style={{ fontSize: "0.76rem", color: "var(--text-tertiary)" }}>No direct consumers in workspace.</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                          {file.dependedOnBy.map((consumer) => (
                            <span key={consumer} className="chip">
                              {consumer}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Targeted Tests */}
                    <div className="subpanel-card">
                      <div className="subpanel-title">
                        <span>Matched Test Files</span>
                        <span className="tab-pill">{file.testFiles.length}</span>
                      </div>
                      {file.testFiles.length === 0 ? (
                        <div style={{ fontSize: "0.76rem", color: "var(--text-tertiary)" }}>No direct test file matches found.</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                          {file.testFiles.map((tf) => (
                            <span
                              key={tf}
                              className="chip"
                              style={{ borderColor: "var(--signal-low-border)", color: "#34d399" }}
                            >
                              {tf}
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
