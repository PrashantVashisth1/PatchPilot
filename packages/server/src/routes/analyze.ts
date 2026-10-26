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
import { buildRepoGraph } from "../engine/graph.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const analyzeSchema = z.object({
  repoPath: z.string().min(1, "repoPath is required"),
  baseRef: z.string().min(1, "baseRef is required"),
  headRef: z.string().optional().default("HEAD"),
  maxFiles: z.number().int().positive().max(1000).optional().default(500),
  maxGraphFiles: z.number().int().positive().max(20000).optional().default(5000),
  maxTransitiveDepth: z.number().int().min(1).max(20).optional().default(5),
  maxConsumersPerTarget: z.number().int().min(1).max(10000).optional().default(200),
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

    const { repoPath, baseRef, headRef, maxFiles, maxGraphFiles, maxTransitiveDepth, maxConsumersPerTarget } = parsed.data;

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

    // 6. Repository-wide import graph at head (and base when needed for
    //    removed/renamed files). These drive reverse-dependency impact and
    //    test discovery. Best-effort: a failed/partial graph degrades impact
    //    analysis but never fails the request.
    const graph = trees.head
      ? await buildRepoGraph(repoPath, headRef, trees.head, { maxFiles: maxGraphFiles })
      : undefined;

    const needsBaseGraph = capped.files.some(
      (f) => f.status === "deleted" || f.status === "renamed",
    );
    const baseGraph =
      needsBaseGraph && trees.base
        ? await buildRepoGraph(repoPath, baseRef, trees.base, { maxFiles: maxGraphFiles })
        : undefined;

    const repoFiles = trees.head ? [...trees.head] : undefined;

    // 7. Run the analysis engine.
    const response = analyze({
      diff: capped,
      numstat,
      sources,
      trees,
      graph,
      baseGraph,
      repoFiles,
      maxTransitiveDepth,
      maxConsumersPerTarget,
    });

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