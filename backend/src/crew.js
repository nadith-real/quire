import { complete, completeObject } from "./llm.js";
import { DISPATCH_SYSTEM, INTRO_SYSTEM, SUBAGENT_SYSTEM } from "./prompts.js";
import { dispatchSchema } from "./schemas.js";
import { createFolder, writeMarkdown } from "./files.js";
import { touch } from "./sessions.js";

const SPECIALISTS = [
  "Architect",
  "Researcher",
  "Explainer",
  "Analyst",
  "Editor",
  "Strategist",
  "Operator",
];

function note(session, role, content, extra = {}) {
  session.messages.push({
    id: `${Date.now()}-${session.messages.length}`,
    role,
    content,
    at: Date.now(),
    ...extra,
  });
}

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function stripFence(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  return (fenced ? fenced[1] : raw).trim();
}

function ensureHeading(markdown, heading, level = 3) {
  const body = stripFence(markdown);
  const wanted = heading.replace(/^#+\s*/, "").trim();
  const hashes = "#".repeat(level);
  if (/^#{1,6}\s+/.test(body)) return body;
  return `${hashes} ${wanted}\n\n${body}`;
}

export function fallbackDispatch(outline) {
  const files = outline?.files || [];
  return {
    tasks: files.map((file, i) => {
      const chapters = file.outline || [];
      const subtasks = [];
      chapters.forEach((ch, j) => {
        const topics = (ch.topics && ch.topics.length ? ch.topics : [ch.heading || `Topic ${j + 1}`]);
        topics.forEach((topic, k) => {
          subtasks.push({
            id: `${file.id || `doc-${i + 1}`}-ch${j + 1}-t${k + 1}`,
            chapterId: ch.id || `ch-${j + 1}`,
            chapter: (ch.heading || `Chapter ${j + 1}`).replace(/^#+\s*/, ""),
            heading: `### ${String(topic).replace(/^#+\s*/, "")}`,
            topic: String(topic).replace(/^#+\s*/, ""),
            agent: `${SPECIALISTS[(j + k) % SPECIALISTS.length]} · ${String(topic).replace(/^#+\s*/, "")}`,
            brief: `Write a full subsection on "${topic}" for ${(ch.heading || "").replace(/^#+\s*/, "")}. Include examples, constraints, and practical guidance.`,
            minWords: 420,
            status: "pending",
            words: 0,
            content: "",
          });
        });
      });
      return {
        id: `task-${i + 1}`,
        fileId: file.id || `doc-${i + 1}`,
        path: file.path,
        title: file.title,
        purpose: file.purpose || "",
        leadAgent: `Lead · ${file.title}`,
        status: "pending",
        subtasks,
      };
    }),
  };
}

function mergeDispatch(outline, dispatched) {
  const fallback = fallbackDispatch(outline);
  const incoming = Array.isArray(dispatched?.tasks) ? dispatched.tasks : [];
  return {
    tasks: fallback.tasks.map((task, i) => {
      const src = incoming[i] || {};
      const subs = (src.subtasks && src.subtasks.length ? src.subtasks : task.subtasks).map((st, k) => {
        const fb = task.subtasks[k] || task.subtasks[0] || {};
        return {
          id: st.id || fb.id || `${task.id}-st-${k + 1}`,
          chapterId: st.chapterId || fb.chapterId || `ch-${k + 1}`,
          chapter: st.chapter || fb.chapter || "Section",
          heading: st.heading || fb.heading || `### ${st.topic || "Topic"}`,
          topic: st.topic || fb.topic || "Topic",
          agent: st.agent || fb.agent || `${SPECIALISTS[k % SPECIALISTS.length]}`,
          brief: st.brief || fb.brief || `Write a full subsection on ${st.topic || "this topic"}.`,
          minWords: Number(st.minWords) > 200 ? Number(st.minWords) : 420,
          status: "pending",
          words: 0,
          content: "",
        };
      });
      return {
        ...task,
        leadAgent: src.leadAgent || task.leadAgent,
        subtasks: subs,
      };
    }),
  };
}

export async function dispatchCrew(outline, context) {
  try {
    const dispatched = await completeObject({
      system: DISPATCH_SYSTEM,
      prompt: JSON.stringify({ outline, ...context }, null, 2),
      schema: dispatchSchema,
    });
    return mergeDispatch(outline, dispatched);
  } catch {
    return fallbackDispatch(outline);
  }
}

async function writeIntro(session, task) {
  const text = await complete({
    system: INTRO_SYSTEM,
    prompt: [
      `User goal:\n${session.instruction}`,
      `Document title: ${task.title}`,
      `Purpose: ${task.purpose}`,
      `Chapters: ${task.subtasks.map((s) => s.chapter).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`,
      `Research:\n${JSON.stringify(session.research, null, 2)}`,
      "Write the H1 and a 180-280 word opening. Stop before the first H2.",
    ].join("\n\n"),
    maxTokens: 1200,
    temperature: 0.45,
  });
  const body = stripFence(text);
  if (/^#\s+/.test(body)) return body;
  return `# ${task.title}\n\n${body}`;
}

async function writeSubtask(session, task, subtask) {
  const siblings = task.subtasks
    .filter((s) => s.id !== subtask.id)
    .map((s) => `- ${s.chapter} / ${s.topic}`)
    .join("\n");
  const prior = task.subtasks
    .filter((s) => s.status === "done" && s.chapter === subtask.chapter)
    .map((s) => s.content)
    .join("\n\n")
    .slice(-1200);

  const text = await complete({
    system: SUBAGENT_SYSTEM,
    prompt: [
      `You are sub-agent: ${subtask.agent}`,
      `Main goal:\n${session.instruction}`,
      `File: ${task.title} (${task.path})`,
      `Chapter: ${subtask.chapter}`,
      `This subtask topic: ${subtask.topic}`,
      `Brief: ${subtask.brief}`,
      `Minimum words: ${subtask.minWords}`,
      `Other subtasks in this file (do not duplicate):\n${siblings || "(none)"}`,
      prior ? `Already written in this chapter (continue, do not repeat):\n${prior}` : "",
      `Research:\n${JSON.stringify(session.research, null, 2)}`,
      `Start with heading: ${subtask.heading}`,
    ].filter(Boolean).join("\n\n"),
    maxTokens: 2800,
    temperature: 0.5,
  });
  return ensureHeading(text, subtask.heading, 3);
}

function assembleFile(intro, task) {
  const chapters = [];
  const seen = new Set();
  for (const st of task.subtasks) {
    if (!seen.has(st.chapter)) {
      seen.add(st.chapter);
      chapters.push(`## ${st.chapter}`);
    }
    chapters.push(st.content || `### ${st.topic}\n\n_Section pending._`);
  }
  return `${intro.trim()}\n\n${chapters.join("\n\n")}\n`;
}

export async function runCrew(session) {
  const crew = session.crew;
  if (!crew?.tasks?.length) {
    throw new Error("No dispatched tasks");
  }

  const outline = session.outline;
  if (outline?.mode === "folder" && outline.folder) {
    await createFolder(outline.folder);
  }

  const written = [];

  for (const task of crew.tasks) {
    task.status = "running";
    touch(session, { crew, phase: "writing" });
    note(session, "system", `${task.leadAgent} opened task \`${task.path}\` with ${task.subtasks.length} sub-agents.`);

    const intro = await writeIntro(session, task);

    for (const subtask of task.subtasks) {
      subtask.status = "running";
      touch(session, { crew });
      note(session, "system", `${subtask.agent} writing “${subtask.topic}”.`);
      const content = await writeSubtask(session, task, subtask);
      subtask.content = content;
      subtask.words = wordCount(content);
      subtask.status = "done";
      touch(session, { crew });
      note(session, "system", `${subtask.agent} finished “${subtask.topic}” (${subtask.words} words).`);
    }

    const markdown = assembleFile(intro, task);
    const saved = await writeMarkdown(task.path, markdown);
    task.status = "done";
    written.push({ ...saved, title: task.title, words: wordCount(markdown) });
    touch(session, { crew, written });
    note(session, "system", `Saved \`${saved.path}\` (${wordCount(markdown)} words).`);
  }

  touch(session, { phase: "done", written, crew });
  note(
    session,
    "assistant",
    `Done. Main agent closed ${written.length} file${written.length === 1 ? "" : "s"} after ${crew.tasks.reduce((n, t) => n + t.subtasks.length, 0)} sub-agent passes.`,
    { written }
  );
  return session;
}
