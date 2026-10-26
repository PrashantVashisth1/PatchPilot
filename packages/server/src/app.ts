// ---------------------------------------------------------------------------
// PatchPilot server — Express app (no listen)
//
// Separated from index.ts so tests can import the app without binding a port.
// ---------------------------------------------------------------------------

import express, { type Request, type Response, type NextFunction } from "express";
import analyzeRouter from "./routes/analyze.js";
import { AppError } from "./utils/errors.js";
import type { ErrorResponse } from "@patchpilot/shared";

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/api/analyze", analyzeRouter);

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  console.error("Unhandled error:", err);
  const body: ErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  };
  res.status(500).json(body);
});

export default app;