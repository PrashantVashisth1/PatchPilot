import { useState, useCallback } from "react";
import type { AnalyzeResponse } from "@patchpilot/shared";

interface AnalysisInput {
  repoPath: string;
  baseRef: string;
  headRef?: string;
}

/**
 * Hook managing a single POST /api/analyze flow.
 * Returns the report, loading state, error message, and control functions.
 */
export function useAnalysis() {
  const [report, setReport] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (input: AnalysisInput) => {
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: input.repoPath,
          baseRef: input.baseRef,
          headRef: input.headRef ?? "HEAD",
        }),
      });

      const json: unknown = await res.json();

      if (!res.ok) {
        const err = json as { error?: { message?: string } };
        setError(err.error?.message ?? `HTTP ${res.status}`);
        return;
      }

      setReport(json as AnalyzeResponse);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setReport(null);
    setError(null);
  }, []);

  return { report, loading, error, run, reset };
}