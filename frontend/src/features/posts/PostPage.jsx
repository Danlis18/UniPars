import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Flag, Heart, Reply, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { local } from "../../lib/storage.js";
import { useSession } from "../../app/session.jsx";
import { Avatar, ErrorState, Loading, Modal, useConfirm, useToast } from "../../components/ui.jsx";
import Markdown from "../../components/Markdown.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Attachments, PostActions, PostHeader, usePatchPost } from "./PostCard.jsx";

function EditForm({ post, onDone }) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const patch = usePatchPost();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api(`/posts/${post.id}`, { method: "PATCH", body: { title, body } }),
    onSuccess: (p) => { patch(post.id, p); toast("Зміни збережено"); onDone(); },
    onError: (e) => toast(e.message, "error"),
  });
  return (
    <form className="space-y-2 mt-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required aria-label="Заголовок" />
      <textarea className="textarea min-h-[160px]" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Текст" />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Скасувати</button>
        <button className="btn-primary" disabled={save.isPending || !title.trim()}>Зберегти</button>
      </div>
    </form>
  );
}

function ReplyBox({ post, parent, onDone, autoFocus = true }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  const [text, setText] = useState(parent ? `@${parent.author.display_name.split(" ")[0]} ` : "");
  const send = useMutation({
    mutationFn: () => api(`/posts/${post.id}/comments`, { method: "POST", body: { body: text.trim(), parent_id: parent?.id ?? null } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["comments", post.id] });
      qc.invalidateQueries({ queryKey: ["post", post.id] });
      qc.invalidateQueries({ queryKey: ["posts"] });
      onDone?.();
    },
    onError: (e) => toast(e.message, "error"),
  });
  return (
    <form className="flex gap-2 mt-2 page-in" onSubmit={(e) => { e.preventDefault(); text.trim() && send.mutate(); }}>
      <Avatar user={me} size={28} />
      <div className="flex-1 min-w-0">
        <textarea className="textarea min-h-[44px] text-sm" value={text} autoFocus={autoFocus} aria-label="Відповідь на коментар"
          onChange={(e) => setText(e.target.value)} placeholder="Ваша відповідь…"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form.requestSubmit(); if (e.key === "Escape") onDone?.(); }} />
        <div className="flex justify-end gap-2 mt-1.5">
          <button type="button" className="btn-quiet h-8 text-xs" onClick={onDone}>Скасувати</button>
          <button className="btn-primary h-8 text-xs" disabled={!text.trim() || send.isPending}>{send.isPending ? "…" : "Відповісти"}</button>
        </div>
      </div>
    </form>
  );
}

function ReportDialog({ comment, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api("/reports", { method: "POST", body: { target_type: "comment", target_id: comment.id, reason } });
      toast("Скаргу надіслано модераторам");
      onClose();
    } catch (err) { toast(err.message, "error"); }
  };
  return (
    <Modal open onClose={onClose} title="Скарга на коментар">
      <form onSubmit={submit} className="p-4 space-y-3">
        <textarea className="textarea min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required
          placeholder="Спам, образи, плагіат…" aria-label="Причина скарги" autoFocus />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Скасувати</button>
          <button className="btn-primary" disabled={reason.trim().length < 3}>Надіслати</button>
        </div>
      </form>
    </Modal>
  );
}

function Comment({ c, post, onAccept, replies = [], depth = 0 }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [liked, setLiked] = useState(c.liked);
  const [count, setCount] = useState(c.useful_count);
  const [replying, setReplying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const like = async () => {
    setLiked((v) => !v);
    setCount((n) => n + (liked ? -1 : 1));
    try {
      const r = await api(`/comments/${c.id}/useful`, { method: "POST" });
      setLiked(r.active);
      setCount(r.useful_count);
    } catch (e) { toast(e.message, "error"); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Видалити коментар?", message: "Цю дію не можна скасувати.", confirmLabel: "Видалити", danger: true }))) return;
    await api(`/comments/${c.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["comments", post.id] });
    qc.invalidateQueries({ queryKey: ["post", post.id] });
  };
  const visibleReplies = showAll ? replies : replies.slice(0, 3);
  return (
    <div className={depth === 0 ? `px-4 py-3 border-b border-line ${c.is_accepted ? "bg-primary/5" : ""}` : "pt-3"} id={`c-${c.id}`}>
      <div className="flex gap-3">
        <Link to={`/u/${c.author.id}`} className="shrink-0 h-fit"><Avatar user={c.author} size={depth ? 28 : 34} /></Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm flex-wrap">
            <Link to={`/u/${c.author.id}`} className="font-semibold hover:underline">{c.author.display_name}</Link>
            {c.author.id === post.author.id && <span className="chip bg-sunken text-muted">Автор</span>}
            <span className="text-muted">· {timeAgo(c.created_at)}</span>
            {c.is_accepted && <span className="chip bg-primary text-on-primary"><CheckCircle2 size={12} /> Прийнята відповідь</span>}
            {c.is_hidden && <span className="chip bg-danger/15 text-danger">Приховано</span>}
          </div>
          <Markdown>{c.body}</Markdown>
          <div className="flex items-center gap-1 -ml-2 mt-0.5 text-xs flex-wrap">
            <button className={`btn-quiet h-8 px-2 text-xs ${liked ? "text-rose-600 dark:text-rose-400" : "text-muted"}`} onClick={like} aria-pressed={liked} aria-label="Корисно">
              <Heart size={14} fill={liked ? "currentColor" : "none"} className={liked ? "heart-pop" : ""} /> {count || ""}
            </button>
            <button className="btn-quiet h-8 px-2 text-xs text-muted" onClick={() => setReplying((v) => !v)}><Reply size={14} /> Відповісти</button>
            {depth === 0 && post.is_mine && post.type === "question" && !c.is_accepted && (
              <button className="btn-quiet h-8 px-2 text-xs text-primary" onClick={() => onAccept(c.id)}><CheckCircle2 size={14} /> Прийняти відповідь</button>
            )}
            {c.is_mine ? (
              <button className="btn-quiet h-8 px-2 text-xs text-muted" onClick={remove}><Trash2 size={14} /> Видалити</button>
            ) : (
              <button className="btn-quiet h-8 px-2 text-xs text-muted" onClick={() => setReporting(true)}><Flag size={14} /> Поскаржитися</button>
            )}
          </div>
          {replies.length > 0 && (
            <div className="border-l-2 border-line pl-3 ml-1">
              {visibleReplies.map((r) => <Comment key={r.id} c={r} post={post} onAccept={onAccept} depth={1} />)}
              {replies.length > 3 && !showAll && (
                <button className="text-xs text-primary font-semibold mt-2" onClick={() => setShowAll(true)}>Показати ще {replies.length - 3} відп.</button>
              )}
            </div>
          )}
          {replying && <ReplyBox post={post} parent={c} onDone={() => setReplying(false)} />}
        </div>
      </div>
      {reporting && <ReportDialog comment={c} onClose={() => setReporting(false)} />}
    </div>
  );
}

export default function PostPage() {
  const { id } = useParams();
  const { me } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const draftKey = `unipars.reply.${id}`;
  const [reply, setReply] = useState(() => local.get(draftKey, ""));

  const post = useQuery({ queryKey: ["post", id], queryFn: () => api(`/posts/${id}`) });
  const comments = useQuery({ queryKey: ["comments", id], queryFn: () => api(`/posts/${id}/comments`), enabled: post.isSuccess });

  const send = useMutation({
    mutationFn: () => api(`/posts/${id}/comments`, { method: "POST", body: { body: reply } }),
    onSuccess: () => {
      setReply("");
      local.remove(draftKey);
      qc.invalidateQueries({ queryKey: ["comments", id] });
      qc.invalidateQueries({ queryKey: ["post", id] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => toast(e.message, "error"),
  });
  const accept = async (cid) => {
    const p = await api(`/comments/${cid}/accept`, { method: "POST" });
    qc.setQueryData(["post", id], p);
    qc.invalidateQueries({ queryKey: ["comments", id] });
    qc.invalidateQueries({ queryKey: ["posts"] });
    toast("Запитання позначено вирішеним");
  };
  const reopen = async () => {
    qc.setQueryData(["post", id], await api(`/posts/${id}/reopen`, { method: "POST" }));
    qc.invalidateQueries({ queryKey: ["comments", id] });
    qc.invalidateQueries({ queryKey: ["posts"] });
  };

  if (post.isLoading) return <Loading />;
  if (post.isError) return <><PageHeader back title="Допис" /><ErrorState error={post.error} onRetry={post.refetch} /></>;
  const p = post.data;
  // Дерево коментарів: корені (прийнята відповідь першою) + відповіді під ними (один рівень, як в Instagram)
  const all = comments.data || [];
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  const rootOf = (c) => { let x = c; const seen = new Set(); while (x.parent_id && byId[x.parent_id] && !seen.has(x.id)) { seen.add(x.id); x = byId[x.parent_id]; } return x; };
  const roots = all.filter((c) => !c.parent_id || !byId[c.parent_id]).sort((a, b) => b.is_accepted - a.is_accepted);
  const childrenOf = (id) => all.filter((c) => c.parent_id && byId[c.parent_id] && rootOf(c).id === id);

  return (
    <>
      <PageHeader back title={p.type === "question" ? "Запитання" : p.type === "explanation" ? "Пояснення" : "Матеріал"} />
      <article className="px-4 py-4 border-b border-line">
        <div className="flex gap-3">
          <Link to={`/u/${p.author.id}`} className="shrink-0 h-fit"><Avatar user={p.author} ring size={46} /></Link>
          <div className="flex-1 min-w-0"><PostHeader post={p} onEdit={() => setEditing(true)} /></div>
        </div>
        {editing ? <EditForm post={p} onDone={() => setEditing(false)} /> : (
          <>
            <h2 className="font-display text-xl mt-3 break-words">{p.title}</h2>
            <Markdown className="mt-1">{p.body}</Markdown>
            {p.question && (p.question.tried || p.question.unclear_step) && (
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {p.question.tried && <div className="rounded-xl bg-sunken p-3"><dt className="label">Що вже пробував</dt><dd className="text-sm whitespace-pre-wrap">{p.question.tried}</dd></div>}
                {p.question.unclear_step && <div className="rounded-xl bg-sunken p-3"><dt className="label">Незрозумілий крок</dt><dd className="text-sm whitespace-pre-wrap">{p.question.unclear_step}</dd></div>}
              </dl>
            )}
          </>
        )}
        <Attachments post={p} />
        <div className="flex flex-wrap gap-2 mt-3">
          <button className="btn-lime h-9" onClick={() => nav(`/ai?post=${p.id}`)}>
            <Sparkles size={16} /> {p.type === "question" ? "Розібрати з AI" : "Пояснити з AI"}
          </button>
          {p.is_mine && p.type === "question" && p.status === "solved" && (
            <button className="btn-ghost h-9" onClick={reopen}><RotateCcw size={16} /> Відкрити повторно</button>
          )}
        </div>
        <PostActions post={p} />
      </article>

      <form className="flex gap-3 px-4 py-3 border-b border-line" onSubmit={(e) => { e.preventDefault(); reply.trim() && send.mutate(); }}>
        <Avatar user={me} size={34} />
        <div className="flex-1 min-w-0">
          <label htmlFor="reply" className="sr-only">Відповідь</label>
          <textarea id="reply" className="textarea min-h-[70px]" value={reply}
            onChange={(e) => { setReply(e.target.value); local.set(draftKey, e.target.value); }}
            placeholder={p.type === "question" ? "Поясни хід розв'язання… (Markdown, код, формули $x^2$)" : "Напишіть коментар…"} />
          <div className="flex justify-end mt-2">
            <button className="btn-primary h-9" disabled={!reply.trim() || send.isPending}>{send.isPending ? "Надсилання…" : "Коментувати"}</button>
          </div>
        </div>
      </form>

      {comments.isLoading ? <Loading /> : comments.isError ? <ErrorState error={comments.error} onRetry={comments.refetch} /> :
        roots.length ? roots.map((c) => <Comment key={c.id} c={c} post={p} onAccept={accept} replies={childrenOf(c.id)} />) :
        <div className="p-6 text-center text-sm text-muted">Відповідей ще немає{p.type === "question" ? " — допоможи колезі!" : "."}</div>}
    </>
  );
}
