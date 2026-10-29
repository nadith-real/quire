import { randomUUID } from "node:crypto";

const sessions = new Map();

export const PHASES = [
  "idle",
  "planning",
  "awaiting_structure",
  "researching",
  "awaiting_details",
  "revaluating",
  "awaiting_layout",
  "outlining",
  "awaiting_review",
  "writing",
  "done",
  "error",
];

export function createSession() {
  const id = randomUUID();
  const session = {
    id,
    phase: "idle",
    instruction: "",
    plan: null,
    research: null,
    layout: null,
    outline: null,
    crew: null,
    written: [],
    writeLock: null,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function touch(session, patch = {}) {
  Object.assign(session, patch, { updatedAt: Date.now() });
  return session;
}

function publicCrew(crew) {
  if (!crew?.tasks) return crew;
  return {
    tasks: crew.tasks.map((task) => ({
      id: task.id,
      fileId: task.fileId,
      path: task.path,
      title: task.title,
      purpose: task.purpose,
      leadAgent: task.leadAgent,
      status: task.status,
      subtasks: (task.subtasks || []).map((st) => ({
        id: st.id,
        chapterId: st.chapterId,
        chapter: st.chapter,
        heading: st.heading,
        topic: st.topic,
        agent: st.agent,
        brief: st.brief,
        minWords: st.minWords,
        status: st.status,
        words: st.words,
      })),
    })),
  };
}

function publicMessages(messages) {
  return (messages || []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    at: m.at,
    gate: m.gate,
    written: m.written,
  }));
}

export function publicSession(session) {
  return {
    id: session.id,
    phase: session.phase,
    instruction: session.instruction,
    plan: session.plan,
    research: session.research,
    layout: session.layout,
    outline: session.outline,
    crew: publicCrew(session.crew),
    written: session.written,
    messages: publicMessages(session.messages),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
