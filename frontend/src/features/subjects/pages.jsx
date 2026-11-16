import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, Check, ChevronRight, FileText, MessageCircleQuestion, MessagesSquare, Plus, Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { useSession } from "../../app/session.jsx";
import { Empty, ErrorState, Loading, Modal, useToast } from "../../components/ui.jsx";
import { PageHeader, UrlTabs } from "../../components/PageHeader.jsx";
import { DeadlineChip, KINDS, StatusChip, taskLabel } from "../tasks/shared.jsx";

function SubscribeButton({ subject }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/subjects/${subject.id}/subscribe`, { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["subjects"] });
      qc.invalidateQueries({ queryKey: ["subject"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      toast(r.subscribed ? `Ви підписались на «${subject.name}»` : "Підписку скасовано");
    },
  });
  return subject.subscribed ? (
    <button className="btn-ghost h-9 shrink-0" onClick={(e) => { e.preventDefault(); m.mutate(); }} disabled={m.isPending} aria-label={`Скасувати підписку на ${subject.name}`}><Check size={16} /> <span className="hidden sm:inline">Підписка</span></button>
  ) : (
    <button className="btn-primary h-9 shrink-0" onClick={(e) => { e.preventDefault(); m.mutate(); }} disabled={m.isPending} aria-label={`Підписатися на ${subject.name}`}><BellPlus size={16} /> <span className="hidden sm:inline">Підписатися</span></button>
  );
}

export function SubjectsPage() {
  const { activeUniversityId } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const view = params.get("view") || "course";
  const mine = view === "mine";
  const scope = { course: "course", program: "program" }[view] || "all";
  const list = useQuery({ queryKey: ["subjects", activeUniversityId, q, view], queryFn: () => api("/subjects", { query: { q, mine: mine || undefined, scope } }) });
  return (
    <>
      <PageHeader title="Предмети" subtitle="Завдання, приклади виконання та питання за предметами">
        <div className="px-4 pb-2">
          <label className="relative block">
            <span className="sr-only">Пошук предмета</span>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className="input pl-9 rounded-full" placeholder="Пошук предмета" value={q}
              onChange={(e) => setParams((p) => { e.target.value ? p.set("q", e.target.value) : p.delete("q"); return p; }, { replace: true })} />
          </label>
        </div>
        <UrlTabs param="view" defaultValue="course" tabs={[
          { value: "course", label: "Мій курс" }, { value: "program", label: "Спеціальність" },
          { value: "mine", label: "Підписки" }, { value: "all", label: "Усі" },
        ]} />
      </PageHeader>
      {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data.length ? (
        <Empty title={mine ? "Ви ще не підписані на предмети" : "Предметів не знайдено"}>
          {view === "course" ? "Перевірте спеціальність і курс у Налаштуваннях або перегляньте вкладку «Спеціальність»." : null}
        </Empty>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3 p-4">
          {list.data.map((s) => (
            <li key={s.id}>
              <Link to={`/subjects/${s.slug}`} className="card p-4 flex flex-col gap-2 h-full hover:border-primary transition-colors">
                <div className="font-semibold leading-snug break-words">{s.name}
                  {s.is_elective && <span className="chip bg-sunken text-muted ml-1.5 align-middle">за вибором</span>}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted flex-1">
                  <span>{s.task_count} завдань</span><span>{s.example_count} прикладів</span><span>{s.question_count} питань</span>
                  {s.courses.length > 0 && <span>{s.courses.join(", ")} курс</span>}
                </div>
                <div className="flex justify-end"><SubscribeButton subject={s} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Розділ із завданнями ----------
function AddTasksDialog({ subject, kind, open, onClose, nextNumber }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState("one");
  const [f, setF] = useState({ number: nextNumber, title: "", count: 10 });
  const [error, setError] = useState(null);
  useEffect(() => { setF((x) => ({ ...x, number: nextNumber })); }, [nextNumber]);
  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "one") {
        await api("/tasks", { method: "POST", body: { subject_id: subject.id, kind, number: Number(f.number), title: f.title || `${KINDS[kind].one} №${f.number}` } });
        toast("Завдання додано");
      } else {
        const r = await api("/tasks/bulk", { method: "POST", body: { subject_id: subject.id, kind, count: Number(f.count) } });
        toast(r.created ? `Додано завдань: ${r.created}` : "Усі номери вже існують");
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["subjects"] });
      onClose();
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Додати: ${KINDS[kind].tab.toLowerCase()}`} labelledBy="add-task-h">
      <form onSubmit={save} className="p-4 space-y-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Спосіб додавання">
          <button type="button" role="radio" aria-checked={mode === "one"} className="pill" aria-pressed={mode === "one"} onClick={() => setMode("one")}>Одне завдання</button>
          <button type="button" role="radio" aria-checked={mode === "many"} className="pill" aria-pressed={mode === "many"} onClick={() => setMode("many")}>Кілька одразу</button>
        </div>
        {mode === "one" ? (
          <div className="grid grid-cols-[90px_1fr] gap-3">
            <div><label className="label" htmlFor="at-n">Номер</label>
              <input id="at-n" type="number" min={1} max={99} className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} required /></div>
            <div><label className="label" htmlFor="at-t">Назва</label>
              <input id="at-t" className="input" maxLength={200} placeholder={`${KINDS[kind].one} №${f.number}`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          </div>
        ) : (
          <div><label className="label" htmlFor="at-c">Скільки створити (№1…N, наявні пропускаються)</label>
            <input id="at-c" type="number" min={1} max={30} className="input" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} required /></div>
        )}
        <p className="text-xs text-muted">Умову, файли й дедлайн додасте на сторінці завдання.</p>
        {error && <div className="text-sm text-danger" role="alert">{error}</div>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Скасувати</button><button className="btn-primary">Додати</button></div>
      </form>
    </Modal>
  );
}

function TaskSection({ subject, kind }) {
  const { activeUniversityId } = useSession();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["tasks", activeUniversityId, subject.slug, kind], queryFn: () => api(`/subjects/${subject.slug}/tasks`, { query: { kind } }) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const items = q.data.items;
  const next = items.reduce((m, t) => Math.max(m, t.number), 0) + 1;
  return (
    <div>
      {q.data.can_manage && (
        <div className="px-4 pt-3 flex justify-end">
          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setAdding(true)}><Plus size={14} /> Додати завдання</button>
        </div>
      )}
      {!items.length ? (
        <Empty title={`${KINDS[kind].tab} ще не додано`} icon={FileText}>
          {q.data.can_manage ? "Додайте завдання — студенти зможуть подавати свої варіанти." : "Щойно викладач або адміністратор додасть завдання, вони з'являться тут."}
        </Empty>
      ) : (
        <ul className="p-4 space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <Link to={`/tasks/${t.id}`} className="card p-3 sm:p-4 flex items-start gap-3 hover:border-primary transition-colors">
                <span className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center font-display text-lg shrink-0" aria-hidden>{t.number}</span>
                <span className="flex-1 min-w-0">
                  {t.title.trim() !== taskLabel(t) && <span className="block text-xs text-muted">{taskLabel(t)}</span>}
                  <span className="block font-semibold leading-snug break-words">{t.title}</span>
                  {t.description && <span className="text-sm text-muted line-clamp-2 mt-0.5 break-words">{t.description.replace(/[#*_`>]/g, "")}</span>}
                  <span className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className={`chip ${t.examples ? "bg-primary/15 text-primary" : "bg-sunken text-muted"}`}>{t.examples ? `${t.examples} прикл.` : "Без прикладів"}</span>
                    {t.files > 0 && <span className="chip bg-sunken text-muted">{t.files} файл.</span>}
                    {t.questions > 0 && <span className="chip bg-sunken text-muted">{t.questions} пит.</span>}
                    <DeadlineChip iso={t.deadline_at} />
                    {t.my_status && <StatusChip status={t.my_status} />}
                  </span>
                </span>
                <ChevronRight size={18} className="text-muted shrink-0 mt-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {q.data.can_manage && adding && <AddTasksDialog subject={subject} kind={kind} open={adding} nextNumber={next} onClose={() => setAdding(false)} />}
    </div>
  );
}

// ---------- Форум предмета ----------
function AskDialog({ subject, tasks, open, onClose, defaultTask }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ title: "", body: "", task_id: defaultTask || "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api("/posts", { method: "POST", body: { type: "question", subject_id: subject.id, title: f.title.trim(), body: f.body, task_id: f.task_id || null } });
      qc.invalidateQueries({ queryKey: ["forum"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
      toast("Питання опубліковано");
      onClose(p.id);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={() => onClose()} title="Нове питання" labelledBy="ask-h" wide>
      <form onSubmit={send} className="p-4 space-y-3">
        <div className="text-xs text-muted">Предмет: <b className="text-ink">{subject.name}</b></div>
        <div><label className="label" htmlFor="ask-t">Питання</label>
          <input id="ask-t" className="input" required minLength={5} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder="Коротко й конкретно: що саме незрозуміло?" /></div>
        <div><label className="label" htmlFor="ask-b">Подробиці (необов'язково)</label>
          <textarea id="ask-b" className="textarea min-h-[120px]" maxLength={20000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
            placeholder="Що вже спробували, де застрягли. Підтримується Markdown і формули $x^2$." /></div>
        <div><label className="label" htmlFor="ask-task">Стосується завдання</label>
          <select id="ask-task" className="input" value={f.task_id} onChange={(e) => setF({ ...f, task_id: e.target.value })}>
            <option value="">Загальне питання з предмета</option>
            {Object.keys(KINDS).map((k) => {
              const list = tasks.filter((t) => t.kind === k);
              return list.length ? <optgroup key={k} label={KINDS[k].tab}>{list.map((t) => <option key={t.id} value={t.id}>№{t.number} · {t.title}</option>)}</optgroup> : null;
            })}
          </select></div>
        {error && <div className="text-sm text-danger" role="alert">{error}</div>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onClose()}>Скасувати</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Публікуємо…" : "Опублікувати"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Forum({ subject }) {
  const { activeUniversityId } = useSession();
  const [params, setParams] = useSearchParams();
  const taskFilter = params.get("task") || "";
  const [asking, setAsking] = useState(params.get("ask") === "1");
  const nav = useNavigate();
  const tasks = useQuery({ queryKey: ["tasks", activeUniversityId, subject.slug, "all"], queryFn: () => api(`/subjects/${subject.slug}/tasks`) });
  const threads = useInfiniteQuery({
    queryKey: ["forum", activeUniversityId, subject.id, taskFilter],
    queryFn: ({ pageParam = 0 }) => api("/posts", { query: { type: "question", subject_id: subject.id, task_id: taskFilter || undefined, offset: pageParam, limit: 20 } }),
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const close = (createdId) => {
    setAsking(false);
    setParams((p) => { p.delete("ask"); return p; }, { replace: true });
    if (createdId) nav(`/p/${createdId}`);
  };
  const items = threads.data?.pages.flatMap((p) => p.items) || [];
  const taskList = tasks.data?.items || [];
  return (
    <div>
      <div className="px-4 pt-3 flex flex-col sm:flex-row gap-2 sm:items-center">
        <select className="input h-9 sm:max-w-xs" aria-label="Фільтр за завданням" value={taskFilter}
          onChange={(e) => setParams((p) => { e.target.value ? p.set("task", e.target.value) : p.delete("task"); return p; }, { replace: true })}>
          <option value="">Усі питання</option>
          {taskList.map((t) => <option key={t.id} value={t.id}>{KINDS[t.kind].short}-{t.number} · {t.title}</option>)}
        </select>
        <button className="btn-primary h-9 sm:ml-auto" onClick={() => setAsking(true)}><MessageCircleQuestion size={16} /> Поставити питання</button>
      </div>
      {threads.isLoading ? <Loading /> : threads.isError ? <ErrorState error={threads.error} onRetry={threads.refetch} /> : !items.length ? (
        <Empty title="Питань ще немає" icon={MessagesSquare}>Поставте перше — однокурсники допоможуть розібратися.</Empty>
      ) : (
        <ul className="p-4 space-y-2">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className="card p-3 sm:p-4 flex items-start gap-3 hover:border-primary transition-colors">
                <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 text-center leading-none ${p.comment_count ? "bg-primary/10 text-primary" : "bg-sunken text-muted"}`}>
                  <span><span className="block font-display text-base">{p.comment_count}</span><span className="block text-[10px]">відп.</span></span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold leading-snug break-words">{p.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted">
                    <span className="truncate max-w-[160px]">{p.author.display_name}</span>
                    <time dateTime={p.created_at}>{timeAgo(p.created_at)}</time>
                    {p.task && <span className="chip bg-sunken text-ink">{KINDS[p.task.kind]?.short}-{p.task.number}</span>}
                    {p.status === "solved" && <span className="chip bg-primary/15 text-primary">Вирішено</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {threads.hasNextPage && (
        <div className="px-4 pb-4"><button className="btn-ghost w-full" onClick={() => threads.fetchNextPage()} disabled={threads.isFetchingNextPage}>Показати ще</button></div>
      )}
      {asking && <AskDialog subject={subject} tasks={taskList} open={asking} onClose={close} defaultTask={taskFilter} />}
    </div>
  );
}

const TABS = [...Object.entries(KINDS).map(([value, k]) => ({ value, label: k.tab })), { value: "questions", label: "Питання" }];

export function SubjectPage() {
  const { slug } = useParams();
  const { activeUniversityId } = useSession();
  const [params] = useSearchParams();
  const tab = TABS.some((x) => x.value === params.get("tab")) ? params.get("tab") : "lab";
  const s = useQuery({ queryKey: ["subject", activeUniversityId, slug], queryFn: () => api(`/subjects/${slug}`) });
  const counts = useQuery({ queryKey: ["tasks", activeUniversityId, slug, "all"], queryFn: () => api(`/subjects/${slug}/tasks`), enabled: s.isSuccess });
  if (s.isLoading) return <Loading />;
  if (s.isError) return <ErrorState error={s.error} onRetry={s.refetch} />;
  const subj = s.data;
  const c = counts.data?.counts;
  return (
    <>
      <PageHeader back title={subj.name} subtitle={`${subj.followers} підписників`} actions={<SubscribeButton subject={subj} />}>
        <UrlTabs param="tab" defaultValue="lab" tabs={TABS.map((x) => ({ ...x, label: c && x.value in c && c[x.value] ? `${x.label} · ${c[x.value]}` : x.label }))} />
      </PageHeader>
      {subj.description && tab !== "questions" && <p className="px-4 pt-3 text-sm text-muted">{subj.description}</p>}
      {tab === "questions" ? <Forum subject={subj} /> : <TaskSection key={tab} subject={subj} kind={tab} />}
    </>
  );
}
