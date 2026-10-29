import fs from "node:fs/promises";
import path from "node:path";
import {
  assertFolderPath,
  assertMarkdownPath,
  ensureVault,
  VAULT_ROOT,
  walkMarkdown,
} from "./paths.js";

export async function listVault() {
  await ensureVault();
  return walkMarkdown();
}

export async function readMarkdown(relPath) {
  const { abs, rel } = assertMarkdownPath(relPath);
  const content = await fs.readFile(abs, "utf8");
  return { path: rel, content };
}

export async function writeMarkdown(relPath, content) {
  const { abs, rel } = assertMarkdownPath(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return { path: rel, bytes: Buffer.byteLength(content, "utf8") };
}

export async function createFolder(relPath) {
  const { abs, rel } = assertFolderPath(relPath);
  await fs.mkdir(abs, { recursive: true });
  return { path: rel };
}

export async function searchVault(query) {
  await ensureVault();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const hits = [];

  async function scan(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(abs, rel);
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        const content = await fs.readFile(abs, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, i) => {
          if (line.toLowerCase().includes(q)) {
            hits.push({ path: rel, line: i + 1, text: line.trim().slice(0, 240) });
          }
        });
      }
    }
  }

  await scan(VAULT_ROOT, "");
  return hits.slice(0, 80);
}
