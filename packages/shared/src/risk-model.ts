// ---------------------------------------------------------------------------
// PatchPilot — deterministic risk-scoring model
//
// Design principles:
//   1. Every finding must cite at least one piece of Evidence.
//   2. Verified facts (start) contribute the core score; inferred facts
//      (end) are additive but capped so guesswork can never dominate.
//   3. All weights are explicit here — nothing is buried in engine code.
// ---------------------------------------------------------------------------

import type { Finding, FindingSeverity, RiskScore, RiskLabel } from "./types.js";

// ---------------------------------------------------------------------------
// Weights (verified facts)
// ---------------------------------------------------------------------------

/** Contribution weight for verified (deterministic) findings. */
const VERIFIED_WEIGHTS: Record<string, number> = {
  "zero-tests": 0.30,
  "few-tests": 0.10,
  "high-fan-in": 0.25,
  "export-signature-changed": 0.20,
  "package-config-changed": 0.15,
  "large-diff": 0.10,
  "file-deleted": 0.15,
  "file-renamed": 0.05,
};

// ---------------------------------------------------------------------------
// Weights (inferred / heuristic)
// ---------------------------------------------------------------------------

const INFERRED_WEIGHTS: Record<string, number> = {
  "route-file-changed": 0.15,
  "core-module-changed": 0.10,
  "broad-import-tree": 0.08,
  "no-readme": 0.02,
};

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/** Maximum contribution from inferred findings (40% of total). */
const INFERENCE_CAP = 0.40;

/** Minimum number of files changed before "large-diff" finding fires. */
const LARGE_DIFF_THRESHOLD = 30;

// ---------------------------------------------------------------------------
// Scoring engine
// ---------------------------------------------------------------------------

/**
 * Compute a risk score from a flat list of Findings.
 *
 * Methodology:
 *   - Sum verified contributions.
 *   - Sum inferred contributions, capped at INFERENCE_CAP of total.
 *   - Multiply by 100 and clamp to [0, 100].
 *   - Map value to label.
 */
export function computeRiskScore(findings: Finding[]): RiskScore {
  let verifiedSum = 0;
  let inferredSum = 0;

  for (const f of findings) {
    const isVerified = f.evidence.every(
      (e) => e.classification === "verified"
    );
    if (isVerified) {
      verifiedSum += f.contribution * f.confidence;
    } else {
      inferredSum += f.contribution * f.confidence;
    }
  }

  // Cap inferences
  inferredSum = Math.min(inferredSum, INFERENCE_CAP);

  let raw = verifiedSum + inferredSum;
  raw = Math.min(raw, 1.0);
  const value = Math.round(raw * 100);

  return {
    value,
    label: scoreToLabel(value),
    findings,
  };
}

function scoreToLabel(value: number): RiskLabel {
  if (value >= 60) return "high";
  if (value >= 30) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Finding constructors
// ---------------------------------------------------------------------------

/**
 * Factory for creating a Finding with the correct weight and evidence.
 * Each function declares which weight it uses so scoring is transparent.
 */
export interface FindingTemplate {
  id: string;
  severity: FindingSeverity;
  weightKey: string;
}

function makeFinding(
  template: FindingTemplate,
  evidence: Finding["evidence"],
  confidence = 1.0,
): Finding {
  const weights =
    evidence[0]?.classification === "verified"
      ? VERIFIED_WEIGHTS
      : INFERRED_WEIGHTS;
  const contribution = weights[template.weightKey] ?? 0;

  return {
    id: template.id,
    severity: template.severity,
    contribution,
    confidence: Math.min(confidence, 1.0),
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Verified finding templates
// ---------------------------------------------------------------------------

export const FINDING_ZERO_TESTS: FindingTemplate = {
  id: "zero-tests",
  severity: "high",
  weightKey: "zero-tests",
};

export const FINDING_FEW_TESTS: FindingTemplate = {
  id: "few-tests",
  severity: "medium",
  weightKey: "few-tests",
};

export const FINDING_HIGH_FAN_IN: FindingTemplate = {
  id: "high-fan-in",
  severity: "high",
  weightKey: "high-fan-in",
};

export const FINDING_EXPORT_SIGNATURE_CHANGED: FindingTemplate = {
  id: "export-signature-changed",
  severity: "high",
  weightKey: "export-signature-changed",
};

export const FINDING_PACKAGE_CONFIG_CHANGED: FindingTemplate = {
  id: "package-config-changed",
  severity: "medium",
  weightKey: "package-config-changed",
};

export const FINDING_LARGE_DIFF: FindingTemplate = {
  id: "large-diff",
  severity: "medium",
  weightKey: "large-diff",
};

export const FINDING_FILE_DELETED: FindingTemplate = {
  id: "file-deleted",
  severity: "medium",
  weightKey: "file-deleted",
};

export const FINDING_FILE_RENAMED: FindingTemplate = {
  id: "file-renamed",
  severity: "low",
  weightKey: "file-renamed",
};

// ---------------------------------------------------------------------------
// Inferred finding templates
// ---------------------------------------------------------------------------

export const FINDING_ROUTE_FILE_CHANGED: FindingTemplate = {
  id: "route-file-changed",
  severity: "medium",
  weightKey: "route-file-changed",
};

export const FINDING_CORE_MODULE_CHANGED: FindingTemplate = {
  id: "core-module-changed",
  severity: "medium",
  weightKey: "core-module-changed",
};

export const FINDING_BROAD_IMPORT_TREE: FindingTemplate = {
  id: "broad-import-tree",
  severity: "low",
  weightKey: "broad-import-tree",
};

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { makeFinding, LARGE_DIFF_THRESHOLD, VERIFIED_WEIGHTS, INFERRED_WEIGHTS, INFERENCE_CAP };