import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Heart, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { local } from "../../lib/storage.js";
import { useSession } from "../../app/session.jsx";
import { Avatar, ErrorState, Loading, useConfirm, useToast } from "../../components/ui.jsx";
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

function Comment({ c, post, onAccept }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [liked, setLiked] = useState(c.liked);
  const [count, setCount] = useState(c.useful_count);
  const like = async () => {
    try {
      const r = await api(`/comments/${c.id}/useful`, { method: "POST" });
      setLiked(r.active);
      setCount(r.useful_count);
    } catch (e) { toast(e.message, "error"); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Видалити відповідь?", message: "Цю дію не можна скасувати.", confirmLabel: "Видалити", danger: true }))) return;
    await api(`/comments/${c.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["comments", post.id] });
    qc.invalidateQueries({ queryKey: ["post", post.id] });
  };
  const report = async () => {
    const reason = window.prompt("Причина скарги:");
    if (!reason || reason.trim().length < 3) return;
    try {
      await api("/reports", { method: "POST", body: { target_type: "comment", target_id: c.id, reason } });
      toast("Скаргу надіслано");
    } catch (e) { toast(e.message, "error"); }
  };
  return (
    <div className={`flex gap-3 px-4 py-3 border-b border-line ${c.is_accepted ? "bg-primary/5" : ""}`} id={`c-${c.id}`}>
      <Avatar user={c.author} size={34} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          <Link to={`/u/${c.author.id}`} className="font-semibold hover:underline">{c.author.display_name}</Link>
          <span className="text-muted">· {timeAgo(c.created_at)}</span>
          {c.is_accepted && <span className="chip bg-primary text-on-primary"><CheckCircle2 size={12} /> Прийнята відповідь</span>}
          {c.is_hidden && <span className="chip bg-danger/15 text-danger">Приховано</span>}
        </div>
        <Markdown>{c.body}</Markdown>
        <div className="flex items-center gap-1 -ml-2 mt-1 text-xs">
          <button className={`btn-quiet h-8 px-2 text-xs ${liked ? "text-rose-600 dark:text-rose-400" : "text-muted"}`} onClick={like} aria-pressed={liked}>
            <Heart size={14} fill={liked ? "currentColor" : "none"} /> Корисно {count || ""}
          </button>
          {post.is_mine && post.type === "question" && !c.is_accepted && (
            <button className="btn-quiet h-8 px-2 text-xs text-primary" onClick={() => onAccept(c.id)}><CheckCircle2 size={14} /> Прийняти відповідь</button>
          )}
          {c.is_mine ? (
            <button className="btn-quiet h-8 px-2 text-xs text-muted" onClick={remove}><Trash2 size={14} /> Видалити</button>
          ) : (
            <button className="btn-quiet h-8 px-2 text-xs text-muted" onClick={report}>Поскаржитися</button>
          )}
        </div>
      </div>
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
  const sorted = [...(comments.data || [])].sort((a, b) => b.is_accepted - a.is_accepted);

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
            placeholder={p.type === "question" ? "Поясни хід розв'язання… (Markdown, код, формули $x^2$)" : "Уточнення або коментар"} />
          <div className="flex justify-end mt-2">
            <button className="btn-primary h-9" disabled={!reply.trim() || send.isPending}>{send.isPending ? "Надсилання…" : "Відповісти"}</button>
          </div>
        </div>
      </form>

      {comments.isLoading ? <Loading /> : comments.isError ? <ErrorState error={comments.error} onRetry={comments.refetch} /> :
        sorted.length ? sorted.map((c) => <Comment key={c.id} c={c} post={p} onAccept={accept} />) :
        <div className="p-6 text-center text-sm text-muted">Відповідей ще немає{p.type === "question" ? " — допоможи колезі!" : "."}</div>}
    </>
  );
}
