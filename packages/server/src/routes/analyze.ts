// ---------------------------------------------------------------------------
// POST /api/analyze — real Git analysis pipeline
// ---------------------------------------------------------------------------

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { badRequest } from "../utils/errors.js";
import {
  runGitDiff,
  runGitNumstat,
  listTreePaths,
} from "../services/git.service.js";
import { analyze } from "../engine/analyzer.js";
import { fetchSources } from "../engine/source-reader.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const analyzeSchema = z.object({
  repoPath: z.string().min(1, "repoPath is required"),
  baseRef: z.string().min(1, "baseRef is required"),
  headRef: z.string().optional().default("HEAD"),
  maxFiles: z.number().int().positive().max(1000).optional().default(500),
});

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Invalid request body", parsed.error.flatten());
    }

    const { repoPath, baseRef, headRef, maxFiles } = parsed.data;

    // 1. Git diff — this validates the repo, refs, and fetches changed files.
    const diff = await runGitDiff({ repoPath, baseRef, headRef });

    // 2. Cap file count to the configured limit.
    let capped = diff;
    if (diff.files.length > maxFiles) {
      capped = { ...diff, files: diff.files.slice(0, maxFiles) };
    }

    // 3. Per-file line statistics (best-effort, non-fatal).
    const numstat = await runGitNumstat(repoPath, baseRef, headRef);

    // 4. Base/head source content for changed JS/TS files. Reads content at
    //    the selected revisions, never the working tree.
    const sources = await fetchSources(repoPath, baseRef, headRef, capped.files);

    // 5. Repository path listing at both refs — the resolution oracle for
    //    relative imports. Best-effort: failures degrade resolution, they do
    //    not fail the analysis.
    const trees = {
      base: await safeTree(repoPath, baseRef),
      head: await safeTree(repoPath, headRef),
    };

    // 6. Run the analysis engine.
    const response = analyze({ diff: capped, numstat, sources, trees });

    res.json(response);
  } catch (err) {
    next(err);
  }
});

/** Best-effort tree listing; undefined means "no resolution data". */
async function safeTree(
  repoPath: string,
  ref: string,
): Promise<Set<string> | undefined> {
  try {
    return await listTreePaths(repoPath, ref);
  } catch {
    return undefined;
  }
}

export default router;