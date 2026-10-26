import { useState, type FC, type FormEvent } from "react";
import { IconSearch, IconGitBranch, IconGitCommit, IconShield } from "./icons";

interface RepoInputProps {
  repoPath: string;
  baseRef: string;
  headRef: string;
  onRepoPathChange: (val: string) => void;
  onBaseRefChange: (val: string) => void;
  onHeadRefChange: (val: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}

export const RepoInput: FC<RepoInputProps> = ({
  repoPath,
  baseRef,
  headRef,
  onRepoPathChange,
  onBaseRefChange,
  onHeadRefChange,
  onSubmit,
  disabled,
}) => {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!repoPath.trim()) {
      setValidationError("Repository path is required");
      return;
    }
    if (!baseRef.trim()) {
      setValidationError("Base ref is required");
      return;
    }
    setValidationError(null);
    onSubmit();
  };

  return (
    <div className="command-bar-card" id="repo-input-card">
      <form onSubmit={handleSubmit}>
        <div className="command-grid">
          {/* Repository Path Input */}
          <div className="field-group">
            <label className="field-label" htmlFor="input-repo-path">
              <span>Local Git Repository</span>
              <span style={{ color: "var(--signal-high)", fontSize: "0.85em" }}>*</span>
            </label>
            <div className="field-input-wrapper">
              <span className="field-input-icon">
                <IconSearch size={14} />
              </span>
              <input
                id="input-repo-path"
                type="text"
                className="text-input"
                value={repoPath}
                onChange={(e) => {
                  onRepoPathChange(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="Absolute path e.g. C:\projects\my-app"
                disabled={disabled}
                autoComplete="off"
                spellCheck="false"
              />
            </div>
          </div>

          {/* Base Ref Input */}
          <div className="field-group">
            <label className="field-label" htmlFor="input-base-ref">
              <span>Base Ref</span>
              <span style={{ color: "var(--signal-high)", fontSize: "0.85em" }}>*</span>
            </label>
            <div className="field-input-wrapper">
              <span className="field-input-icon">
                <IconGitBranch size={14} />
              </span>
              <input
                id="input-base-ref"
                type="text"
                className="text-input"
                value={baseRef}
                onChange={(e) => {
                  onBaseRefChange(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="main or HEAD~1"
                disabled={disabled}
                autoComplete="off"
                spellCheck="false"
              />
            </div>
          </div>

          {/* Head Ref Input */}
          <div className="field-group">
            <label className="field-label" htmlFor="input-head-ref">
              <span>Head Ref</span>
              <span style={{ color: "var(--text-tertiary)", fontSize: "0.7rem" }}>(default: HEAD)</span>
            </label>
            <div className="field-input-wrapper">
              <span className="field-input-icon">
                <IconGitCommit size={14} />
              </span>
              <input
                id="input-head-ref"
                type="text"
                className="text-input"
                value={headRef}
                onChange={(e) => onHeadRefChange(e.target.value)}
                placeholder="HEAD"
                disabled={disabled}
                autoComplete="off"
                spellCheck="false"
              />
            </div>
          </div>

          {/* Action CTA */}
          <div>
            <button
              id="btn-analyze"
              type="submit"
              className="btn-run"
              disabled={disabled || !repoPath.trim() || !baseRef.trim()}
            >
              {disabled ? (
                <>
                  <svg className="spinner-svg" width={14} height={14} viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span>Analyzing Diff...</span>
                </>
              ) : (
                <>
                  <span>Analyze Diff</span>
                  <span style={{ opacity: 0.6, fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>↵</span>
                </>
              )}
            </button>
          </div>
        </div>

        {validationError && (
          <div style={{ marginTop: "0.6rem", color: "var(--signal-high)", fontSize: "0.78rem" }}>
            {validationError}
          </div>
        )}

        {/* Quick helpers and security guarantee */}
        <div className="quick-bar">
          <div className="quick-chips">
            <span className="quick-label">Compare presets:</span>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onBaseRefChange("main");
                onHeadRefChange("HEAD");
              }}
              disabled={disabled}
            >
              main...HEAD
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onBaseRefChange("master");
                onHeadRefChange("HEAD");
              }}
              disabled={disabled}
            >
              master...HEAD
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onBaseRefChange("HEAD~1");
                onHeadRefChange("HEAD");
              }}
              disabled={disabled}
            >
              HEAD~1...HEAD
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onBaseRefChange("HEAD~2");
                onHeadRefChange("HEAD");
              }}
              disabled={disabled}
            >
              HEAD~2...HEAD
            </button>
          </div>

          <div className="security-note">
            <IconShield size={13} />
            <span>Deterministic AST analysis • Zero repository code execution</span>
          </div>
        </div>
      </form>
    </div>
  );
};

export default RepoInput;