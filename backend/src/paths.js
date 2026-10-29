import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, "..", "..");
export const VAULT_ROOT = path.resolve(
  process.env.WORKSPACE_DIR || path.join(PROJECT_ROOT, "vault")
);

export function assertMarkdownPath(relPath) {
  if (!relPath || typeof relPath !== "string") {
    throw new Error("Path is required");
  }
  const normalized = relPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.includes("\0") || normalized.split("/").includes("..")) {
    throw new Error("Invalid path");
  }
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new Error("Quire only writes markdown files");
  }
  const abs = path.resolve(VAULT_ROOT, normalized);
  const root = VAULT_ROOT.endsWith(path.sep) ? VAULT_ROOT : VAULT_ROOT + path.sep;
  if (abs !== VAULT_ROOT && !abs.startsWith(root)) {
    throw new Error("Path escapes the vault");
  }
  return { abs, rel: normalized };
}

export function assertFolderPath(relPath) {
  if (!relPath || typeof relPath !== "string") {
    throw new Error("Folder is required");
  }
  const normalized = relPath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error("Invalid folder");
  }
  const abs = path.resolve(VAULT_ROOT, normalized);
  const root = VAULT_ROOT.endsWith(path.sep) ? VAULT_ROOT : VAULT_ROOT + path.sep;
  if (abs !== VAULT_ROOT && !abs.startsWith(root)) {
    throw new Error("Path escapes the vault");
  }
  return { abs, rel: normalized };
}

export async function ensureVault() {
  await fs.mkdir(VAULT_ROOT, { recursive: true });
}

export async function walkMarkdown(dir = VAULT_ROOT, prefix = "") {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({
        type: "folder",
        name: entry.name,
        path: rel,
        children: await walkMarkdown(path.join(dir, entry.name), rel),
      });
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      const stat = await fs.stat(path.join(dir, entry.name));
      nodes.push({
        type: "file",
        name: entry.name,
        path: rel,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }
  return nodes;
}
