// ---------------------------------------------------------------------------
// PatchPilot server — entry point (binds port)
// ---------------------------------------------------------------------------

import app from "./app.js";

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`PatchPilot server listening on http://localhost:${PORT}`);
});