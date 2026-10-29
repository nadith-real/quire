import { completeObject } from "./llm.js";
import {
  PLANNER_SYSTEM,
  RESEARCH_SYSTEM,
  STRUCTURE_SYSTEM,
} from "./prompts.js";
import { layoutSchema, planSchema, researchSchema } from "./schemas.js";
import { dispatchCrew, runCrew } from "./crew.js";
import { touch } from "./sessions.js";

function note(session, role, content, extra = {}) {
  session.messages.push({
    id: `${Date.now()}-${session.messages.length}`,
    role,
    content,
    at: Date.now(),
    ...extra,
  });
}

function slugify(value, fallback = "document") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function normalizePlan(plan) {
  const documents = Array.isArray(plan.documents) && plan.documents.length
    ? plan.documents
    : [
        {
          id: "doc-1",
          title: plan.title || "Untitled",
          filename: slugify(plan.title) + ".md",
          purpose: plan.outcome || "Primary document",
          chapters: [{ id: "ch-1", title: "Overview", goal: "Cover the brief", topics: [] }],
        },
      ];

  const cleaned = documents.slice(0, 8).map((doc, i) => ({
    id: doc.id || `doc-${i + 1}`,
    title: doc.title || `Document ${i + 1}`,
    filename: (doc.filename || slugify(doc.title) + ".md").replace(/\.md$/i, "") + ".md",
    purpose: doc.purpose || "",
    chapters: (doc.chapters || []).slice(0, 10).map((ch, j) => ({
      id: ch.id || `ch-${j + 1}`,
      title: ch.title || `Chapter ${j + 1}`,
      goal: ch.goal || "",
      topics: Array.isArray(ch.topics) ? ch.topics : [],
    })),
  }));

  const needsFolder = cleaned.length > 1;
  return {
    title: plan.title || cleaned[0].title,
    summary: plan.summary || "",
    audience: plan.audience || "",
    outcome: plan.outcome || "",
    assumptions: plan.assumptions || [],
    openQuestions: plan.openQuestions || [],
    researchQueries: plan.researchQueries || [],
    documents: cleaned,
    folderName: needsFolder ? slugify(plan.folderName || plan.title, "quire-set") : "",
    needsFolder,
  };
}

export async function startPlanning(session, instruction) {
  touch(session, {
    phase: "planning",
    instruction,
    plan: null,
    research: null,
    layout: null,
    outline: null,
    crew: null,
    written: [],
  });
  note(session, "user", instruction);
  note(session, "system", "Planning the request. Breaking the brief into documents, chapters, and research angles.");

  const raw = await completeObject({
    system: PLANNER_SYSTEM,
    prompt: `User instruction:\n${instruction}\n\nKeep the JSON compact. Prefer 1-3 documents and 3-5 chapters each.`,
    schema: planSchema,
  });
  const plan = normalizePlan(raw);
  touch(session, { phase: "awaiting_structure", plan });
  note(
    session,
    "assistant",
    `I mapped this as ${plan.documents.length} markdown document${plan.documents.length === 1 ? "" : "s"}. Confirm the folder and file structure before I research.`,
    { gate: "structure", plan }
  );
  return session;
}

export async function confirmStructure(session, { approved, edits }) {
  if (session.phase !== "awaiting_structure") {
    throw new Error("Structure confirmation is not pending");
  }
  if (!approved) {
    touch(session, { phase: "idle" });
    note(session, "user", "Rejected the proposed structure.");
    note(session, "assistant", "Structure rejected. Send a new instruction when you are ready.");
    return session;
  }

  let plan = session.plan;
  if (edits && typeof edits === "object") {
    plan = normalizePlan({ ...plan, ...edits, documents: edits.documents || plan.documents });
  }
  touch(session, { plan, phase: "researching" });
  note(session, "user", "Confirmed folder and file structure.");
  note(session, "system", "Researching from the confirmed brief. No live web crawl — expanding your own details.");

  const research = await completeObject({
    system: RESEARCH_SYSTEM,
    prompt: JSON.stringify({ instruction: session.instruction, plan }, null, 2),
    schema: researchSchema,
  });
  touch(session, { research, phase: "awaiting_details" });
  note(
    session,
    "assistant",
    "Research notes are ready. Confirm the details and intended outcome before I lock the markdown plan.",
    { gate: "details", research }
  );
  return session;
}

export async function confirmDetails(session, { approved, notes }) {
  if (session.phase !== "awaiting_details") {
    throw new Error("Detail confirmation is not pending");
  }
  if (!approved) {
    touch(session, { phase: "awaiting_structure" });
    note(session, "user", notes || "Details need changes.");
    note(session, "assistant", "Tell me what to change, or confirm the structure again.");
    return session;
  }

  const extra = notes ? `\nUser corrections:\n${notes}` : "";
  touch(session, { phase: "revaluating" });
  note(session, "user", notes || "Confirmed research details.");
  note(session, "system", "Revaluating the outcome. Quire only writes markdown.");

  const layout = await completeObject({
    system: STRUCTURE_SYSTEM,
    prompt: JSON.stringify(
      {
        instruction: session.instruction,
        plan: session.plan,
        research: session.research,
        extra,
      },
      null,
      2
    ),
    schema: layoutSchema,
  });
  const docs = session.plan.documents;
  const needsFolder = docs.length > 1;
  const folder = needsFolder
    ? slugify(layout.folder || session.plan.folderName || session.plan.title, "quire-set")
    : "";

  const files = (layout.files || docs).map((file, i) => {
    const src = docs[i] || docs[0];
    const filename = (file.path || src.filename || slugify(src.title) + ".md")
      .split("/")
      .pop()
      .replace(/\.md$/i, "") + ".md";
    return {
      id: file.id || src.id,
      path: needsFolder ? `${folder}/${filename}` : filename,
      title: file.title || src.title,
      purpose: file.purpose || src.purpose,
      outline: file.outline || (src.chapters || []).map((ch) => ({
        id: ch.id,
        heading: `## ${ch.title}`,
        topics: ch.topics || [],
        substeps: ch.topics || [ch.goal].filter(Boolean),
      })),
    };
  });

  const outline = {
    mode: needsFolder ? "folder" : "single",
    folder,
    files,
  };

  touch(session, { layout: outline, outline, phase: "awaiting_layout" });
  note(
    session,
    "assistant",
    needsFolder
      ? `This is a multi-document set. I will create folder \`${folder}\` and ${files.length} markdown files.`
      : `This is a single document. I will create \`${files[0].path}\` in the vault root.`,
    { gate: "layout", outline }
  );
  return session;
}

export async function confirmLayout(session, { approved, edits }) {
  if (session.phase !== "awaiting_layout") {
    throw new Error("Layout confirmation is not pending");
  }
  if (!approved) {
    touch(session, { phase: "awaiting_details" });
    note(session, "user", "Rejected the vault layout.");
    note(session, "assistant", "Layout rejected. Confirm details again or send corrections.");
    return session;
  }

  let outline = session.outline;
  if (edits && edits.files) {
    outline = { ...outline, ...edits };
  }
  touch(session, { outline, phase: "outlining" });
  note(session, "user", "Confirmed vault layout.");
  note(session, "system", "Main agent splitting the goal into one task per file, then topic subtasks.");

  const detailed = {
    ...outline,
    files: outline.files.map((file) => ({
      ...file,
      outline: (file.outline || []).map((ch, i) => {
        const topics = ch.topics?.length
          ? ch.topics
          : (ch.substeps?.length ? ch.substeps : [ch.goal || ch.heading || `Topic ${i + 1}`]);
        return {
          ...ch,
          id: ch.id || `ch-${i + 1}`,
          heading: ch.heading || `## Chapter ${i + 1}`,
          topics,
          substeps: ch.substeps?.length
            ? ch.substeps
            : topics.map((t) => `Write a full subsection on: ${t}`),
        };
      }),
    })),
  };

  const crew = await dispatchCrew(detailed, {
    instruction: session.instruction,
    plan: session.plan,
    research: session.research,
  });

  const taskCount = crew.tasks.length;
  const subCount = crew.tasks.reduce((n, t) => n + t.subtasks.length, 0);

  touch(session, { outline: detailed, crew, phase: "awaiting_review" });
  note(
    session,
    "assistant",
    `Main agent assigned ${taskCount} file task${taskCount === 1 ? "" : "s"} and ${subCount} topic sub-agents. Review the roster, then they write one subtask at a time.`,
    { gate: "review", outline: detailed, crew }
  );
  return session;
}

export async function confirmReview(session, { approved }) {
  if (session.phase !== "awaiting_review") {
    throw new Error("Review confirmation is not pending");
  }
  if (!approved) {
    touch(session, { phase: "awaiting_layout" });
    note(session, "user", "Requested changes to the chapter plan.");
    note(session, "assistant", "Chapter plan paused. Confirm layout again after you describe changes.");
    return session;
  }

  if (session.writeLock) {
    throw new Error("Writing is already running");
  }
  touch(session, { phase: "writing", written: [] });
  note(session, "user", "Approved the writing plan.");
  note(session, "system", "Main agent launching sub-agents in sequence.");
  session.writeLock = runCrew(session)
    .catch((err) => {
      session.phase = "error";
      note(session, "assistant", String(err?.message || err));
      touch(session);
    })
    .finally(() => {
      session.writeLock = null;
    });
  return session;
}
