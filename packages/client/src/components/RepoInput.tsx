import type { FC } from "react";

interface RepoInputProps {
  repoPath: string;
  baseRef: string;
  onRepoPathChange: (val: string) => void;
  onBaseRefChange: (val: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}

const RepoInput: FC<RepoInputProps> = ({
  repoPath,
  baseRef,
  onRepoPathChange,
  onBaseRefChange,
  onSubmit,
  disabled,
}) => {
  return (
    <fieldset style={{ border: "1px solid #ccc", borderRadius: 6, padding: "1rem", marginTop: "1.5rem" }}>
      <legend>Repository</legend>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          Local repo path:
          <input
            type="text"
            value={repoPath}
            onChange={(e) => onRepoPathChange(e.target.value)}
            placeholder="C:\projects\my-repo"
            disabled={disabled}
            style={{ width: "100%", padding: "0.4rem", marginTop: "0.25rem", boxSizing: "border-box" }}
          />
        </label>
        <label>
          Base ref:
          <input
            type="text"
            value={baseRef}
            onChange={(e) => onBaseRefChange(e.target.value)}
            placeholder="main"
            disabled={disabled}
            style={{ width: "100%", padding: "0.4rem", marginTop: "0.25rem", boxSizing: "border-box" }}
          />
        </label>
        <button type="button" onClick={onSubmit} disabled={disabled || !repoPath || !baseRef}>
          {disabled ? "Analyzing..." : "Analyze"}
        </button>
      </div>
    </fieldset>
  );
};

export default RepoInput;