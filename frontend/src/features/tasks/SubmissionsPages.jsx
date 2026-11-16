import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, Inbox, Link2, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { useSession } from "../../app/session.jsx";
import { Avatar, Empty, ErrorState, Loading, useConfirm, useToast } from "../../components/ui.jsx";
import { PageHeader, UrlPills } from "../../components/PageHeader.jsx";
import { FileRow, KINDS, StatusChip, taskFullTitle, useFileOpener } from "./shared.jsx";

function TaskRef({ s }) {
  if (!s.task) return null;
  return (
    <Link to={`/tasks/${s.task.id}`} className="block text-xs text-muted hover:text-primary break-words">
      {s.subject?.name} · {taskFullTitle(s.task)}
    </Link>
  );
}

// ---------- Мої подання (студент) ----------
export function MySubmissionsPage() {
  const { activeUniversityId } = useSession();
  const [params] = useSearchParams();
  const status = params.get("status") || "";
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const openFile = useFileOpener();
  const q = useQuery({ queryKey: ["my-submissions", activeUniversityId], queryFn: () => api("/me/submissions") });
  const withdraw = async (s) => {
    if (!(await confirm({ title: "Відкликати подання?", message: s.file_name, confirmLabel: "Відкликати", danger: true }))) return;
    try {
      await api(`/submissions/${s.id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["my-submissions"] });
      toast("Подання відкликано");
    } catch (e) { toast(e.message, "error"); }
  };
  const items = (q.data || []).filter((s) => !status || s.status === status);
  return (
    <>
      <PageHeader title="Мої подання" subtitle="Роботи, надіслані на перевірку">
        <UrlPills param="status" allLabel="Усі" options={[
          { value: "pending", label: "На розгляді" }, { value: "approved", label: "Опубліковано" }, { value: "rejected", label: "Відхилено" },
        ]} />
      </PageHeader>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !items.length ? (
        <Empty title={status ? "Тут порожньо" : "Ви ще нічого не подавали"} icon={ClipboardList}>
          Відкрийте завдання в розділі <Link to="/subjects" className="text-primary hover:underline">«Предмети»</Link> і натисніть «Подати свій варіант».
        </Empty>
      ) : (
        <ul className="p-4 space-y-3">
          {items.map((s) => (
            <li key={s.id} className="card p-3 sm:p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <TaskRef s={s} />
                <StatusChip status={s.status} />
              </div>
              <FileRow file={s} onOpen={() => openFile(`/submissions/${s.id}/link`)}>
                <span className="block text-xs text-muted mt-0.5">Надіслано {timeAgo(s.created_at)}{s.status === "approved" && s.download_count ? ` · завантажень: ${s.download_count}` : ""}</span>
              </FileRow>
              {s.comment && <p className="text-xs text-muted break-words">Ваш коментар: {s.comment}</p>}
              {s.status === "rejected" && s.review_note && (
                <div className="rounded-xl bg-danger/10 text-danger text-sm px-3 py-2 break-words"><b>Причина:</b> {s.review_note}</div>
              )}
              {s.status === "pending" && (
                <div className="flex justify-end"><button className="btn-quiet h-8 px-3 text-xs text-danger" onClick={() => withdraw(s)}>Відкликати</button></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Модерація подань ----------
function ReviewCard({ s, onDone }) {
  const toast = useToast();
  const openFile = useFileOpener();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action) => {
    setBusy(true);
    try {
      await api(`/moderation/submissions/${s.id}`, { method: "POST", body: { action, note: action === "reject" ? note : undefined } });
      toast(action === "approve" ? "Роботу опубліковано біля завдання" : "Роботу відхилено, автор побачить причину");
      onDone();
    } catch (e) { toast(e.message, "error"); }
    setBusy(false);
  };
  return (
    <li className="card p-3 sm:p-4 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar user={s.author} size={28} />
        <Link to={`/u/${s.author.id}`} className="text-sm font-semibold truncate hover:underline">{s.author.display_name}</Link>
        <span className="text-xs text-muted shrink-0">· {timeAgo(s.created_at)}</span>
        <span className="ml-auto"><StatusChip status={s.status} /></span>
      </div>
      <TaskRef s={s} />
      <FileRow file={s} onOpen={() => openFile(`/submissions/${s.id}/link`)} />
      {s.comment && <p className="text-sm rounded-xl bg-sunken px-3 py-2 break-words"><span className="text-muted">Коментар автора:</span> {s.comment}</p>}
      {s.status === "rejected" && s.review_note && <p className="text-xs text-danger break-words">Причина: {s.review_note}</p>}
      {rejecting ? (
        <div className="space-y-2">
          <label className="label" htmlFor={`note-${s.id}`}>Причина відхилення (побачить автор)</label>
          <textarea id={`note-${s.id}`} className="textarea min-h-[80px]" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Наприклад: бракує висновків, файл не відкривається" autoFocus />
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button className="btn-ghost h-9" onClick={() => setRejecting(false)}>Скасувати</button>
            <button className="btn h-9 bg-danger text-white hover:opacity-90" disabled={busy || !note.trim()} onClick={() => act("reject")}><X size={15} /> Відхилити</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
          {s.status !== "rejected" && <button className="btn-ghost h-9" disabled={busy} onClick={() => setRejecting(true)}><X size={15} /> {s.status === "approved" ? "Зняти з публікації" : "Відхилити"}</button>}
          {s.status !== "approved" && <button className="btn-primary h-9" disabled={busy} onClick={() => act("approve")}><Check size={15} /> Схвалити й опублікувати</button>}
        </div>
      )}
    </li>
  );
}

export function ModerationQueue() {
  const { activeUniversityId } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const q = useQuery({ queryKey: ["moderation", activeUniversityId, status], queryFn: () => api("/moderation/submissions", { query: { status } }) });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["moderation"] });
    qc.invalidateQueries({ queryKey: ["task"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto scrollbar-none px-4 py-2.5" role="radiogroup" aria-label="Статус">
        {[["pending", "На розгляді"], ["approved", "Опубліковані"], ["rejected", "Відхилені"]].map(([v, l]) => (
          <button key={v} role="radio" aria-checked={status === v} className="pill" aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.length ? (
        <Empty title={status === "pending" ? "Черга порожня" : "Тут порожньо"} icon={Inbox}>{status === "pending" ? "Нові подання студентів з'являться тут." : null}</Empty>
      ) : (
        <ul className="px-4 pb-4 space-y-3">{q.data.map((s) => <ReviewCard key={s.id} s={s} onDone={done} />)}</ul>
      )}
    </div>
  );
}

// ---------- Розподіл старих матеріалів по завданнях ----------
function AssignRow({ item, onDone }) {
  const { activeUniversityId } = useSession();
  const toast = useToast();
  const openFile = useFileOpener();
  const [subject, setSubject] = useState(item.subject?.slug || "");
  const [taskId, setTaskId] = useState("");
  const subjects = useQuery({ queryKey: ["subjects", activeUniversityId, "", "all"], queryFn: () => api("/subjects", { query: { scope: "all" } }) });
  const tasks = useQuery({ queryKey: ["tasks", activeUniversityId, subject, "all"], queryFn: () => api(`/subjects/${subject}/tasks`), enabled: Boolean(subject) });
  const assign = async () => {
    try {
      await api("/moderation/assign", { method: "POST", body: { attachment_id: item.id, task_id: taskId } });
      toast("Матеріал опубліковано біля завдання");
      onDone();
    } catch (e) { toast(e.message, "error"); }
  };
  return (
    <li className="card p-3 sm:p-4 space-y-2">
      <Link to={`/p/${item.post.id}`} className="block text-sm font-semibold hover:underline break-words">{item.post.title}</Link>
      <div className="text-xs text-muted">{item.author?.display_name} · {item.subject?.name}</div>
      <FileRow file={item} onOpen={() => openFile(`/attachments/${item.id}/link`)} />
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
        <select className="input h-9" aria-label="Предмет" value={subject} onChange={(e) => { setSubject(e.target.value); setTaskId(""); }}>
          <option value="">Предмет…</option>
          {subjects.data?.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
        </select>
        <select className="input h-9" aria-label="Завдання" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!tasks.data?.items?.length}>
          <option value="">{subject && tasks.data && !tasks.data.items.length ? "У предмета немає завдань" : "Завдання…"}</option>
          {tasks.data?.items.map((t) => <option key={t.id} value={t.id}>{KINDS[t.kind].short}-{t.number} · {t.title}</option>)}
        </select>
        <button className="btn-primary h-9" disabled={!taskId} onClick={assign}><Link2 size={15} /> Прив'язати</button>
      </div>
    </li>
  );
}

export function UnassignedMaterials() {
  const { activeUniversityId } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["moderation", activeUniversityId, "unassigned"], queryFn: () => api("/moderation/unassigned") });
  const done = () => { qc.invalidateQueries({ queryKey: ["moderation"] }); qc.invalidateQueries({ queryKey: ["task"] }); qc.invalidateQueries({ queryKey: ["tasks"] }); };
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div>
      <p className="px-4 pt-3 text-sm text-muted">Файли з попередніх дописів-матеріалів. Прив'яжіть кожен до відповідного завдання — він з'явиться серед прикладів виконання.</p>
      {!q.data.length ? <Empty title="Усі матеріали розподілено" /> : (
        <ul className="p-4 space-y-3">{q.data.map((i) => <AssignRow key={i.id} item={i} onDone={done} />)}</ul>
      )}
    </div>
  );
}
