const PHASES = [
  ["planning", "Plan"],
  ["awaiting_structure", "Confirm structure"],
  ["researching", "Research"],
  ["awaiting_details", "Confirm details"],
  ["revaluating", "Revalue outcome"],
  ["awaiting_layout", "Confirm layout"],
  ["outlining", "Dispatch sub-agents"],
  ["awaiting_review", "Review roster"],
  ["writing", "Sub-agents write"],
  ["done", "Finish"],
];

const state = {
  health: null,
  session: null,
  tree: [],
  openFile: null,
  draft: "",
  busy: false,
  query: "",
  hits: [],
  poll: null,
};

const app = document.getElementById("app");

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "disabled") el.disabled = Boolean(v);
    else if (k === "value") el.value = v;
    else if (v != null) el.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function phaseIndex(phase) {
  return PHASES.findIndex(([id]) => id === phase);
}

function renderTree(nodes, depth = 0) {
  const wrap = h("div");
  for (const node of nodes) {
    const row = h("div", {
      class: `tree-item ${node.type} ${state.openFile === node.path ? "on" : ""}`,
      style: `padding-left:${6 + depth * 12}px`,
      onClick: async () => {
        if (node.type !== "file") return;
        const file = await api(`/api/vault/file?path=${encodeURIComponent(node.path)}`);
        state.openFile = file.path;
        state.draft = file.content;
        render();
      },
    }, [
      node.type === "folder" ? "▸" : "·",
      " ",
      node.name,
    ]);
    wrap.append(row);
    if (node.children?.length) wrap.append(renderTree(node.children, depth + 1));
  }
  return wrap;
}

function lastGate(session) {
  const msg = [...(session?.messages || [])].reverse().find((m) => m.gate);
  return msg || null;
}

function gatePanel(session) {
  const gate = lastGate(session);
  if (!gate || !["awaiting_structure", "awaiting_details", "awaiting_layout", "awaiting_review"].includes(session.phase)) {
    if (session?.phase === "writing") {
      return crewBoard(session, "Sub-agents are writing one topic at a time.");
    }
    if (session?.phase === "done") {
      return h("div", {}, [
        h("div", { class: "empty" }, "Task finished. Open a vault file to edit, or start a new brief."),
        session.crew ? crewBoard(session, "Final roster") : null,
      ]);
    }
    return h("div", { class: "empty" }, "Gates appear here when Quire needs your confirmation.");
  }

  const box = h("div", { class: "gate" });
  if (gate.gate === "structure" && session.plan) {
    const p = session.plan;
    box.append(
      h("h3", {}, "Confirm folder and files"),
      h("p", {}, p.summary),
      h("div", { class: "kv" }, [
        h("div", {}, [h("b", {}, "Audience: "), p.audience || "—"]),
        h("div", {}, [h("b", {}, "Outcome: "), p.outcome || "—"]),
        h("div", {}, [
          h("b", {}, "Layout: "),
          p.needsFolder ? `folder /${p.folderName}` : "single markdown file",
        ]),
      ]),
      ...p.documents.map((d) =>
        h("div", { class: "doc-card" }, [
          h("strong", {}, d.title),
          h("div", { class: "path" }, d.filename),
          h("div", { class: "muted" }, d.purpose),
          h("ul", { class: "list" }, d.chapters.map((c) => h("li", {}, `${c.title} — ${c.goal}`))),
        ])
      )
    );
    box.append(actions("structure"));
  }

  if (gate.gate === "details" && session.research) {
    const r = session.research;
    box.append(
      h("h3", {}, "Confirm researched details"),
      h("p", {}, "Quire expanded your brief. Markdown only. Confirm before layout."),
      h("div", { class: "muted" }, `Tone: ${r.recommendedTone || "professional"}`),
      h("ul", { class: "list" }, (r.findings || []).map((f) => h("li", {}, `${f.query}: ${f.insight}`))),
      (r.mustInclude || []).length
        ? h("p", {}, ["Must include: ", (r.mustInclude || []).join("; ")])
        : null
    );
    const notes = h("textarea", { placeholder: "Optional corrections before layout" });
    box.append(notes, actions("details", () => ({ notes: notes.value.trim() })));
  }

  if (gate.gate === "layout" && session.outline) {
    const o = session.outline;
    box.append(
      h("h3", {}, o.mode === "folder" ? "Create folder and files" : "Create one document"),
      h("p", {},
        o.mode === "folder"
          ? `More than one document. New folder \`${o.folder}\`.`
          : "One document. Written at the vault root."
      ),
      ...o.files.map((f) =>
        h("div", { class: "doc-card" }, [
          h("strong", {}, f.title),
          h("div", { class: "path" }, f.path),
          h("div", { class: "muted" }, f.purpose),
        ])
      )
    );
    box.append(actions("layout"));
  }

  if (gate.gate === "review") {
    box.append(
      h("h3", {}, "Review sub-agent roster"),
      h("p", {}, "Main agent split your goal into one task per file, then one sub-agent per topic. They write in sequence after you confirm.")
    );
    if (session.crew) box.append(crewBoard(session));
    box.append(actions("review"));
  }

  return box;
}

function crewBoard(session, caption) {
  const crew = session?.crew;
  if (!crew?.tasks?.length) return h("div", { class: "empty" }, "No dispatched tasks yet.");
  return h("div", { class: "crew" }, [
    h("h3", {}, "Crew"),
    caption ? h("p", { class: "muted" }, caption) : null,
    ...crew.tasks.flatMap((task) => [
      h("div", { class: "doc-card" }, [
        h("strong", {}, `${task.leadAgent} · ${task.title}`),
        h("div", { class: "path" }, `${task.path} · ${task.status || "pending"}`),
      ]),
      ...task.subtasks.map((st) =>
        h("div", { class: `subtask ${st.status || "pending"}` }, [
          h("span", { class: "mark" }),
          h("div", {}, [
            h("b", {}, st.topic),
            h("div", { class: "muted" }, `${st.agent} · ${st.chapter}`),
          ]),
          h("span", { class: "pill" }, st.words ? `${st.words}w` : st.status || "queued"),
        ])
      ),
    ]),
  ]);
}

function actions(name, extra = () => ({})) {
  return h("div", { class: "actions" }, [
    h("button", {
      class: "ok",
      disabled: state.busy,
      onClick: () => confirmGate(name, { approved: true, ...extra() }),
    }, "Confirm"),
    h("button", {
      class: "ghost",
      disabled: state.busy,
      onClick: () => confirmGate(name, { approved: false, ...extra() }),
    }, "Reject"),
  ]);
}

async function confirmGate(name, body) {
  if (!state.session) return;
  state.busy = true;
  render();
  try {
    state.session = await api(`/api/sessions/${state.session.id}/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    await refreshVault();
    if (state.session?.phase === "writing") startPoll();
  } catch (err) {
    alert(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

function stopPoll() {
  if (state.poll) {
    clearInterval(state.poll);
    state.poll = null;
  }
}

function startPoll() {
  stopPoll();
  state.poll = setInterval(async () => {
    if (!state.session?.id) return;
    try {
      const next = await api(`/api/sessions/${state.session.id}`);
      state.session = next;
      if (next.phase === "done" || next.phase === "error") {
        stopPoll();
        await refreshVault();
      }
      render();
    } catch {
      stopPoll();
    }
  }, 1600);
}

async function refreshVault() {
  const { tree } = await api("/api/vault");
  state.tree = tree;
}

function render() {
  app.innerHTML = "";
  const session = state.session;
  const idx = phaseIndex(session?.phase);

  const sidebar = h("aside", { class: "sidebar" }, [
    h("h1", { class: "brand" }, ["Quire", h("span", {}, ".")]),
    h("p", { class: "tagline" }, "A gathering of sheets. Confirm every gate."),
    h("div", { class: "status-chip" }, [
      h("span", { class: `dot ${state.health?.hasKey ? "ok" : "bad"}` }),
      state.health?.hasKey
        ? `OpenRouter · ${state.health.model}`
        : "Set USER_LLM_API_KEY in .env",
    ]),
    h("div", { class: "section-label" }, "Workflow"),
    h("ol", { class: "phases" }, PHASES.map(([id, label], i) =>
      h("li", { class: idx > i ? "done" : idx === i ? "active" : "" }, [
        h("span", { class: "n" }, String(i + 1)),
        label,
      ])
    )),
    h("div", { class: "section-label" }, "Vault"),
    h("input", {
      class: "search",
      placeholder: "Search markdown",
      value: state.query,
      onInput: async (e) => {
        state.query = e.target.value;
        if (!state.query.trim()) {
          state.hits = [];
          render();
          return;
        }
        const { hits } = await api(`/api/vault/search?q=${encodeURIComponent(state.query)}`);
        state.hits = hits;
        render();
      },
    }),
    h("div", { class: "tree" }, [
      state.hits.length
        ? state.hits.map((hit) =>
            h("div", {
              class: "tree-item file",
              onClick: async () => {
                const file = await api(`/api/vault/file?path=${encodeURIComponent(hit.path)}`);
                state.openFile = file.path;
                state.draft = file.content;
                render();
              },
            }, [`${hit.path}:${hit.line}  ${hit.text}`])
          )
        : state.tree.length
          ? renderTree(state.tree)
          : h("div", { class: "muted" }, "Empty vault. Confirm a plan to write files."),
    ]),
  ]);

  const messages = h("div", { class: "messages" },
    (session?.messages || []).map((m) => h("div", { class: `bubble ${m.role}` }, m.content))
  );

  const input = h("textarea", {
    placeholder: session?.phase && session.phase !== "idle" && session.phase !== "done"
      ? "Wait for the current gate, or type a fresh brief after finish."
      : "Describe the document you need. Quire only writes markdown.",
    disabled: state.busy,
  });

  const send = async () => {
    const instruction = input.value.trim();
    if (!instruction || state.busy) return;
    state.busy = true;
    render();
    try {
      const created = await api("/api/sessions", { method: "POST" });
      state.session = await api(`/api/sessions/${created.id}/plan`, {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
    } catch (err) {
      alert(err.message);
    } finally {
      state.busy = false;
      render();
    }
  };

  const chat = h("main", { class: "chat" }, [
    h("div", { class: "chat-head" }, [
      h("h2", {}, "Brief"),
      h("span", { class: "muted" }, session?.phase || "idle"),
    ]),
    messages,
    h("div", { class: "composer" }, [
      input,
      h("button", { disabled: state.busy, onClick: send }, state.busy ? "Working" : "Plan"),
    ]),
  ]);

  const inspectorKids = [h("div", { class: "section-label" }, "Confirmation"), gatePanel(session)];
  if (state.openFile) {
    inspectorKids.push(
      h("div", { class: "section-label" }, "File"),
      h("div", { class: "editor" }, [
        h("header", {}, [
          h("span", { class: "path" }, state.openFile),
          h("button", {
            class: "ghost",
            onClick: async () => {
              await api("/api/vault/file", {
                method: "PUT",
                body: JSON.stringify({ path: state.openFile, content: state.draft }),
              });
            },
          }, "Save"),
        ]),
        h("textarea", {
          value: state.draft,
          onInput: (e) => { state.draft = e.target.value; },
        }),
      ])
    );
  }

  app.append(sidebar, chat, h("aside", { class: "inspector" }, inspectorKids));
  messages.scrollTop = messages.scrollHeight;
}

async function boot() {
  try {
    state.health = await api("/api/health");
  } catch {
    state.health = { ok: false, hasKey: false, model: "offline" };
  }
  try {
    await refreshVault();
  } catch {
    state.tree = [];
  }
  render();
}

boot();
