// ================= UniShare frontend =================
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "щойно";
  if (s < 3600) return `${Math.floor(s / 60)} хв`;
  if (s < 86400) return `${Math.floor(s / 3600)} год`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} д`;
  return new Date(t).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
};
const toast = (msg) => {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
};

// ---------- Іконки ----------
const P = {
  home: "M12 3 3 10v11h6v-7h6v7h6V10l-9-7z",
  explore: "M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z",
  note: "M6 2h9l5 5v15H6V2zm2 2v16h10V8h-4V4H8zm2 7h6v2h-6v-2zm0 4h6v2h-6v-2z",
  question: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 11h2v2h-2v-2zm1-9a3.5 3.5 0 0 1 1.2 6.8c-.4.2-.2.4-.2 1.2h-2c0-1.6.4-2.3 1.4-2.8A1.5 1.5 0 1 0 10.5 9.5h-2A3.5 3.5 0 0 1 12 6z",
  lab: "M9 2h6v2h-1v5.3l5.6 9.8A2 2 0 0 1 17.9 22H6.1a2 2 0 0 1-1.7-2.9L10 9.3V4H9V2zm3 9.2L8.6 17h6.8L12 11.2z",
  exam: "M4 4h16v13H4V4zm2 2v9h12V6H6zm-3 13h18v2H3v-2zm5-11h8v2H8V8zm0 3h5v2H8v-2z",
  subjects: "M4 5h7v6H4V5zm9 0h7v6h-7V5zM4 13h7v6H4v-6zm9 0h7v6h-7v-6z",
  bell: "M12 2a7 7 0 0 1 7 7v4l2 4H3l2-4V9a7 7 0 0 1 7-7zm0 2a5 5 0 0 0-5 5v4.5L6.2 15h11.6L17 13.5V9a5 5 0 0 0-5-5zm-2.5 15h5a2.5 2.5 0 0 1-5 0z",
  ai: "M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z",
  bookmark: "M6 2h12v20l-6-4.5L6 22V2zm2 2v14l4-3 4 3V4H8z",
  user: "M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 10c4.4 0 8 2.2 8 5v3H4v-3c0-2.8 3.6-5 8-5zm0 2c-3.3 0-6 1.4-6 3v1h12v-1c0-1.6-2.7-3-6-3z",
  reply: "M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-7l-6 4v-4H5a3 3 0 0 1-3-3V5zm3-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v2.3L11.4 16H19a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H5z",
  heart: "M12 21s-8-5-10-10C.5 7 3 3 7 3c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6.5 4 5 8-2 5-10 10-10 10z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z",
  clip: "M16.5 6v11.5a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6H9v9.5a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v12.5a6 6 0 0 0 12 0V6h-1.5z",
  back: "M7.4 13l5.6 5.6-1.4 1.4-8-8 8-8 1.4 1.4L7.4 11H21v2H7.4z",
  send: "M2 21l21-9L2 3v7l15 2-15 2v7z",
};
const icon = (n, fill) => `<svg viewBox="0 0 24 24"><path d="${P[n]}" fill="${fill || "currentColor"}"/></svg>`;

const TYPES = {
  note: { label: "Конспект", icon: "note", plural: "Конспекти" },
  question: { label: "Питання", icon: "question", plural: "Питання" },
  lab: { label: "Лабораторна", icon: "lab", plural: "Лабораторні" },
  exam: { label: "Екзамен", icon: "exam", plural: "Екзамени" },
  post: { label: "Допис", icon: "reply", plural: "Дописи" },
};

const NAV = [
  { href: "#/", label: "Головна", icon: "home" },
  { href: "#/explore", label: "Огляд", icon: "explore" },
  { href: "#/notes", label: "Конспекти", icon: "note" },
  { href: "#/questions", label: "Питання", icon: "question" },
  { href: "#/labs", label: "Лабораторні", icon: "lab" },
  { href: "#/exams", label: "Екзамени", icon: "exam" },
  { href: "#/subjects", label: "Предмети", icon: "subjects" },
  { href: "#/notifications", label: "Сповіщення", icon: "bell", badge: true },
  { href: "#/ai", label: "AI-помічник", icon: "ai" },
  { href: "#/saved", label: "Збережене", icon: "bookmark" },
  { href: "#/profile", label: "Профіль", icon: "user" },
];

let me = null;
const avatar = (u, cls = "") => `<div class="avatar ${cls}" style="background:${esc(u.color || "#536471")}">${esc(u.avatar || u.name?.[0] || "?")}</div>`;

// ---------- Ліве меню ----------
function renderNav(path) {
  const notif = Number(sessionStorage.getItem("notifCount") || 0);
  $("#nav").innerHTML = NAV.map((n) => {
    const active = n.href === "#" + path || (n.href === "#/" && path === "/");
    return `<a href="${n.href}" class="${active ? "active" : ""}">${icon(n.icon)}${n.badge && notif ? `<i class="badge">${notif}</i>` : ""}<span>${n.label}</span></a>`;
  }).join("");
  $("#bottomNav").innerHTML = ["#/", "#/explore", "#/ai", "#/notifications", "#/profile"]
    .map((h) => `<a href="${h}">${icon(NAV.find((n) => n.href === h).icon)}</a>`).join("");
}

// ---------- Пост ----------
function postHtml(p, full = false) {
  const t = TYPES[p.type] || TYPES.post;
  return `<article class="post" data-id="${p.id}">
    ${avatar(p.author)}
    <div class="content">
      <div class="head"><b>${esc(p.author.name)}</b><span class="muted">@${esc(p.author.handle)}${p.author.group ? " · " + esc(p.author.group) : ""} · ${ago(p.createdAt)}</span></div>
      <div class="head" style="margin-top:4px">
        <span class="type-tag t-${p.type}">${t.label}</span>
        <a class="type-tag t-post" href="#/subject/${encodeURIComponent(p.subject)}" data-stop>${esc(p.subject)}</a>
        ${p.type === "question" && p.solved ? `<span class="type-tag solved">✓ Розв'язано</span>` : ""}
      </div>
      ${p.title ? `<div class="title">${esc(p.title)}</div>` : ""}
      <div class="body">${esc(full ? p.body : p.body.length > 280 ? p.body.slice(0, 280) + "…" : p.body)}</div>
      ${p.tags?.length ? `<div class="tags">${p.tags.map((g) => `<a href="#/explore?q=${encodeURIComponent(g)}" data-stop>#${esc(g)}</a>`).join("")}</div>` : ""}
      ${p.attachment ? `<div class="attach"><div class="ico">📄</div><div><div class="n">${esc(p.attachment.name)}</div><div class="muted" style="font-size:13px">${esc(p.attachment.size || "")}</div></div></div>` : ""}
      <div class="stats">
        <button data-act="open" title="Відповісти">${icon("reply")}${p.comments.length || ""}</button>
        <button class="like ${p.liked ? "on" : ""}" data-act="like" title="Корисно">${icon("heart", p.liked ? "var(--pink)" : "none").replace('fill="none"', 'fill="none" stroke="currentColor" stroke-width="1.8"')}${p.likes || ""}</button>
        ${p.type === "question" && p.author.handle === me?.handle ? `<button data-act="solve" title="Позначити розв'язаним">${icon("check")}${p.solved ? "Розв'язано" : ""}</button>` : ""}
        <button data-act="ai" title="Розібрати з AI">${icon("ai")}AI</button>
        <button class="save ${p.saved ? "on" : ""}" data-act="save" title="Зберегти">${icon("bookmark")}</button>
      </div>
    </div>
  </article>`;
}

function bindPosts(root, reload) {
  root.querySelectorAll(".post").forEach((el) => {
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-stop]")) return;
      const btn = e.target.closest("[data-act]");
      const id = el.dataset.id;
      if (!btn) return (location.hash = `#/post/${id}`);
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "open") return (location.hash = `#/post/${id}`);
      if (act === "ai") {
        const p = await api(`/api/posts?q=`).then((all) => all.find((x) => x.id === id));
        sessionStorage.setItem("aiPrefill", `Допоможи розібратися (${p.subject}).\n\n${p.title ? p.title + "\n" : ""}${p.body}`);
        return (location.hash = "#/ai");
      }
      const updated = await api(`/api/posts/${id}/${act}`, { method: "POST" });
      if (act === "save") toast(updated.saved ? "Додано до збереженого" : "Видалено зі збереженого");
      reload ? reload() : el.outerHTML = postHtml(updated);
      if (!reload) bindPosts(root);
    });
  });
}

// ---------- Форма публікації ----------
function composerHtml(defaultType = "post") {
  return `<div class="composer">
    ${avatar(me)}
    <form class="fields" id="composeForm">
      <div class="row">
        <select class="chip-select" name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === defaultType ? "selected" : ""}>${v.label}</option>`).join("")}</select>
        <input class="subject-in" name="subject" placeholder="Предмет" list="subjectsDl" />
        <datalist id="subjectsDl"></datalist>
      </div>
      <input class="title-in" name="title" placeholder="Заголовок (необов'язково)" maxlength="200" />
      <textarea name="body" rows="2" placeholder="${defaultType === "question" ? "Опиши, що саме не виходить…" : "Чим хочеш поділитися?"}"></textarea>
      <input name="tags" placeholder="#теги через пробіл" style="font-size:14px;color:var(--accent)" />
      <div class="actions">
        <div class="row">
          <label class="icon-btn" title="Прикріпити файл">${icon("clip")}<input type="file" name="file" hidden /></label>
          <span class="file-pill" data-file></span>
        </div>
        <button class="btn-accent" type="submit" disabled>Опублікувати</button>
      </div>
    </form>
  </div>`;
}

function bindComposer(root, onDone) {
  const f = $("#composeForm", root);
  if (!f) return;
  api("/api/subjects").then((s) => { $("#subjectsDl", root).innerHTML = s.map((x) => `<option value="${esc(x.name)}">`).join(""); });
  const ta = f.body, btn = f.querySelector("button[type=submit]");
  ta.addEventListener("input", () => { btn.disabled = !ta.value.trim(); ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; });
  let attachment = null;
  f.file.addEventListener("change", () => {
    const file = f.file.files[0];
    if (!file) return;
    const kb = file.size / 1024;
    attachment = { name: file.name, size: kb > 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.ceil(kb) + " KB" };
    $("[data-file]", f).textContent = "📎 " + file.name;
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    await api("/api/posts", { method: "POST", body: {
      type: f.type.value, subject: f.subject.value.trim() || "Загальне", title: f.title.value.trim(), body: ta.value.trim(), attachment,
      tags: f.tags.value.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean),
    } });
    toast("Опубліковано!");
    onDone?.();
  });
}

$("#openCompose").addEventListener("click", () => {
  $("#composeSlot").innerHTML = composerHtml();
  bindComposer($("#composeSlot"), () => { $("#composeDialog").close(); route(); });
  $("#composeDialog").showModal();
});

// ---------- Сторінки ----------
async function feedPage(main, { title, sub, query = {}, defaultType, tabs, banner }) {
  let tab = 0;
  const draw = async () => {
    const q = { ...query, ...(tabs ? tabs[tab].query : {}) };
    let posts = await api("/api/posts?" + new URLSearchParams(q));
    if (tabs?.[tab].filter) posts = posts.filter(tabs[tab].filter);
    $("#feed", main).innerHTML = posts.length ? posts.map((p) => postHtml(p)).join("") : `<div class="empty"><h3>Поки порожньо</h3>Стань першим, хто поділиться матеріалом!</div>`;
    bindPosts($("#feed", main), draw);
  };
  main.innerHTML = `
    <div class="top">
      ${tabs ? `<div class="tabs">${tabs.map((t, i) => `<button data-tab="${i}" class="${i === tab ? "active" : ""}"><span>${t.label}</span></button>`).join("")}</div>`
             : `<h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}`}
    </div>
    ${defaultType !== null ? composerHtml(defaultType || "post") : ""}
    ${banner || ""}
    <div id="feed"><div class="empty">Завантаження…</div></div>`;
  main.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    tab = Number(b.dataset.tab);
    main.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  }));
  bindComposer(main, () => route());
  await draw();
}

async function postPage(main, id) {
  const all = await api("/api/posts");
  const p = all.find((x) => x.id === id);
  if (!p) { main.innerHTML = `<div class="empty"><h3>Пост не знайдено</h3></div>`; return; }
  main.innerHTML = `
    <div class="top back"><a class="icon-btn" style="color:var(--text)" href="javascript:history.back()">${icon("back")}</a><h2>${TYPES[p.type].label}</h2></div>
    <div class="thread">${postHtml(p, true)}</div>
    <form class="reply-box" id="replyForm">${avatar(me)}<textarea name="text" placeholder="${p.type === "question" ? "Поясни хід розв'язання…" : "Напиши відповідь"}"></textarea><button class="btn-accent">Відповісти</button></form>
    <div id="comments">${p.comments.map((c) => `
      <div class="comment">${avatar(c.author)}<div><div class="head"><b>${esc(c.author.name)}</b> <span class="muted">@${esc(c.author.handle)} · ${ago(c.createdAt)}</span></div><div class="t">${esc(c.text)}</div></div></div>`).join("") ||
      `<div class="empty" style="padding:24px">Відповідей ще немає. ${p.type === "question" ? "Допоможи колезі!" : ""}</div>`}</div>`;
  bindPosts($(".thread", main), () => postPage(main, id));
  $("#replyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    await api(`/api/posts/${id}/comments`, { method: "POST", body: { text } });
    postPage(main, id);
  });
}

async function subjectsPage(main) {
  const subs = await api("/api/subjects");
  main.innerHTML = `<div class="top"><h2>Предмети</h2><div class="sub">Матеріали, згруповані за дисциплінами</div></div>
    ${subs.map((s) => `<a class="subject-row" href="#/subject/${encodeURIComponent(s.name)}" style="border-bottom:1px solid var(--border)"><div><b>${esc(s.name)}</b><br><small>${s.count} матеріал(ів)</small></div><span class="muted">›</span></a>`).join("")}`;
}

async function explorePage(main, q) {
  main.innerHTML = `<div class="top"><form class="search" id="exForm" style="margin:8px 16px">${icon("explore")}<input name="q" value="${esc(q || "")}" placeholder="Пошук: предмет, тема, #тег, автор" autofocus /></form>
    <div class="tabs">${["all", "note", "question", "lab", "exam"].map((t, i) => `<button data-t="${t}" class="${i === 0 ? "active" : ""}"><span>${t === "all" ? "Усе" : TYPES[t].plural}</span></button>`).join("")}</div></div>
    <div id="feed"></div>`;
  let type = "";
  const draw = async () => {
    const posts = await api("/api/posts?" + new URLSearchParams({ q: $("#exForm").q.value, ...(type ? { type } : {}) }));
    $("#feed").innerHTML = posts.map((p) => postHtml(p)).join("") || `<div class="empty"><h3>Нічого не знайдено</h3>Спробуй інший запит або запитай AI-помічника.</div>`;
    bindPosts($("#feed"), draw);
  };
  $("#exForm").addEventListener("submit", (e) => { e.preventDefault(); draw(); });
  $("#exForm").q.addEventListener("input", debounce(draw, 250));
  main.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => {
    type = b.dataset.t === "all" ? "" : b.dataset.t;
    main.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  }));
  draw();
}

async function notificationsPage(main) {
  const items = await api("/api/notifications");
  sessionStorage.setItem("notifSeen", String(items.length));
  sessionStorage.setItem("notifCount", "0");
  renderNav("/notifications");
  main.innerHTML = `<div class="top"><h2>Сповіщення</h2></div>` + (items.length
    ? items.map((n) => `<div class="notif">${avatar(n.who, "sm")}<div><b>${esc(n.who.name)}</b> відповів(ла) на «${esc(n.post)}»<br><span>${esc(n.text)}</span><br><small>${ago(n.at)}</small></div></div>`).join("")
    : `<div class="empty"><h3>Поки нічого</h3>Коли хтось відповість на твої питання чи матеріали — ти побачиш це тут.</div>`);
}

async function profilePage(main) {
  main.innerHTML = `<div class="top"><h2>${esc(me.name)}</h2></div>
    <div style="height:140px;background:linear-gradient(135deg,var(--accent),var(--accent-2))"></div>
    <div style="padding:0 16px 16px;border-bottom:1px solid var(--border)">
      <div class="avatar" style="width:110px;height:110px;font-size:42px;margin-top:-55px;border:4px solid var(--bg);background:${me.color}">${esc(me.avatar)}</div>
      <h2 style="margin:10px 0 0">${esc(me.name)}</h2><div class="muted">@${esc(me.handle)} · ${esc(me.group || "")}</div>
    </div><div id="feed"></div>`;
  const posts = await api("/api/posts?author=" + me.handle);
  $("#feed").innerHTML = posts.map((p) => postHtml(p)).join("") || `<div class="empty"><h3>Ти ще нічого не публікував(ла)</h3>Поділися конспектом або постав питання.</div>`;
  bindPosts($("#feed"), () => profilePage(main));
}

// ---------- AI-помічник ----------
const aiHistory = JSON.parse(sessionStorage.getItem("aiHistory") || "[]");
const md = (s) => (window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(s)) : esc(s).replace(/\n/g, "<br>"));

function aiPage(main) {
  const SUGGESTS = [
    ["Поясни крок за кроком", "як розв'язати інтеграл ∫x·eˣ dx"],
    ["Допоможи з лабою", "нормалізація таблиці до 3НФ"],
    ["Знайди помилку в коді", "алгоритм Дейкстри на C++"],
    ["Підготуй до екзамену", "10 питань з фізики для самоперевірки"],
  ];
  main.innerHTML = `<div class="ai-wrap">
    <div class="top"><h2>AI-помічник</h2><div class="sub">Розбирає завдання, пояснює хід розв'язання · Claude API</div></div>
    <div class="ai-msgs" id="aiMsgs"></div>
    <form class="ai-input" id="aiForm">
      <textarea name="q" rows="1" placeholder="Запитай про будь-яке завдання…"></textarea>
      <button class="btn-accent" title="Надіслати">Надіслати</button>
    </form></div>`;
  const box = $("#aiMsgs"), form = $("#aiForm"), ta = form.q;
  const draw = () => {
    box.innerHTML = aiHistory.length
      ? aiHistory.map((m) => `<div class="msg ${m.role}">${m.role !== "user" ? `<div class="avatar sm ai">AI</div>` : ""}<div class="bubble">${m.role === "user" ? esc(m.content) : md(m.content)}</div></div>`).join("")
      : `<div class="ai-hello"><div class="avatar ai">✦</div><h3>Чим допомогти?</h3><div class="muted">Я не просто дам відповідь — поясню, як до неї дійти.</div></div>
         <div class="suggests">${SUGGESTS.map(([a, b]) => `<button data-s="${esc(a + ": " + b)}"><b>${a}</b><span>${b}</span></button>`).join("")}</div>`;
    box.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => send(b.dataset.s)));
    box.scrollTop = box.scrollHeight;
  };
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = ta.value.trim(); if (q) send(q); });

  let busy = false;
  async function send(text) {
    if (busy) return;
    busy = true; ta.value = ""; ta.style.height = "auto";
    aiHistory.push({ role: "user", content: text });
    draw();
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    wrap.innerHTML = `<div class="avatar sm ai">AI</div><div class="bubble typing"></div>`;
    box.append(wrap);
    const bubble = $(".bubble", wrap);
    let answer = "";
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: aiHistory.filter((m) => m.role !== "error") }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const part of parts) {
          const ev = (part.match(/^event: (.*)$/m) || [])[1];
          const data = JSON.parse((part.match(/^data: (.*)$/m) || [])[1] || "{}");
          if (ev === "delta") { answer += data.text; bubble.innerHTML = md(answer); box.scrollTop = box.scrollHeight; }
          if (ev === "error") throw new Error(data.error);
        }
      }
      aiHistory.push({ role: "assistant", content: answer || "_(порожня відповідь)_" });
    } catch (err) {
      if (answer) aiHistory.push({ role: "assistant", content: answer });
      aiHistory.push({ role: "error", content: "⚠️ " + err.message });
    }
    sessionStorage.setItem("aiHistory", JSON.stringify(aiHistory.slice(-40)));
    busy = false;
    draw();
  }
  draw();
  const pre = sessionStorage.getItem("aiPrefill");
  if (pre) { sessionStorage.removeItem("aiPrefill"); send(pre); }
  else ta.focus();
}

// ---------- Права колонка ----------
async function loadNews() {
  try {
    const { live, items } = await api("/api/news");
    $("#newsLive").textContent = live ? "наживо" : "демо";
    $("#newsLive").className = "live" + (live ? " on" : "");
    $("#newsList").innerHTML = items.slice(0, 6).map((n) => `
      <a class="news-item" href="${esc(n.link)}" target="_blank" rel="noopener">
        <div class="nt">${esc(n.title)}</div>
        <div class="nm">${ago(n.date)} · ${esc(n.source || "")}</div>
      </a>`).join("") || `<div class="muted pad">Новин немає</div>`;
  } catch { $("#newsList").innerHTML = `<div class="muted pad">Не вдалося завантажити новини</div>`; }
}
async function loadSubjects() {
  const subs = await api("/api/subjects");
  $("#subjectsList").innerHTML = subs.slice(0, 5).map((s) => `<a class="subject-row" href="#/subject/${encodeURIComponent(s.name)}"><div><small>Предмет</small><br><b>${esc(s.name)}</b><br><small>${s.count} матеріал(ів)</small></div><span class="muted">⋯</span></a>`).join("");
}
$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); location.hash = "#/explore?q=" + encodeURIComponent($("#searchInput").value); });

async function checkNotifs() {
  const items = await api("/api/notifications").catch(() => []);
  const seen = Number(sessionStorage.getItem("notifSeen") || 0);
  sessionStorage.setItem("notifCount", String(Math.max(0, items.length - seen)));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- Роутер ----------
async function route() {
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(qs || "");
  renderNav(path);
  const main = $("#main");
  document.querySelector(".fab").style.display = path === "/ai" ? "none" : "";
  window.scrollTo(0, 0);
  const banner = `<div class="banner"><h3>Застряг на завданні?</h3><p>Постав питання спільноті або розбери його з AI-помічником.</p>
    <div class="btns"><a href="#/questions">Поставити питання</a><a href="#/ai">Запитати AI</a></div></div>`;

  if (path === "/") return feedPage(main, { defaultType: "post", banner, tabs: [
    { label: "Для вас", query: {} },
    { label: "Без відповіді", query: { type: "question" }, filter: (p) => !p.solved },
  ] });
  if (path === "/explore") return explorePage(main, params.get("q"));
  if (path === "/notes") return feedPage(main, { title: "Конспекти", sub: "Лекції, шпаргалки, навчальні матеріали", query: { type: "note" }, defaultType: "note" });
  if (path === "/questions") return feedPage(main, { title: "Питання", sub: "Запитуй — спільнота допоможе розібратися", query: { type: "question" }, defaultType: "question" });
  if (path === "/labs") return feedPage(main, { title: "Лабораторні", sub: "Приклади виконаних лабораторних робіт", query: { type: "lab" }, defaultType: "lab" });
  if (path === "/exams") return feedPage(main, { title: "Екзамени", sub: "Білети, відповіді, підготовка до сесії", query: { type: "exam" }, defaultType: "exam" });
  if (path === "/subjects") return subjectsPage(main);
  if (path.startsWith("/subject/")) { const s = decodeURIComponent(path.slice(9)); return feedPage(main, { title: s, sub: "Усі матеріали з предмета", query: { subject: s }, defaultType: null }); }
  if (path === "/notifications") return notificationsPage(main);
  if (path === "/ai") return aiPage(main);
  if (path === "/saved") return feedPage(main, { title: "Збережене", sub: "Матеріали, які ти зберіг(ла)", query: { saved: 1 }, defaultType: null });
  if (path === "/profile") return profilePage(main);
  if (path.startsWith("/post/")) return postPage(main, path.slice(6));
  main.innerHTML = `<div class="empty"><h3>Сторінку не знайдено</h3><a class="btn-accent" href="#/">На головну</a></div>`;
}

(async function init() {
  me = await api("/api/me");
  $("#meCard").innerHTML = `${avatar(me)}<div class="info"><div class="name">${esc(me.name)}</div><div class="muted">@${esc(me.handle)}</div></div><span class="dots muted" style="margin-left:auto">⋯</span>`;
  $("#meCard").addEventListener("click", () => (location.hash = "#/profile"));
  await checkNotifs();
  window.addEventListener("hashchange", route);
  route();
  loadNews();
  loadSubjects();
})();
