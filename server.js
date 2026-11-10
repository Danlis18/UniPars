import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, "data", "db.json");
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(here, "public")));

// ---------- Простенька JSON-база ----------
async function readDb() {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, "utf8"));
  } catch {
    const seed = JSON.parse(await fs.readFile(path.join(here, "data", "seed.json"), "utf8"));
    await writeDb(seed);
    return seed;
  }
}
async function writeDb(db) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------- Пости (конспекти, питання, лаби, екзамени) ----------
const TYPES = ["note", "question", "lab", "exam", "post"];

app.get("/api/posts", async (req, res) => {
  const db = await readDb();
  let posts = db.posts;
  const { type, subject, q, author, saved } = req.query;
  if (type) posts = posts.filter((p) => p.type === type);
  if (subject) posts = posts.filter((p) => p.subject === subject);
  if (author) posts = posts.filter((p) => p.author.handle === author);
  if (saved) posts = posts.filter((p) => p.saved);
  if (q) {
    const s = String(q).toLowerCase();
    posts = posts.filter((p) =>
      [p.title, p.body, p.subject, p.author.name, ...(p.tags || [])].join(" ").toLowerCase().includes(s)
    );
  }
  res.json(posts.sort((a, b) => b.createdAt - a.createdAt));
});

app.get("/api/subjects", async (_req, res) => {
  const db = await readDb();
  const counts = {};
  for (const p of db.posts) counts[p.subject] = (counts[p.subject] || 0) + 1;
  res.json(Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
});

app.post("/api/posts", async (req, res) => {
  const { type = "post", title = "", body = "", subject = "Загальне", tags = [], attachment } = req.body || {};
  if (!TYPES.includes(type)) return res.status(400).json({ error: "Невідомий тип" });
  if (!String(body).trim()) return res.status(400).json({ error: "Порожній пост" });
  const db = await readDb();
  const post = {
    id: crypto.randomUUID(),
    type,
    title: String(title).slice(0, 200),
    body: String(body).slice(0, 5000),
    subject: String(subject).slice(0, 80) || "Загальне",
    tags: Array.isArray(tags) ? tags.slice(0, 8).map(String) : [],
    attachment: attachment || null,
    author: db.me,
    createdAt: Date.now(),
    likes: 0,
    liked: false,
    saved: false,
    solved: false,
    comments: [],
  };
  db.posts.push(post);
  await writeDb(db);
  res.status(201).json(post);
});

app.post("/api/posts/:id/:action(like|save|solve)", async (req, res) => {
  const db = await readDb();
  const post = db.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Не знайдено" });
  const a = req.params.action;
  if (a === "like") {
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
  } else if (a === "save") post.saved = !post.saved;
  else post.solved = !post.solved;
  await writeDb(db);
  res.json(post);
});

app.post("/api/posts/:id/comments", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Порожня відповідь" });
  const db = await readDb();
  const post = db.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Не знайдено" });
  post.comments.push({ id: crypto.randomUUID(), author: db.me, text: text.slice(0, 3000), createdAt: Date.now() });
  await writeDb(db);
  res.json(post);
});

app.get("/api/me", async (_req, res) => res.json((await readDb()).me));

app.get("/api/notifications", async (_req, res) => {
  const db = await readDb();
  const mine = db.posts.filter((p) => p.author.handle === db.me.handle);
  const items = [];
  for (const p of mine)
    for (const c of p.comments)
      if (c.author.handle !== db.me.handle)
        items.push({ kind: "comment", who: c.author, text: c.text, post: p.title || p.body.slice(0, 60), at: c.createdAt });
  res.json(items.sort((a, b) => b.at - a.at));
});

// ---------- Новини університету (RSS -> JSON) ----------
let newsCache = { at: 0, items: [] };
const decode = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .trim();
const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")) || [])[1]);

function parseRss(xml, source) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => ({
    title: tag(b, "title"),
    link: tag(b, "link") || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "#",
    date: Date.parse(tag(b, "pubDate") || tag(b, "updated") || tag(b, "published")) || Date.now(),
    summary: tag(b, "description").slice(0, 160),
    source,
  }));
}

app.get("/api/news", async (_req, res) => {
  const urls = (process.env.NEWS_RSS_URL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!urls.length) {
    const db = await readDb();
    return res.json({ live: false, items: db.news });
  }
  if (Date.now() - newsCache.at < 10 * 60 * 1000 && newsCache.items.length)
    return res.json({ live: true, items: newsCache.items });
  try {
    const all = await Promise.all(
      urls.map(async (u) => {
        const r = await fetch(u, { headers: { "User-Agent": "UniShare/1.0" }, signal: AbortSignal.timeout(8000) });
        return parseRss(await r.text(), new URL(u).hostname);
      })
    );
    const items = all.flat().filter((i) => i.title).sort((a, b) => b.date - a.date).slice(0, 15);
    newsCache = { at: Date.now(), items };
    res.json({ live: true, items });
  } catch (e) {
    const db = await readDb();
    res.json({ live: false, error: String(e.message || e), items: db.news });
  }
});

// ---------- AI-помічник (Claude API, стрімінг через SSE) ----------
const SYSTEM_PROMPT = `Ти — AI-помічник платформи UniShare для студентів університету.
Допомагаєш розібратися з навчальними завданнями: лабораторними, задачами, конспектами, підготовкою до екзаменів.
Пояснюй хід розв'язання крок за кроком, щоб студент зрозумів матеріал, а не лише отримав відповідь.
Для коду давай робочі приклади з коментарями; для математики — формули і проміжні кроки.
Відповідай мовою користувача (за замовчуванням — українською). Використовуй Markdown.`;

let anthropic = null;
function getClient() {
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

app.post("/api/ai/chat", async (req, res) => {
  const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user")
    return res.status(400).json({ error: "Потрібне повідомлення користувача" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const stream = getClient().beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages,
    });
    req.on("close", () => stream.abort());
    stream.on("text", (delta) => send("delta", { text: delta }));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal")
      send("delta", { text: "\n\n_На жаль, я не можу допомогти з цим запитом._" });
    send("done", { stop_reason: final.stop_reason });
  } catch (err) {
    let msg = "Помилка AI-сервісу.";
    if (err instanceof Anthropic.AuthenticationError || /credentials|api key/i.test(String(err?.message)))
      msg = "AI не налаштовано: додайте ANTHROPIC_API_KEY у файл .env і перезапустіть сервер.";
    else if (err instanceof Anthropic.RateLimitError) msg = "Забагато запитів, спробуйте за хвилину.";
    else if (err instanceof Anthropic.APIError) msg = `Помилка API (${err.status ?? "?"}): ${err.message}`;
    else if (err?.name === "APIUserAbortError") return res.end();
    send("error", { error: msg });
  }
  res.end();
});

app.get("*", (_req, res) => res.sendFile(path.join(here, "public", "index.html")));

app.listen(PORT, () => console.log(`UniShare: http://localhost:${PORT}`));
