import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, FileText, MessageSquarePlus, PanelLeft, Pencil, RotateCcw, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { api, streamSSE } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { useSession } from "../../app/session.jsx";
import { useConfirm, useToast } from "../../components/ui.jsx";
import Markdown from "../../components/Markdown.jsx";

const STARTERS = [
  ["Поясни тему простими словами", "Поясни простими словами, що таке "],
  ["Розбери завдання покроково", "Розбери покроково задачу: "],
  ["Перевір моє розв'язання", "Перевір моє розв'язання і вкажи, де помилка:\n\n"],
  ["Знайди помилку в коді", "Знайди помилку в коді:\n\n```\n\n```"],
  ["Підготуй до захисту лаби", "Склади 10 питань, які можуть поставити на захисті лабораторної про "],
  ["Склади план або конспект", "Склади короткий конспект теми "],
];

function ConversationList({ activeId, onSelect, onNew, onClose }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState("");
  const list = useQuery({ queryKey: ["ai-conversations"], queryFn: () => api("/ai/conversations") });
  const rename = async (id) => {
    if (title.trim()) await api(`/ai/conversations/${id}`, { method: "PATCH", body: { title: title.trim() } });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["ai-conversations"] });
  };
  const remove = async (c) => {
    if (!(await confirm({ title: "Видалити діалог?", message: `«${c.title}» буде видалено назавжди.`, confirmLabel: "Видалити", danger: true }))) return;
    await api(`/ai/conversations/${c.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["ai-conversations"] });
    if (c.id === activeId) onSelect(null);
  };
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3">
        <button className="btn-primary h-9 flex-1" onClick={onNew}><MessageSquarePlus size={16} /> Новий діалог</button>
        {onClose && <button className="icon-btn md:hidden" onClick={onClose} aria-label="Закрити список"><X size={18} /></button>}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Попередні діалоги">
        {list.data?.length === 0 && <div className="text-xs text-muted px-2 py-4">Тут з'являться ваші діалоги. Вони приватні — бачите лише ви.</div>}
        {list.data?.map((c) => (
          <div key={c.id} className={`group flex items-center gap-1 rounded-xl ${c.id === activeId ? "bg-sunken" : "hover:bg-sunken/60"}`}>
            {editing === c.id ? (
              <form className="flex-1 flex gap-1 p-1" onSubmit={(e) => { e.preventDefault(); rename(c.id); }}>
                <input className="input h-8" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Нова назва" />
                <button className="icon-btn w-8 h-8" aria-label="Зберегти"><Check size={15} /></button>
              </form>
            ) : (
              <>
                <button className="flex-1 min-w-0 text-left px-3 py-2" onClick={() => onSelect(c.id)}>
                  <span className="block text-sm truncate">{c.title}</span>
                  <span className="block text-[11px] text-muted">{timeAgo(c.updated_at)}</span>
                </button>
                <button className="icon-btn w-7 h-7 opacity-60 group-hover:opacity-100" onClick={() => { setEditing(c.id); setTitle(c.title); }} aria-label={`Перейменувати «${c.title}»`}><Pencil size={13} /></button>
                <button className="icon-btn w-7 h-7 opacity-60 group-hover:opacity-100 mr-1" onClick={() => remove(c)} aria-label={`Видалити «${c.title}»`}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}

export default function AIPage() {
  const { config } = useSession();
  const enabled = Boolean(config?.ai_enabled);
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c");
  const postParam = params.get("post");
  const qParam = params.get("q");
  const qc = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState(qParam || "");
  const [context, setContext] = useState(null); // попередній перегляд контексту
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(null); // текст, що надходить
  const [error, setError] = useState(null);
  const [showList, setShowList] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);

  const select = (id) => { setParams((p) => { id ? p.set("c", id) : p.delete("c"); return p; }); setShowList(false); };

  const history = useQuery({
    queryKey: ["ai-messages", activeId],
    queryFn: () => api(`/ai/conversations/${activeId}/messages`),
    enabled: Boolean(activeId),
  });
  useEffect(() => { setMessages(history.data || []); setError(null); }, [history.data, activeId]);
  useEffect(() => { if (!activeId) setMessages([]); }, [activeId]);

  // Контекст із матеріалу: показуємо, що саме буде передано AI
  useEffect(() => {
    if (!postParam) return;
    api("/ai/context-preview", { method: "POST", body: { post_id: postParam } })
      .then((ctx) => {
        setContext(ctx);
        setInput((v) => v || (ctx.type === "question" ? "Розбери це запитання покроково." : "Поясни цей матеріал простими словами."));
      })
      .catch((e) => toast(e.message, "error"));
    setParams((p) => { p.delete("post"); return p; }, { replace: true });
  }, [postParam]); // eslint-disable-line
  useEffect(() => { if (qParam) setParams((p) => { p.delete("q"); return p; }, { replace: true }); }, []); // eslint-disable-line

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, streaming]);

  async function run({ retry = false } = {}) {
    if (!enabled) return;
    let cid = activeId;
    if (!cid) {
      const conv = await api("/ai/conversations", { method: "POST", body: {} });
      cid = conv.id;
      setParams((p) => { p.set("c", cid); return p; }, { replace: true });
    }
    const text = input.trim();
    const ctx = context;
    if (!retry) {
      setMessages((m) => [...m, { id: "tmp-" + Date.now(), role: "user", content: text + (ctx ? `\n\n---\nМатеріал «${ctx.title}» додано до контексту` : ""), status: "complete" }]);
      setInput("");
      setContext(null);
    } else {
      setMessages((m) => { const c = [...m]; while (c.length && c[c.length - 1].role === "assistant") c.pop(); return c; });
    }
    setError(null);
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      await streamSSE(`/ai/conversations/${cid}/messages`, { content: text, context_post_id: ctx?.post_id ?? null, retry }, {
        signal: controller.signal,
        onEvent: (ev, data) => {
          if (ev === "delta") { acc += data.text; setStreaming(acc); }
          if (ev === "error") setError(data.error);
        },
      });
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      abortRef.current = null;
      setStreaming(null);
      await qc.invalidateQueries({ queryKey: ["ai-messages", cid] });
      qc.invalidateQueries({ queryKey: ["ai-conversations"] });
    }
  }

  const stop = () => abortRef.current?.abort();
  const lastFailed = Boolean(error) || (messages.length > 0 && messages[messages.length - 1].status === "error");

  return (
    <div className="flex h-[calc(100dvh-64px)] md:h-dvh">
      {/* Список діалогів */}
      <aside className={`${showList ? "fixed inset-0 z-40 bg-surface" : "hidden"} md:static md:block md:w-56 md:shrink-0 md:border-r border-line`}>
        <ConversationList activeId={activeId} onSelect={select} onNew={() => select(null)} onClose={() => setShowList(false)} />
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-line shrink-0">
          <button className="icon-btn md:hidden -ml-2" onClick={() => setShowList(true)} aria-label="Діалоги"><PanelLeft size={18} /></button>
          <Sparkles size={18} className="text-teal" />
          <h1 className="font-display text-lg">AI</h1>
          <span className="text-xs text-muted truncate">{enabled ? `${config.ai_model} · через сервер UniPars` : "не підключено"}</span>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" aria-live="polite">
          {!enabled && (
            <div className="card p-4 flex gap-3" role="status">
              <AlertTriangle className="text-amber-600 shrink-0" size={20} />
              <div className="text-sm">
                <div className="font-semibold mb-1">AI ще не підключено</div>
                Адміністратор має вказати ключ AI-провайдера на сервері (змінна <code>ANTHROPIC_API_KEY</code>). Ми не показуємо заготовлені відповіді замість справжньої генерації.
              </div>
            </div>
          )}
          {!messages.length && streaming === null && (
            <div className="text-center pt-6">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-teal to-primary grid place-items-center text-white mb-3"><Sparkles /></div>
              <h2 className="font-display text-xl mb-1">Чим допомогти з навчанням?</h2>
              <p className="text-sm text-muted mb-5">Я поясню хід розв'язання, а не просто дам відповідь.</p>
              <div className="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto text-left">
                {STARTERS.map(([label, prompt]) => (
                  <button key={label} className="card px-3 py-2.5 text-sm hover:border-primary disabled:opacity-50" disabled={!enabled} onClick={() => setInput(prompt)}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 ${m.role === "user" ? "bg-primary text-on-primary rounded-br-md whitespace-pre-wrap text-[15px] break-words" : m.status === "error" ? "bg-danger/10 text-danger rounded-bl-md text-sm" : "bg-surface border border-line rounded-bl-md"}`}>
                {m.role === "user" ? m.content.split("\n---\nМатеріал")[0] : <Markdown>{m.content}</Markdown>}
                {m.role === "user" && m.content.includes("\n---\nМатеріал") && <div className="mt-1 text-xs opacity-80 flex items-center gap-1"><FileText size={12} /> з матеріалом</div>}
                {m.status === "partial" && <div className="text-xs text-muted mt-1">Генерацію зупинено</div>}
              </div>
            </div>
          ))}
          {streaming !== null && (
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-surface border border-line">
                {streaming ? <Markdown className="typing-caret">{streaming}</Markdown> : <span className="text-sm text-muted typing-caret">Думаю</span>}
              </div>
            </div>
          )}
          {lastFailed && streaming === null && (
            <div className="flex items-center gap-2 text-sm text-danger" role="alert">
              <AlertTriangle size={16} /> {error || "Не вдалося отримати відповідь"}
              <button className="btn-ghost h-8 text-xs" onClick={() => run({ retry: true })}><RotateCcw size={14} /> Спробувати ще</button>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line p-3 shrink-0">
          {context && (
            <div className="card p-3 mb-2 text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold flex items-center gap-1.5 min-w-0"><FileText size={15} className="shrink-0" /> <span className="truncate">До контексту буде додано: «{context.title}»</span></span>
                <button className="icon-btn w-7 h-7" onClick={() => setContext(null)} aria-label="Прибрати контекст"><X size={14} /></button>
              </div>
              <details>
                <summary className="text-xs text-muted cursor-pointer">Показати текст, який отримає AI</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs bg-sunken rounded-lg p-2">{context.text}</pre>
              </details>
              {context.notes.map((n) => <div key={n} className="text-xs text-amber-700 dark:text-amber-300 mt-1">{n}</div>)}
            </div>
          )}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); input.trim() && streaming === null && run(); }}>
            <label htmlFor="ai-input" className="sr-only">Повідомлення для AI</label>
            <textarea id="ai-input" rows={1} className="textarea max-h-48 min-h-[44px] rounded-2xl" value={input} disabled={!enabled}
              onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }}
              placeholder={enabled ? "Запитай про будь-яке завдання… (Shift+Enter — новий рядок)" : "AI ще не підключено"} />
            {streaming !== null ? (
              <button type="button" className="btn-ghost h-11 w-11 p-0 shrink-0" onClick={stop} aria-label="Зупинити генерацію"><Square size={16} fill="currentColor" /></button>
            ) : (
              <button className="btn-primary h-11 w-11 p-0 shrink-0" disabled={!enabled || !input.trim()} aria-label="Надіслати"><Send size={17} /></button>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
