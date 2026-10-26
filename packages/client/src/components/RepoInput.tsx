import { useState, type FC, type FormEvent } from "react";

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

const RepoInput: FC<RepoInputProps> = ({
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
    <div className="repo-form-card" id="repo-input-card">
      <form onSubmit={handleSubmit}>
        <div className="repo-form-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="input-repo-path">
              <span>Local Repository Path</span>
              <span style={{ color: "var(--risk-high)", fontWeight: 700 }}>*</span>
            </label>
            <input
              id="input-repo-path"
              type="text"
              className="form-input"
              value={repoPath}
              onChange={(e) => {
                onRepoPathChange(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="e.g. C:\projects\my-app or /home/user/repo"
              disabled={disabled}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="input-base-ref">
              <span>Base Ref</span>
              <span style={{ color: "var(--risk-high)", fontWeight: 700 }}>*</span>
            </label>
            <input
              id="input-base-ref"
              type="text"
              className="form-input"
              value={baseRef}
              onChange={(e) => {
                onBaseRefChange(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="main or HEAD~1"
              disabled={disabled}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="input-head-ref">
              <span>Head Ref</span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>(default: HEAD)</span>
            </label>
            <input
              id="input-head-ref"
              type="text"
              className="form-input"
              value={headRef}
              onChange={(e) => onHeadRefChange(e.target.value)}
              placeholder="HEAD"
              disabled={disabled}
            />
          </div>

          <div>
            <button
              id="btn-analyze"
              type="submit"
              className="btn-primary"
              disabled={disabled || !repoPath.trim() || !baseRef.trim()}
            >
              {disabled ? (
                <>
                  <span className="spinner" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <span>⚡ Analyze Changes</span>
                </>
              )}
            </button>
          </div>
        </div>

        {validationError && (
          <div style={{ marginTop: "0.75rem", color: "var(--risk-high)", fontSize: "0.82rem" }}>
            ⚠️ {validationError}
          </div>
        )}

        <div className="quick-examples">
          <span>Quick base refs:</span>
          <button
            type="button"
            className="quick-tag"
            onClick={() => onBaseRefChange("main")}
            disabled={disabled}
          >
            main
          </button>
          <button
            type="button"
            className="quick-tag"
            onClick={() => onBaseRefChange("master")}
            disabled={disabled}
          >
            master
          </button>
          <button
            type="button"
            className="quick-tag"
            onClick={() => onBaseRefChange("HEAD~1")}
            disabled={disabled}
          >
            HEAD~1
          </button>
          <button
            type="button"
            className="quick-tag"
            onClick={() => onBaseRefChange("HEAD~2")}
            disabled={disabled}
          >
            HEAD~2
          </button>
        </div>
      </form>
    </div>
  );
};

export default RepoInput;