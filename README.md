# Quire

A Node.js document crew. One main agent breaks a goal into file tasks, then assigns a sub-agent to every topic. They write markdown, in sequence, into `vault/`.

Quire uses the Vercel AI SDK against OpenRouter. It only writes `.md` files.

## Workflow

1. You send an instruction.
2. Quire plans documents, chapters, and research angles.
3. You confirm folder and file structure.
4. Quire researches from your brief (no live crawl).
5. You confirm details and intended outcome.
6. Quire revalues the result. Markdown only.
7. One file is written at vault root. Multiple files get a new folder.
8. The main agent splits work: one task per file, one sub-agent per topic.
9. You review the roster. Sub-agents write, one subtask at a time. Task finishes.

## Setup

Copy `.env.example` to `.env` and set your OpenRouter key:

```bash
cp .env.example .env
```

Required:

```bash
USER_LLM_API_KEY=your-openrouter-api-key-here
USER_LLM_BASE_URL=https://openrouter.ai/api/v1
USER_LLM_MODEL=openai/gpt-4o-mini
```

## Run

Install dependencies in both apps first. `node_modules` is not committed.

Windows (PowerShell):

```powershell
cd backend
npm install
cd ..\frontend
npm install
npm run dev
```

In a second terminal:

```powershell
cd backend
npm run dev
```

Or from the repo root:

```powershell
.\start.cmd
```

macOS / Linux:

```bash
chmod +x start.sh
./start.sh
```

Frontend: `http://localhost:5173`  
API: `http://localhost:3001`

The frontend proxies `/api` to the backend. If you see `vite is not recognized`, you skipped `npm install` in `frontend`.

## Vault

All generated markdown lives in `vault/`. The studio can search, open, and save files. Paths cannot leave the vault, and non-markdown writes are rejected.
