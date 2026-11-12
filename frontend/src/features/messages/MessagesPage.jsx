import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, MessageCircle, Send } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { useSession } from "../../app/session.jsx";
import { Avatar, Empty, ErrorState, Loading, useToast } from "../../components/ui.jsx";

// Особисті повідомлення. Оновлення — опитуванням (кожні 4 с у відкритому діалозі).
export function useUnreadMessages() {
  const { isAuthed } = useSession();
  return useQuery({ queryKey: ["dm-unread"], queryFn: () => api("/messages/unread"), enabled: isAuthed, refetchInterval: 20_000 });
}

function ConversationList({ activeId }) {
  const q = useQuery({ queryKey: ["dm-list"], queryFn: () => api("/messages"), refetchInterval: 10_000 });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length)
    return (
      <Empty title="Повідомлень поки немає" icon={MessageCircle}>
        Відкрийте профіль однокурсника, який на вас підписаний, і натисніть «Написати».
      </Empty>
    );
  return (
    <ul>
      {q.data.map((c) => (
        <li key={c.id}>
          <Link to={`/messages/${c.id}`} className={`flex items-center gap-3 px-4 py-3 border-b border-line transition-colors ${c.id === activeId ? "bg-sunken" : "hover:bg-sunken/50"}`}>
            <Avatar user={c.user} size={46} ring={c.unread > 0} />
            <span className="flex-1 min-w-0">
              <span className="flex items-center justify-between gap-2">
                <span className={`truncate ${c.unread ? "font-bold" : "font-semibold"}`}>{c.user.display_name}</span>
                <span className="text-[11px] text-muted shrink-0">{timeAgo(c.last_message_at)}</span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm truncate ${c.unread ? "text-ink font-medium" : "text-muted"}`}>
                  {c.last_message ? `${c.last_message.from_me ? "Ви: " : ""}${c.last_message.body}` : "Новий діалог"}
                </span>
                {c.unread > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-lime text-on-lime text-[11px] font-bold grid place-items-center">{c.unread}</span>}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function Chat({ id }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const endRef = useRef(null);
  const conv = useQuery({ queryKey: ["dm", id], queryFn: () => api(`/messages/${id}`) });
  const msgs = useQuery({ queryKey: ["dm-msgs", id], queryFn: () => api(`/messages/${id}/messages`), refetchInterval: 4_000 });

  // Позначаємо прочитаним, коли з'являються нові повідомлення
  const lastId = msgs.data?.[msgs.data.length - 1]?.id;
  useEffect(() => {
    if (!lastId) return;
    api(`/messages/${id}/read`, { method: "POST" }).then(() => {
      qc.invalidateQueries({ queryKey: ["dm-unread"] });
      qc.invalidateQueries({ queryKey: ["dm-list"] });
    }).catch(() => {});
  }, [lastId, id, qc]);
  useLayoutEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lastId]);

  const send = useMutation({
    mutationFn: (body) => api(`/messages/${id}/messages`, { method: "POST", body: { body } }),
    onMutate: (body) => {
      // Оптимістично показуємо повідомлення одразу
      const tmp = { id: "tmp-" + Date.now(), body, from_me: true, created_at: new Date().toISOString(), pending: true };
      qc.setQueryData(["dm-msgs", id], (old) => [...(old || []), tmp]);
      setText("");
    },
    onError: (e, body) => { toast(e.message, "error"); setText(body); qc.invalidateQueries({ queryKey: ["dm-msgs", id] }); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["dm-msgs", id] }); qc.invalidateQueries({ queryKey: ["dm-list"] }); },
  });

  if (conv.isLoading) return <Loading />;
  if (conv.isError) return <ErrorState error={conv.error} />;
  const other = conv.data.user;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-3 px-4 h-16 border-b border-line shrink-0 bg-bg/90 backdrop-blur">
        <button className="icon-btn md:hidden -ml-2" onClick={() => nav("/messages")} aria-label="До списку"><ArrowLeft size={20} /></button>
        <Link to={`/u/${other.id}`} className="flex items-center gap-3 min-w-0 hover:opacity-80">
          <Avatar user={other} size={38} />
          <span className="font-semibold truncate">{other.display_name}</span>
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5" aria-live="polite">
        {msgs.isLoading ? <Loading /> : msgs.data.length === 0 ? (
          <div className="text-center text-sm text-muted py-10">
            <Avatar user={other} size={72} ring />
            <div className="font-display text-lg text-ink mt-3">{other.display_name}</div>
            Почніть розмову — привітайтесь 👋
          </div>
        ) : msgs.data.map((m, i) => {
          const prev = msgs.data[i - 1];
          const showDay = !prev || !sameDay(prev.created_at, m.created_at);
          const grouped = prev && prev.from_me === m.from_me && !showDay;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="text-center text-[11px] text-muted my-3">
                  {new Date(m.created_at).toLocaleDateString("uk-UA", { day: "numeric", month: "long" })}
                </div>
              )}
              <div className={`flex ${m.from_me ? "justify-end" : "justify-start"} ${grouped ? "" : "pt-1.5"}`}>
                <div className={`max-w-[78%] px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words page-in ${m.from_me
                  ? "text-[#0b2a1f] rounded-2xl rounded-br-md bg-[linear-gradient(120deg,rgb(var(--glow)),rgb(var(--lime)))]"
                  : "bg-surface border border-line rounded-2xl rounded-bl-md"} ${m.pending ? "opacity-60" : ""}`}
                  title={new Date(m.created_at).toLocaleString("uk-UA")}>
                  {m.body}
                  <span className={`block text-[10px] mt-0.5 text-right ${m.from_me ? "text-[#0b2a1f]/60" : "text-muted"}`}>
                    {new Date(m.created_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-3 shrink-0">
        {conv.data.can_send ? (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); text.trim() && send.mutate(text.trim()); }}>
            <label htmlFor="dm-input" className="sr-only">Повідомлення</label>
            <textarea id="dm-input" rows={1} className="textarea rounded-2xl min-h-[44px] max-h-40" value={text} maxLength={4000}
              onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }}
              placeholder="Повідомлення… (Shift+Enter — новий рядок)" autoFocus />
            <button className="btn-accent h-11 w-11 p-0 shrink-0" disabled={!text.trim()} aria-label="Надіслати"><Send size={17} /></button>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted justify-center py-2"><Lock size={15} /> {other.display_name} більше не підписаний(-а) на вас — надсилати не можна.</div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { id } = useParams();
  return (
    <div className="flex h-[calc(100dvh-64px)] md:h-dvh">
      <aside className={`${id ? "hidden md:flex" : "flex"} flex-col w-full md:w-[300px] md:shrink-0 md:border-r border-line`}>
        <header className="flex items-center px-4 h-16 border-b border-line shrink-0">
          <h1 className="font-display text-lg">Повідомлення</h1>
        </header>
        <div className="flex-1 overflow-y-auto"><ConversationList activeId={id} /></div>
      </aside>
      <section className={`${id ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col`}>
        {id ? <Chat key={id} id={id} /> : (
          <div className="m-auto"><Empty title="Оберіть діалог" icon={MessageCircle}>Листуйтеся з однокурсниками, які на вас підписані.</Empty></div>
        )}
      </section>
    </div>
  );
}

// Кнопка «Написати» для профілю
export function MessageButton({ user }) {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (user.is_me) return null;
  if (!user.can_message)
    return (
      <button className="btn-ghost h-10 opacity-60 cursor-not-allowed" title="Написати можна, коли людина підписана на вас" disabled>
        <MessageCircle size={15} /> Написати
      </button>
    );
  return (
    <button className="btn-ghost h-10" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const c = await api(`/messages/with/${user.id}`, { method: "POST" }); nav(`/messages/${c.id}`); }
      catch (e) { toast(e.message, "error"); }
      setBusy(false);
    }}>
      <MessageCircle size={15} /> Написати
    </button>
  );
}
