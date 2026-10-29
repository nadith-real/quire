import { extractJson, parseLoose } from "./json.js";

const broken = [
  "{",
  '  "title": "Guide",',
  '  "documents": [',
  "    {",
  '      "id": "doc-1",',
  '      "title": "Intro",',
  '      "filename": "intro.md",',
  '      "purpose": "say "hello" to the reader",',
  '      "chapters": [',
  '        { "id": "ch-1", "title": "One", "goal": "cover it", "topics": ["a",] }',
  "      ]",
  "    },",
].join("\n");

const repaired = parseLoose(broken);
if (repaired.documents[0].id !== "doc-1") {
  throw new Error("repair failed");
}
if (!String(repaired.documents[0].purpose).includes("hello")) {
  throw new Error("inner quote repair failed");
}

const fenced = extractJson("```json\n{\"ok\": true,}\n```");
if (fenced.ok !== true) {
  throw new Error("fenced repair failed");
}

console.log("json repair ok");
