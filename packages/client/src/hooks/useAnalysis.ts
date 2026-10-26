import { useState, useCallback } from "react";
import type { AnalyzeResponse } from "@patchpilot/shared";

export interface AnalysisInput {
  repoPath: string;
  baseRef: string;
  headRef?: string;
}

export interface AnalysisErrorState {
  code?: string;
  message: string;
  details?: unknown;
}

/**
 * Hook managing a single POST /api/analyze flow.
 * Returns the report, loading state, error object, and control functions.
 */
export function useAnalysis() {
  const [report, setReport] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AnalysisErrorState | null>(null);

  const run = useCallback(async (input: AnalysisInput) => {
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: input.repoPath.trim(),
          baseRef: input.baseRef.trim() || "main",
          headRef: input.headRef?.trim() || "HEAD",
        }),
      });

      const json: unknown = await res.json();

      if (!res.ok) {
        const errObj = json as { error?: { code?: string; message?: string; details?: unknown } };
        setError({
          code: errObj.error?.code ?? `HTTP_${res.status}`,
          message: errObj.error?.message ?? `Request failed with HTTP ${res.status}`,
          details: errObj.error?.details,
        });
        return;
      }

      setReport(json as AnalyzeResponse);
    } catch (e: unknown) {
      setError({
        code: "NETWORK_ERROR",
        message: e instanceof Error ? e.message : "Network error communicating with PatchPilot server",
      });
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