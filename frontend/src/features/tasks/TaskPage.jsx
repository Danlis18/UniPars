import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MessageCircleQuestion, Pencil, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { api, uploadFile } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { Avatar, Empty, ErrorState, Loading, Modal, useConfirm, useToast } from "../../components/ui.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import Markdown from "../../components/Markdown.jsx";
import { RegenerateDialog } from "../billing/pages.jsx";
import { AuthorLine, DeadlineChip, FileRow, KINDS, StatusChip, SubmitDialog, deadlineInfo, taskLabel } from "./shared.jsx";

function Section({ id, title, count, children, action }) {
  return (
    <section aria-labelledby={id} className="px-4 py-5 border-b border-line">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id={id} className="font-display text-base">{title}{count != null && <span className="text-muted font-sans text-sm font-normal"> · {count}</span>}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EditTaskDialog({ task, open, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const [f, setF] = useState({ number: task.number, title: task.title, description: task.description || "", deadline: toLocal(task.deadline_at) });
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: {
        number: Number(f.number), title: f.title, description: f.description,
        deadline_at: f.deadline ? new Date(f.deadline).toISOString() : null } });
      qc.invalidateQueries({ queryKey: ["task", task.id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Завдання оновлено");
      onClose();
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Редагувати завдання" labelledBy="edit-task-h" wide>
      <form onSubmit={save} className="p-4 space-y-3">
        <div className="grid grid-cols-[90px_1fr] gap-3">
          <div><label className="label" htmlFor="et-n">Номер</label>
            <input id="et-n" type="number" min={1} max={99} className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} required /></div>
          <div><label className="label" htmlFor="et-t">Назва</label>
            <input id="et-t" className="input" maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></div>
        </div>
        <div><label className="label" htmlFor="et-d">Умова (підтримується Markdown)</label>
          <textarea id="et-d" className="textarea min-h-[160px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><label className="label" htmlFor="et-dl">Дедлайн (необов'язково)</label>
          <input id="et-dl" type="datetime-local" className="input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
        {error && <div className="text-sm text-danger" role="alert">{error}</div>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Скасувати</button><button className="btn-primary">Зберегти</button></div>
      </form>
    </Modal>
  );
}

function useTaskFiles(task) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef(null);
  const [progress, setProgress] = useState(null);
  const upload = async (file) => {
    if (!file) return;
    setProgress(0);
    try {
      await uploadFile(`/tasks/${task.id}/files`, file, setProgress);
      qc.invalidateQueries({ queryKey: ["task", task.id] });
      toast("Файл додано до умови");
    } catch (e) { toast(e.message, "error"); }
    setProgress(null);
    if (input.current) input.current.value = "";
  };
  const remove = async (f) => {
    if (!(await confirm({ title: "Видалити файл умови?", message: f.file_name, confirmLabel: "Видалити", danger: true }))) return;
    await api(`/task-files/${f.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["task", task.id] });
  };
  return { upload, remove, progress, input };
}

export default function TaskPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [regen, setRegen] = useState(null);
  const q = useQuery({ queryKey: ["task", id], queryFn: () => api(`/tasks/${id}`) });
  const questions = useQuery({
    queryKey: ["posts", "task-questions", id],
    queryFn: () => api("/posts", { query: { type: "question", task_id: id, limit: 5 } }),
    enabled: q.isSuccess,
  });
  const files = useTaskFiles({ id });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const t = q.data;
  const kind = KINDS[t.kind];
  const dl = deadlineInfo(t.deadline_at);
  const subjectLink = `/subjects/${t.subject.slug}?tab=${t.kind}`;

  const removeTask = async () => {
    if (!(await confirm({ title: "Видалити завдання?", message: "Файли умови буде видалено. Завдання з поданнями видалити не можна.", confirmLabel: "Видалити", danger: true }))) return;
    try {
      await api(`/tasks/${t.id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      nav(subjectLink, { replace: true });
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <>
      <PageHeader back title={taskLabel(t)} subtitle={t.subject.name}
        actions={t.can_manage && (
          <div className="flex gap-1">
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Редагувати завдання"><Pencil size={17} /></button>
            <button className="icon-btn hover:!text-danger" onClick={removeTask} aria-label="Видалити завдання"><Trash2 size={17} /></button>
          </div>
        )} />

      <div className="px-4 pt-4 pb-2">
        <nav className="text-xs text-muted flex flex-wrap gap-x-1.5 mb-1.5" aria-label="Шлях">
          <Link to="/subjects" className="hover:underline">Предмети</Link><span aria-hidden>›</span>
          <Link to={`/subjects/${t.subject.slug}`} className="hover:underline break-words">{t.subject.name}</Link><span aria-hidden>›</span>
          <Link to={subjectLink} className="hover:underline">{kind.tab}</Link>
        </nav>
        <h1 className="font-display text-2xl leading-tight break-words">{t.title}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="chip bg-sunken text-ink">{kind.one} №{t.number}</span>
          <DeadlineChip iso={t.deadline_at} />
          {dl && !dl.past && <span className="text-xs text-muted">{dl.when}</span>}
        </div>
      </div>

      {/* 1. Умова й файли викладача */}
      <Section id="cond-h" title="Умова завдання" action={t.can_manage && (
        <>
          <input ref={files.input} type="file" className="sr-only" id="task-file" accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.zip"
            onChange={(e) => files.upload(e.target.files?.[0])} />
          <label htmlFor="task-file" className="btn-ghost h-8 px-3 text-xs cursor-pointer">
            <Upload size={14} /> {files.progress !== null ? `${files.progress}%` : "Додати файл"}
          </label>
        </>
      )}>
        {t.description ? <Markdown>{t.description}</Markdown> : <p className="text-sm text-muted">Умову ще не додано{t.can_manage ? " — натисніть ✎ угорі, щоб її заповнити." : "."}</p>}
        {t.files.length > 0 && (
          <div className="mt-3 space-y-2">
            {t.files.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0"><FileRow file={f} linkPath={`/task-files/${f.id}/link`} /></div>
                {t.can_manage && <button className="icon-btn hover:!text-danger" onClick={() => files.remove(f)} aria-label={`Видалити ${f.file_name}`}><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2. Опубліковані приклади */}
      <Section id="ex-h" title="Приклади виконання" count={t.examples.length}>
        {t.examples.length ? (
          <ul className="space-y-2">
            {t.examples.map((e) => (
              <li key={e.id}>
                <FileRow file={e} linkPath={`/submissions/${e.id}/link`}>
                  <span className="flex items-center gap-1.5 mt-1 text-xs text-muted min-w-0">
                    <AuthorLine author={e.author} />
                    <span aria-hidden>·</span><time dateTime={e.published_at} className="shrink-0">{timeAgo(e.published_at)}</time>
                  </span>
                  {e.format === "PDF" && (
                    <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline" onClick={() => setRegen(e)}>
                      <Wand2 size={14} aria-hidden /> Регенерувати звіт
                    </button>
                  )}
                </FileRow>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-line">
            <Empty title="Прикладів ще немає">Будьте першим: подайте свою роботу — після перевірки вона з'явиться тут і допоможе іншим.</Empty>
            <div className="pb-6 text-center"><button className="btn-primary" onClick={() => setSubmitting(true)}><Plus size={16} /> Подати свій варіант</button></div>
          </div>
        )}
      </Section>

      {/* 3–4. Подання й «Купити звіт» */}
      <section className="px-4 py-5 border-b border-line space-y-4" aria-label="Дії">
        <button className="btn-primary w-full sm:w-auto" onClick={() => setSubmitting(true)}><Upload size={16} /> Подати свій варіант</button>
        {t.my_submissions.length > 0 && (
          <div className="rounded-xl bg-sunken p-3">
            <div className="text-xs font-semibold text-muted mb-2">Ваші подання до цього завдання</div>
            <ul className="space-y-1.5">
              {t.my_submissions.map((s) => (
                <li key={s.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all">{s.file_name}</span><StatusChip status={s.status} />
                    {s.is_anonymous && <span className="chip bg-sunken text-muted">анонімно</span>}
                    <span className="text-xs text-muted">{timeAgo(s.created_at)}</span>
                  </div>
                  {s.status === "rejected" && s.review_note && <div className="text-xs text-danger mt-0.5">Причина: {s.review_note}</div>}
                </li>
              ))}
            </ul>
            <Link to="/submissions" className="inline-block mt-2 text-xs text-primary hover:underline">Усі мої подання</Link>
          </div>
        )}
        <div className="flex items-start gap-3 rounded-xl border border-line p-3">
          <Wand2 size={18} className="text-primary shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs text-muted">
            <b className="text-ink">Регенерувати звіт</b> — ШІ покаже приклад іншого оформлення затвердженої роботи: нова стилізація
            й висновки іншими словами, а підзаголовки, теорія й хід роботи — без змін. Натисніть «Регенерувати звіт» біля прикладу вище.
          </p>
        </div>
      </section>

      {/* Питання з цього завдання */}
      <Section id="tq-h" title="Питання до завдання" action={
        <Link to={`/subjects/${t.subject.slug}?tab=questions&task=${t.id}&ask=1`} className="btn-ghost h-8 px-3 text-xs"><MessageCircleQuestion size={14} /> Запитати</Link>
      }>
        {questions.data?.items?.length ? (
          <ul className="divide-y divide-line">
            {questions.data.items.map((p) => (
              <li key={p.id}><Link to={`/p/${p.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-primary">
                <span className="text-sm font-medium break-words min-w-0">{p.title}</span>
                <span className="text-xs text-muted shrink-0">{p.comment_count} відп.</span>
              </Link></li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Питань ще немає.</p>}
      </Section>

      <nav className="flex justify-between gap-2 px-4 py-4" aria-label="Інші завдання">
        {t.prev ? <Link to={`/tasks/${t.prev.id}`} className="btn-quiet h-9 px-3 text-sm min-w-0"><ChevronLeft size={16} /><span className="truncate">№{t.prev.number}</span></Link> : <span />}
        {t.next ? <Link to={`/tasks/${t.next.id}`} className="btn-quiet h-9 px-3 text-sm min-w-0"><span className="truncate">№{t.next.number}</span><ChevronRight size={16} /></Link> : <span />}
      </nav>

      <SubmitDialog task={t} open={submitting} onClose={() => setSubmitting(false)} />
      {regen && <RegenerateDialog example={regen} task={t} open={Boolean(regen)} onClose={() => setRegen(null)} />}
      {t.can_manage && editing && <EditTaskDialog task={t} open={editing} onClose={() => setEditing(false)} />}
    </>
  );
}
