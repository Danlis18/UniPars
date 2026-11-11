import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, CheckCircle2, CircleDot, Download, Eye, FileText, Flag, Heart, Link2, MessageCircle, MoreHorizontal, Pencil, Share2, Sparkles, Trash2, Users } from "lucide-react";
import { api } from "../../lib/api.js";
import { fileSize, timeAgo } from "../../lib/format.js";
import { t } from "../../lib/i18n.js";
import { Avatar, DemoBadge, Modal, useConfirm, useToast } from "../../components/ui.jsx";
import Markdown from "../../components/Markdown.jsx";

const TYPE_STYLE = {
  material: "bg-primary/10 text-primary",
  question: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  explanation: "bg-teal/15 text-teal",
};

export function TypeChip({ post }) {
  const label = post.type === "material" && post.material ? t(`materialKind.${post.material.kind}`) : t(`postType.${post.type}`);
  return <span className={`chip ${TYPE_STYLE[post.type]}`}>{label}</span>;
}

export function StatusChip({ post }) {
  if (post.type !== "question") return null;
  return post.status === "solved"
    ? <span className="chip bg-primary text-on-primary"><CheckCircle2 size={12} /> Вирішене</span>
    : <span className="chip border border-line text-muted"><CircleDot size={12} /> Відкрите</span>;
}

// Оновлює допис у всіх кешах стрічок і на сторінці допису
export function usePatchPost() {
  const qc = useQueryClient();
  return (id, patch) => {
    qc.setQueriesData({ queryKey: ["posts"] }, (data) =>
      data?.pages ? { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) })) } : data);
    qc.setQueryData(["post", id], (p) => (p ? { ...p, ...patch } : p));
  };
}

export function useAttachmentOpener() {
  const toast = useToast();
  return async (att) => {
    try {
      const { url } = await api(`/attachments/${att.id}/link`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

export function Attachments({ post }) {
  const open = useAttachmentOpener();
  if (!post.attachments?.length && !post.material?.link_url) return null;
  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      {post.material?.link_url && (
        <a href={post.material.link_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 hover:bg-sunken">
          <Link2 size={18} className="text-primary shrink-0" />
          <span className="truncate text-sm">{post.material.link_url}</span>
        </a>
      )}
      {post.attachments?.map((a) => (
        <button key={a.id} onClick={() => open(a)} className="w-full flex items-center gap-3 rounded-xl border border-line px-3 py-2 hover:bg-sunken text-left">
          <span className="w-9 h-9 rounded-lg bg-sunken grid place-items-center shrink-0"><FileText size={18} className="text-primary" /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium truncate">{a.file_name}</span>
            <span className="block text-xs text-muted">{a.format} · {fileSize(a.size_bytes)}</span>
          </span>
          <span className="text-xs text-muted flex items-center gap-1 shrink-0">
            {a.previewable ? <><Eye size={14} /> Переглянути</> : <><Download size={14} /> Завантажити</>}
          </span>
        </button>
      ))}
    </div>
  );
}

function PostMenu({ post, onEdit }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();

  const remove = async () => {
    setOpen(false);
    if (!(await confirm({ title: "Видалити допис?", message: "Допис, коментарі та файли буде видалено без можливості відновлення.", confirmLabel: "Видалити", danger: true }))) return;
    try {
      await api(`/posts/${post.id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["posts"] });
      toast("Допис видалено");
      nav("/", { replace: true });
    } catch (e) { toast(e.message, "error"); }
  };
  const report = async (e) => {
    e.preventDefault();
    try {
      await api("/reports", { method: "POST", body: { target_type: "post", target_id: post.id, reason } });
      toast("Скаргу надіслано модераторам");
      setReporting(false);
      setReason("");
    } catch (err) { toast(err.message, "error"); }
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn w-8 h-8" aria-label="Дії з дописом" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreHorizontal size={18} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 card shadow-xl py-1 text-sm" role="menu">
            {post.is_mine ? (
              <>
                {onEdit && <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken" onClick={() => { setOpen(false); onEdit(); }}><Pencil size={15} /> Редагувати</button>}
                <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken text-danger" onClick={remove}><Trash2 size={15} /> Видалити</button>
              </>
            ) : (
              <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken" onClick={() => { setOpen(false); setReporting(true); }}><Flag size={15} /> Поскаржитися</button>
            )}
          </div>
        </>
      )}
      <Modal open={reporting} onClose={() => setReporting(false)} title="Скарга на допис">
        <form onSubmit={report} className="p-4 space-y-3">
          <label className="label" htmlFor="r-reason">Що не так?</label>
          <textarea id="r-reason" className="textarea min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required placeholder="Спам, плагіат, образи…" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setReporting(false)}>Скасувати</button>
            <button className="btn-primary" disabled={reason.trim().length < 3}>Надіслати</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function PostActions({ post }) {
  const patch = usePatchPost();
  const toast = useToast();
  const nav = useNavigate();
  const useful = useMutation({
    mutationFn: () => api(`/posts/${post.id}/useful`, { method: "POST" }),
    onSuccess: (r) => patch(post.id, { liked: r.active, useful_count: r.useful_count }),
    onError: (e) => toast(e.message, "error"),
  });
  const save = useMutation({
    mutationFn: () => api(`/posts/${post.id}/bookmark`, { method: "POST" }),
    onSuccess: (r) => { patch(post.id, { saved: r.saved }); toast(r.saved ? "Додано до збереженого" : "Прибрано зі збереженого"); },
    onError: (e) => toast(e.message, "error"),
  });
  const share = async () => {
    const url = `${location.origin}/p/${post.id}`;
    try {
      if (navigator.share) await navigator.share({ title: post.title, url });
      else { await navigator.clipboard.writeText(url); toast("Посилання скопійовано"); }
    } catch {}
  };
  const btn = "flex items-center gap-1.5 rounded-full px-2 h-8 text-xs text-muted hover:bg-sunken hover:text-ink transition-colors";
  return (
    <div className="flex items-center justify-between mt-2 -ml-2 max-w-md" onClick={(e) => e.stopPropagation()}>
      <button className={`${btn} ${post.liked ? "text-rose-600 dark:text-rose-400" : ""}`} onClick={() => useful.mutate()} aria-pressed={post.liked} title={t("actions.useful")}>
        <Heart size={16} fill={post.liked ? "currentColor" : "none"} /> <span>{post.useful_count || ""}</span><span className="sr-only">{t("actions.useful")}</span>
      </button>
      <Link to={`/p/${post.id}`} className={btn} title={t("actions.comments")}>
        <MessageCircle size={16} /> <span>{post.comment_count || ""}</span><span className="sr-only">{t("actions.comments")}</span>
      </Link>
      <button className={`${btn} ${post.saved ? "text-primary" : ""}`} onClick={() => save.mutate()} aria-pressed={post.saved} title={t("actions.save")}>
        <Bookmark size={16} fill={post.saved ? "currentColor" : "none"} /><span className="sr-only">{t("actions.save")}</span>
      </button>
      <button className={btn} onClick={() => nav(`/ai?post=${post.id}`)} title={post.type === "question" ? "Розібрати з AI" : "Пояснити з AI"}>
        <Sparkles size={16} /> <span className="hidden sm:inline">AI</span>
      </button>
      <button className={btn} onClick={share} title={t("actions.share")}><Share2 size={16} /><span className="sr-only">{t("actions.share")}</span></button>
    </div>
  );
}

export function PostHeader({ post, onEdit }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          <span className="font-semibold truncate max-w-[180px]">{post.author.display_name}</span>
          <span className="text-muted">· {timeAgo(post.created_at)}</span>
          {post.visibility === "group" && <span className="chip bg-sunken text-muted" title="Видно лише вашій групі"><Users size={11} /> Група</span>}
          {post.is_demo && <DemoBadge />}
          {post.is_hidden && <span className="chip bg-danger/15 text-danger">Приховано</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap text-xs">
          <TypeChip post={post} />
          <StatusChip post={post} />
          <Link to={`/subjects/${post.subject.slug}`} onClick={(e) => e.stopPropagation()} className="text-muted hover:text-primary hover:underline">
            {post.subject.name}{post.topic ? ` · ${post.topic.name}` : ""}
          </Link>
        </div>
      </div>
      <PostMenu post={post} onEdit={onEdit} />
    </div>
  );
}

export default function PostCard({ post }) {
  const nav = useNavigate();
  return (
    <article
      className="flex gap-3 px-4 py-3 border-b border-line hover:bg-sunken/40 transition-colors cursor-pointer"
      onClick={(e) => { if (!window.getSelection()?.toString()) nav(`/p/${post.id}`); }}
      aria-labelledby={`t-${post.id}`}
    >
      <Avatar user={post.author} />
      <div className="flex-1 min-w-0">
        <PostHeader post={post} />
        <Link id={`t-${post.id}`} to={`/p/${post.id}`} onClick={(e) => e.stopPropagation()} className="block mt-1.5 font-semibold text-[16px] leading-snug hover:underline break-words">
          {post.title}
        </Link>
        {post.body && (
          <div className="relative max-h-40 overflow-hidden text-ink/90">
            <Markdown>{post.body + (post.truncated ? "…" : "")}</Markdown>
          </div>
        )}
        <Attachments post={post} />
        <PostActions post={post} />
      </div>
    </article>
  );
}
