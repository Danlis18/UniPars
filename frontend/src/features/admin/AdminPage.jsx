import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { useSession } from "../../app/session.jsx";
import { Empty, ErrorState, Loading, useConfirm, useToast } from "../../components/ui.jsx";
import { PageHeader, UrlTabs } from "../../components/PageHeader.jsx";

// Кнопки приховано від студентів, але кожна операція окремо перевіряється на backend.
function useAdmin(key, path, enabled = true) {
  const { activeUniversityId } = useSession();
  return useQuery({ queryKey: ["admin", activeUniversityId, key], queryFn: () => api(path), enabled });
}

function Overview() {
  const o = useAdmin("overview", "/admin/overview");
  if (o.isLoading) return <Loading />;
  if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />;
  const d = o.data;
  return (
    <div className="p-4 grid grid-cols-3 gap-3">
      {[["Учасників", d.members], ["Дописів", d.posts], ["Відкритих скарг", d.open_reports]].map(([l, v]) => (
        <div key={l} className="card p-4"><div className="text-2xl font-display">{v}</div><div className="text-xs text-muted">{l}</div></div>
      ))}
      <div className="col-span-3 text-sm text-muted">Ваша роль: <b>{d.role === "admin" ? "адміністратор" : "модератор"}</b> університету «{d.university?.name}».</div>
    </div>
  );
}

function Reports() {
  const qc = useQueryClient();
  const toast = useToast();
  const r = useAdmin("reports", "/admin/reports");
  const act = async (id, action) => {
    await api(`/admin/reports/${id}/resolve`, { method: "POST", body: { action } });
    toast(action === "hide" ? "Вміст приховано" : "Скаргу відхилено");
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["posts"] });
  };
  if (r.isLoading) return <Loading />;
  if (r.isError) return <ErrorState error={r.error} onRetry={r.refetch} />;
  if (!r.data.length) return <Empty title="Відкритих скарг немає" />;
  return (
    <ul>
      {r.data.map((x) => (
        <li key={x.id} className="px-4 py-3 border-b border-line">
          <div className="text-xs text-muted">{x.target_type === "post" ? "Допис" : "Коментар"} · {timeAgo(x.created_at)}</div>
          {x.post_id ? <Link to={`/p/${x.post_id}`} className="font-semibold hover:underline break-words">{x.target_preview}</Link> : <div className="font-semibold">{x.target_preview}</div>}
          <div className="text-sm mt-1">Причина: {x.reason}</div>
          <div className="flex gap-2 mt-2">
            <button className="btn-primary h-8 text-xs" onClick={() => act(x.id, "hide")}><EyeOff size={14} /> Приховати</button>
            <button className="btn-ghost h-8 text-xs" onClick={() => act(x.id, "dismiss")}><XCircle size={14} /> Відхилити</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Members() {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useAdmin("members", "/admin/members");
  if (m.isLoading) return <Loading />;
  if (m.isError) return <ErrorState error={m.error} onRetry={m.refetch} />;
  const setRole = async (uid, role) => {
    try {
      await api(`/admin/members/${uid}`, { method: "PATCH", body: { role } });
      toast("Роль змінено");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) { toast(e.message, "error"); }
  };
  return (
    <ul>
      {m.data.map((x) => (
        <li key={x.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line">
          <span className="truncate">{x.display_name}</span>
          <select className="input h-8 w-40" value={x.role} disabled={x.user_id === me.id} onChange={(e) => setRole(x.user_id, e.target.value)} aria-label={`Роль: ${x.display_name}`}>
            <option value="student">Студент</option><option value="moderator">Модератор</option><option value="admin">Адміністратор</option>
          </select>
        </li>
      ))}
    </ul>
  );
}

function Catalog() {
  const { activeUniversityId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const subjects = useQuery({ queryKey: ["subjects", activeUniversityId, ""], queryFn: () => api("/subjects") });
  const structure = useQuery({ queryKey: ["structure", activeUniversityId], queryFn: () => api(`/universities/${activeUniversityId}/structure`) });
  const [s, setS] = useState({ name: "", slug: "", description: "", program_ids: [], course: "", semester: "" });
  const [topic, setTopic] = useState({ subject: "", name: "" });
  const [fac, setFac] = useState("");
  const [prog, setProg] = useState({ faculty_id: "", name: "", code: "" });
  const [grp, setGrp] = useState({ program_id: "", name: "", course: "" });
  const run = async (fn, msg) => {
    try { await fn(); toast(msg); qc.invalidateQueries({ queryKey: ["subjects"] }); qc.invalidateQueries({ queryKey: ["structure"] }); }
    catch (e) { toast(e.message, "error"); }
  };
  return (
    <div className="p-4 space-y-8">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => api("/admin/subjects", { method: "POST", body: { ...s, course: s.course ? Number(s.course) : null, semester: s.semester ? Number(s.semester) : null } }), "Предмет додано").then(() => setS({ name: "", slug: "", description: "", program_ids: [], course: "", semester: "" })); }}>
        <h2 className="font-display text-base">Новий предмет</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className="input" placeholder="Назва" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} required />
          <input className="input" placeholder="адреса-латиницею" pattern="[a-z0-9-]+" value={s.slug} onChange={(e) => setS({ ...s, slug: e.target.value })} required />
        </div>
        <textarea className="textarea" placeholder="Опис" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
        <div className="text-xs text-muted">Спеціальності (предмет може належати кільком):</div>
        <div className="flex flex-wrap gap-2">
          {structure.data?.programs.map((p) => (
            <button type="button" key={p.id} className="pill" aria-pressed={s.program_ids.includes(p.id)}
              onClick={() => setS({ ...s, program_ids: s.program_ids.includes(p.id) ? s.program_ids.filter((x) => x !== p.id) : [...s.program_ids, p.id] })}>{p.name}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input w-28" type="number" min={1} max={6} placeholder="Курс" value={s.course} onChange={(e) => setS({ ...s, course: e.target.value })} />
          <input className="input w-28" type="number" min={1} max={12} placeholder="Семестр" value={s.semester} onChange={(e) => setS({ ...s, semester: e.target.value })} />
          <button className="btn-primary"><Plus size={16} /> Додати</button>
        </div>
      </form>

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/admin/subjects/${topic.subject}/topics`, { method: "POST", body: { name: topic.name } }), "Тему додано").then(() => setTopic({ ...topic, name: "" })); }}>
        <h2 className="font-display text-base">Нова тема</h2>
        <div className="flex gap-2 flex-wrap">
          <select className="input w-auto" value={topic.subject} onChange={(e) => setTopic({ ...topic, subject: e.target.value })} required>
            <option value="">Предмет</option>{subjects.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <input className="input flex-1 min-w-[160px]" placeholder="Назва теми" value={topic.name} onChange={(e) => setTopic({ ...topic, name: e.target.value })} required />
          <button className="btn-primary"><Plus size={16} /> Додати</button>
        </div>
      </form>

      <div className="space-y-3">
        <h2 className="font-display text-base">Структура університету</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api("/admin/faculties", { method: "POST", body: { name: fac } }), "Факультет додано").then(() => setFac("")); }}>
          <input className="input" placeholder="Новий факультет / підрозділ" value={fac} onChange={(e) => setFac(e.target.value)} required />
          <button className="btn-ghost shrink-0"><Plus size={16} /></button>
        </form>
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => api("/admin/programs", { method: "POST", body: prog }), "Спеціальність додано").then(() => setProg({ ...prog, name: "", code: "" })); }}>
          <select className="input w-auto" value={prog.faculty_id} onChange={(e) => setProg({ ...prog, faculty_id: e.target.value })} required>
            <option value="">Факультет</option>{structure.data?.faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <input className="input w-24" placeholder="Код" value={prog.code} onChange={(e) => setProg({ ...prog, code: e.target.value })} />
          <input className="input flex-1 min-w-[160px]" placeholder="Спеціальність" value={prog.name} onChange={(e) => setProg({ ...prog, name: e.target.value })} required />
          <button className="btn-ghost"><Plus size={16} /></button>
        </form>
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => api("/admin/groups", { method: "POST", body: { ...grp, course: grp.course ? Number(grp.course) : null } }), "Групу додано").then(() => setGrp({ ...grp, name: "" })); }}>
          <select className="input w-auto" value={grp.program_id} onChange={(e) => setGrp({ ...grp, program_id: e.target.value })} required>
            <option value="">Спеціальність</option>{structure.data?.programs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <input className="input w-24" type="number" min={1} max={6} placeholder="Курс" value={grp.course} onChange={(e) => setGrp({ ...grp, course: e.target.value })} />
          <input className="input flex-1 min-w-[120px]" placeholder="Назва групи" value={grp.name} onChange={(e) => setGrp({ ...grp, name: e.target.value })} required />
          <button className="btn-ghost"><Plus size={16} /></button>
        </form>
      </div>
    </div>
  );
}

function News() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const src = useAdmin("sources", "/admin/news-sources");
  const [f, setF] = useState({ kind: "rss", name: "", url: "", refresh_minutes: 30, config: "" });
  const [ann, setAnn] = useState({ title: "", summary: "", url: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin"] }); qc.invalidateQueries({ queryKey: ["news"] }); };
  const add = async (e) => {
    e.preventDefault();
    try {
      let config = {};
      if (f.kind === "json_api" && f.config.trim()) config = JSON.parse(f.config);
      await api("/admin/news-sources", { method: "POST", body: { kind: f.kind, name: f.name, url: f.url || null, refresh_minutes: Number(f.refresh_minutes), config } });
      toast("Джерело додано");
      setF({ ...f, name: "", url: "", config: "" });
      refresh();
    } catch (err) { toast(err instanceof SyntaxError ? "Конфігурація має бути коректним JSON" : err.message, "error"); }
  };
  const sync = async (id) => {
    const r = await api(`/admin/news-sources/${id}/sync`, { method: "POST" });
    toast(r.last_error ? `Помилка: ${r.last_error}` : "Синхронізовано", r.last_error ? "error" : "ok");
    refresh();
  };
  const del = async (s) => {
    if (!(await confirm({ title: "Видалити джерело?", message: `«${s.name}» та його новини буде видалено.`, confirmLabel: "Видалити", danger: true }))) return;
    await api(`/admin/news-sources/${s.id}`, { method: "DELETE" });
    refresh();
  };
  const announce = async (e) => {
    e.preventDefault();
    try {
      await api("/admin/announcements", { method: "POST", body: { ...ann, url: ann.url || null } });
      toast("Оголошення опубліковано");
      setAnn({ title: "", summary: "", url: "" });
      refresh();
    } catch (err) { toast(err.message, "error"); }
  };
  return (
    <div className="p-4 space-y-8">
      <section>
        <h2 className="font-display text-base mb-2">Джерела новин</h2>
        {src.isLoading ? <Loading /> : (
          <ul className="space-y-2 mb-4">
            {src.data?.map((s) => (
              <li key={s.id} className="card p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{s.name} <span className="chip bg-sunken text-muted ml-1">{s.kind}</span></div>
                  {s.url && <div className="text-xs text-muted truncate">{s.url}</div>}
                  <div className="text-xs text-muted">{s.last_synced_at ? `Синхронізовано ${timeAgo(s.last_synced_at)} тому` : "Ще не синхронізовано"}{s.last_error && <span className="text-danger"> · {s.last_error}</span>}</div>
                </div>
                {s.kind !== "manual" && <button className="icon-btn" onClick={() => sync(s.id)} aria-label="Синхронізувати"><RefreshCw size={16} /></button>}
                <button className="icon-btn" onClick={() => del(s)} aria-label="Видалити джерело"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <select className="input w-auto" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="rss">RSS / Atom</option><option value="json_api">Офіційний API (JSON)</option><option value="manual">Ручні оголошення</option>
            </select>
            <input className="input flex-1 min-w-[160px]" placeholder="Назва джерела" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </div>
          {f.kind !== "manual" && (
            <div className="flex gap-2">
              <input className="input flex-1" type="url" placeholder="Адреса стрічки (з офіційного сайту університету)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required />
              <input className="input w-28" type="number" min={5} value={f.refresh_minutes} onChange={(e) => setF({ ...f, refresh_minutes: e.target.value })} aria-label="Оновлення, хв" title="Інтервал оновлення, хв" />
            </div>
          )}
          {f.kind === "json_api" && (
            <textarea className="textarea font-mono text-xs" rows={3} value={f.config} onChange={(e) => setF({ ...f, config: e.target.value })}
              placeholder='{"items_path": "data", "id": "id", "title": "title", "summary": "excerpt", "url": "link", "published_at": "date"}' />
          )}
          <button className="btn-primary"><Plus size={16} /> Додати джерело</button>
        </form>
      </section>
      <section>
        <h2 className="font-display text-base mb-2">Оголошення адміністрації</h2>
        <form onSubmit={announce} className="space-y-2">
          <input className="input" placeholder="Заголовок" value={ann.title} onChange={(e) => setAnn({ ...ann, title: e.target.value })} required minLength={3} />
          <textarea className="textarea" placeholder="Короткий опис" value={ann.summary} onChange={(e) => setAnn({ ...ann, summary: e.target.value })} />
          <input className="input" type="url" placeholder="Посилання на оригінал (необов'язково)" value={ann.url} onChange={(e) => setAnn({ ...ann, url: e.target.value })} />
          <button className="btn-primary">Опублікувати</button>
        </form>
      </section>
    </div>
  );
}

export default function AdminPage() {
  const { isAdmin, isStaff } = useSession();
  const [params] = useSearchParams();
  if (!isStaff) return <Empty title="Немає доступу">Цей розділ доступний модераторам та адміністраторам університету.</Empty>;
  const tab = params.get("tab") || "overview";
  const tabs = [{ value: "overview", label: "Огляд" }, { value: "reports", label: "Скарги" },
    ...(isAdmin ? [{ value: "members", label: "Учасники" }, { value: "catalog", label: "Каталог" }, { value: "news", label: "Новини" }] : [])];
  return (
    <>
      <PageHeader title="Керування університетом"><UrlTabs param="tab" defaultValue="overview" tabs={tabs} /></PageHeader>
      {tab === "overview" && <Overview />}
      {tab === "reports" && <Reports />}
      {isAdmin && tab === "members" && <Members />}
      {isAdmin && tab === "catalog" && <Catalog />}
      {isAdmin && tab === "news" && <News />}
    </>
  );
}
