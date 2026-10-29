import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"),
});
import {
  confirmDetails,
  confirmLayout,
  confirmReview,
  confirmStructure,
  startPlanning,
} from "./workflow.js";
import {
  createSession,
  getSession,
  publicSession,
} from "./sessions.js";
import { listVault, readMarkdown, searchVault, writeMarkdown } from "./files.js";
import { ensureVault } from "./paths.js";
import { getModelId } from "./llm.js";

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function requireSession(req, res) {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return session;
}

function friendlyError(err) {
  const msg = String(err?.message || err || "Unknown error");
  if (/json/i.test(msg) || /expected/i.test(msg) && /array|object/i.test(msg)) {
    return "The model returned a broken plan. Try a shorter brief, or send it again.";
  }
  if (/api key/i.test(msg) || /unauthorized/i.test(msg) || /401/.test(msg)) {
    return "OpenRouter rejected the key. Check USER_LLM_API_KEY in .env.";
  }
  return msg;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: getModelId(),
    hasKey: Boolean(process.env.USER_LLM_API_KEY),
  });
});

app.get("/api/vault", async (_req, res) => {
  try {
    res.json({ tree: await listVault() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/vault/search", async (req, res) => {
  try {
    res.json({ hits: await searchVault(req.query.q) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/vault/file", async (req, res) => {
  try {
    res.json(await readMarkdown(req.query.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/vault/file", async (req, res) => {
  try {
    const { path: rel, content } = req.body || {};
    res.json(await writeMarkdown(rel, content ?? ""));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/sessions", (_req, res) => {
  res.json(publicSession(createSession()));
});

app.get("/api/sessions/:id", (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  res.json(publicSession(session));
});

app.post("/api/sessions/:id/plan", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  try {
    const instruction = String(req.body?.instruction || "").trim();
    if (!instruction) {
      res.status(400).json({ error: "Instruction is required" });
      return;
    }
    await startPlanning(session, instruction);
    res.json(publicSession(session));
  } catch (err) {
    session.phase = "error";
    const message = friendlyError(err);
    session.messages.push({
      id: `${Date.now()}-err`,
      role: "assistant",
      content: message,
      at: Date.now(),
    });
    res.status(500).json({ error: message, session: publicSession(session) });
  }
});

const gates = [
  ["structure", confirmStructure],
  ["details", confirmDetails],
  ["layout", confirmLayout],
  ["review", confirmReview],
];

for (const [name, handler] of gates) {
  app.post(`/api/sessions/:id/${name}`, async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      await handler(session, req.body || {});
      res.json(publicSession(session));
    } catch (err) {
      session.phase = session.phase === "writing" ? "error" : session.phase;
      res.status(400).json({ error: friendlyError(err), session: publicSession(session) });
    }
  });
}

await ensureVault();

app.listen(port, "0.0.0.0", () => {
  console.log(`Quire agent on http://localhost:${port}`);
});
