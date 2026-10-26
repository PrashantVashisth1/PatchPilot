import { useState } from "react";
import RepoInput from "./components/RepoInput";
import RiskReport from "./components/RiskReport";
import { useAnalysis } from "./hooks/useAnalysis";

export default function App() {
  const [repoPath, setRepoPath] = useState("");
  const [baseRef, setBaseRef] = useState("main");
  const { report, loading, error, run, reset } = useAnalysis();

  const handleSubmit = () => {
    run({ repoPath, baseRef });
  };

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>PatchPilot</h1>
      <p>Analyze Git changes, identify regression risks, and get evidence-backed review reports.</p>

      <RepoInput
        repoPath={repoPath}
        baseRef={baseRef}
        onRepoPathChange={setRepoPath}
        onBaseRefChange={setBaseRef}
        onSubmit={handleSubmit}
        disabled={loading}
      />

      {error && (
        <div style={{ padding: "1rem", marginTop: "1rem", background: "#fff0f0", border: "1px solid #e00", borderRadius: 4 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {report && <RiskReport report={report} onReset={reset} />}
    </main>
  );
}