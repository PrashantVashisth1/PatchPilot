import type { FC } from "react";
import type { AnalyzeResponse } from "@patchpilot/shared";

interface RiskReportProps {
  report: AnalyzeResponse;
  onReset: () => void;
}

const riskColors: Record<string, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
};

const RiskReport: FC<RiskReportProps> = ({ report, onReset }) => {
  const { summary, files, recommendations, errors } = report;

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Analysis Report</h2>

      {/* Summary bar */}
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          padding: "1rem",
          background: "#f8f9fa",
          borderRadius: 6,
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong>Risk Score:</strong>{" "}
          <span style={{ color: riskColors[summary.riskScore.label] ?? "#999", fontWeight: 700 }}>
            {summary.riskScore.value}/100 ({summary.riskScore.label})
          </span>
        </div>
        <div><strong>Files:</strong> {summary.totalFilesChanged}</div>
        <div><strong>Tests:</strong> {summary.testsRecommended}</div>
        <div><strong>Errors:</strong> {summary.errorCount}</div>
      </div>

      {/* Findings detail */}
      {summary.riskScore.findings.length > 0 && (
        <>
          <h3>Findings</h3>
          <ul style={{ paddingLeft: "1.25rem" }}>
            {summary.riskScore.findings.map((f) => (
              <li key={f.id} style={{ marginBottom: "0.5rem" }}>
                <span style={{ color: riskColors[f.severity] ?? "#999", fontWeight: 600 }}>
                  [{f.severity}]
                </span>{" "}
                <strong>{f.id}</strong> (confidence: {Math.round(f.confidence * 100)}%)
                <ul style={{ paddingLeft: "1.25rem", marginTop: "0.25rem" }}>
                  {f.evidence.map((e, i) => (
                    <li key={i}>
                      [{e.classification}] {e.description} <em>({e.file})</em>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* File table */}
      {files.length > 0 && (
        <>
          <h3>Changed Files</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f0f0f0" }}>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Path</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Status</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Depended On By</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Tests</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.path} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "0.4rem" }}><code>{f.path}</code></td>
                  <td style={{ padding: "0.4rem" }}>{f.status}</td>
                  <td style={{ padding: "0.4rem" }}>{f.dependedOnBy.length}</td>
                  <td style={{ padding: "0.4rem" }}>{f.testFiles.length > 0 ? f.testFiles.join(", ") : "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <>
          <h3>Test Recommendations</h3>
          {recommendations.map((r, i) => (
            <details key={i} style={{ marginBottom: "0.5rem" }}>
              <summary>
                <code>{r.changedFile}</code> &rarr; {r.recommendedTests.length} test(s)
              </summary>
              <p><strong>Reason:</strong> {r.reason}</p>
              <ol>
                {r.verificationSteps.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
            </details>
          ))}
        </>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <>
          <h3>Non-fatal Errors</h3>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                <code>{e.file}</code>: [{e.code}] {e.message}
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" onClick={onReset} style={{ marginTop: "1rem" }}>
        New Analysis
      </button>
    </section>
  );
};

export default RiskReport;