import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { api, setActiveUniversity } from "../../lib/api.js";
import { useSession } from "../../app/session.jsx";
import { Logo } from "../../components/Logo.jsx";
import { DemoBadge, Loading } from "../../components/ui.jsx";

// Факультет → спеціальність → курс → група (необов'язково). Перевірки — на backend.
export function StudyContextForm({ universityId, initial, submitLabel = "Далі", onDone }) {
  const [f, setF] = useState({
    faculty_id: initial?.faculty_id || "", program_id: initial?.program_id || "",
    course: initial?.course || "", group_id: initial?.group_id || "",
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = useQuery({ queryKey: ["structure", universityId], queryFn: () => api(`/universities/${universityId}/structure`), enabled: Boolean(universityId) });
  if (s.isLoading) return <Loading />;
  const programs = s.data?.programs.filter((p) => p.faculty_id === f.faculty_id) || [];
  const groups = s.data?.groups.filter((g) => g.program_id === f.program_id && (!f.course || !g.course || g.course === Number(f.course))) || [];
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === "faculty_id" ? { program_id: "", group_id: "" } : k === "program_id" ? { group_id: "" } : {}) }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/universities/${universityId}/join`, { method: "POST", body: {
        faculty_id: f.faculty_id || null, program_id: f.program_id || null, course: f.course ? Number(f.course) : null, group_id: f.group_id || null } });
      await onDone?.();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label" htmlFor="o-fac">Факультет *</label>
        <select id="o-fac" className="input" value={f.faculty_id} onChange={set("faculty_id")}>
          <option value="">Не обрано</option>
          {s.data?.faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <div className="grid sm:grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="label" htmlFor="o-prog">Спеціальність / освітня програма *</label>
          <select id="o-prog" className="input" value={f.program_id} onChange={set("program_id")} disabled={!f.faculty_id}>
            <option value="">Не обрано</option>
            {programs.map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} ` : ""}{x.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="o-course">Курс *</label>
          <select id="o-course" className="input" value={f.course} onChange={set("course")}>
            <option value="">—</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="o-group">Група (необов'язково)</label>
        <select id="o-group" className="input" value={f.group_id} onChange={set("group_id")} disabled={!groups.length}>
          <option value="">{groups.length ? "Не вказувати" : "Груп у каталозі немає"}</option>
          {groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      {error && <div className="text-sm text-danger" role="alert">{error}</div>}
      <p className="text-xs text-muted">Курс оновлюється автоматично щороку 1 вересня. Змінити його можна в Налаштуваннях.</p>
      <button className="btn-primary" disabled={busy || !f.faculty_id || !f.program_id || !f.course}>{busy ? "Збереження…" : submitLabel}</button>
    </form>
  );
}

// Предмети курсу сіткою, згруповані за семестрами навчального плану
function SubjectPicker({ onDone }) {
  const { activeUniversityId, membership } = useSession();
  const subjects = useQuery({ queryKey: ["subjects", activeUniversityId, "onb"], queryFn: () => api("/subjects", { query: { scope: "course" } }) });
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!subjects.data) return;
    const subscribed = subjects.data.filter((s) => s.subscribed).map((s) => s.id);
    // за замовчуванням — усі обов'язкові предмети курсу
    setPicked(new Set(subscribed.length ? subscribed : subjects.data.filter((s) => !s.is_elective).map((s) => s.id)));
  }, [subjects.data]);
  if (subjects.isLoading) return <Loading />;
  const list = subjects.data || [];
  const course = Number(membership?.course) || null;
  const own = course ? [2 * course - 1, 2 * course] : [];
  const semOf = (s) => {
    const sems = (s.semesters || []).filter((x) => !own.length || own.includes(x));
    if (sems.length === 1) return sems[0];
    return sems.length ? "both" : "other";
  };
  const groups = [
    ...own.map((n) => ({ key: n, title: `${n} семестр` })),
    { key: "both", title: "Обидва семестри" },
    { key: "other", title: own.length ? "Інші" : "Предмети" },
  ].map((g) => ({ ...g, items: list.filter((s) => semOf(s) === g.key).sort((x, y) => x.is_elective - y.is_elective || x.name.localeCompare(y.name, "uk")) }))
    .filter((g) => g.items.length);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const all = list.length > 0 && picked.size === list.length;
  const save = async () => {
    setBusy(true);
    try { await api("/me/subscriptions", { method: "PUT", body: { subject_ids: [...picked] } }); onDone(); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">Обрано <b className="text-ink tabular-nums">{picked.size}</b> з {list.length}</span>
        <button type="button" className="text-primary font-medium hover:underline" onClick={() => setPicked(new Set(all ? [] : list.map((s) => s.id)))}>
          {all ? "Зняти всі" : "Обрати всі"}
        </button>
      </div>
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`sg-${g.key}`}>
          <h2 id={`sg-${g.key}`} className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">{g.title}</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {g.items.map((s) => {
              const on = picked.has(s.id);
              return (
                <button key={s.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(s.id)}
                  className={`group text-left rounded-xl border px-3 py-2.5 flex items-start gap-2.5 min-h-14 transition-colors
                    ${on ? "border-primary/70 bg-primary/10" : "border-line hover:border-primary/40 hover:bg-sunken"}`}>
                  <span className={`mt-0.5 shrink-0 w-5 h-5 rounded-md border grid place-items-center transition-colors
                    ${on ? "bg-primary border-primary text-on-primary" : "border-line group-hover:border-primary/60"}`} aria-hidden>
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-snug">{s.name}</span>
                    {s.is_elective && <span className="mt-1 inline-block text-[11px] px-1.5 rounded-md bg-lime/15 text-lime">вибіркова</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!list.length && <p className="text-sm text-muted">Для вашого курсу предметів поки немає — їх можна додати пізніше в розділі «Предмети».</p>}
      <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={save}>{busy ? "Збереження…" : "Перейти до стрічки"}</button>
    </div>
  );
}

export default function Onboarding() {
  const { me, refreshMe, needsOnboarding } = useSession();
  const [params] = useSearchParams();
  const joining = params.get("join") === "1";
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [uni, setUni] = useState(joining ? "" : me?.active_university_id || "");
  const unis = useQuery({ queryKey: ["universities"], queryFn: () => api("/universities") });
  const memberOf = new Set(me?.memberships.map((m) => m.university_id));
  // Уже зареєстрований користувач може вийти з майстра будь-коли
  const canClose = joining || me?.memberships?.some((m) => m.onboarded);
  const close = () => (window.history.length > 1 ? nav(-1) : nav("/", { replace: true }));
  const nothingToJoin = step === 1 && joining && unis.data?.every((u) => memberOf.has(u.id));

  useEffect(() => { if (!needsOnboarding && !joining && step === 1) nav("/", { replace: true }); }, []); // eslint-disable-line

  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <div className={`card w-full p-6 transition-[max-width] duration-300 ${step === 3 ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <Logo />
          <div className="flex items-center gap-3">
            {!nothingToJoin && <span className="text-xs text-muted">Крок {step} з 3</span>}
            {canClose && (
              <button type="button" onClick={close} className="w-8 h-8 -mr-1 grid place-items-center rounded-full text-muted hover:text-ink hover:bg-sunken" aria-label="Закрити">
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        {step === 1 && (
          <>
            <h1 className="font-display text-xl mb-1">Оберіть університет</h1>
            <p className="text-sm text-muted mb-4">Ви бачитимете матеріали, новини та запитання саме свого університету.
              Зараз реєстрація відкрита для <b>факультету електроніки та комп'ютерних технологій ЛНУ ім. Івана Франка</b>.</p>
            {unis.isLoading ? <Loading /> : (
              <div className="space-y-2 mb-4" role="radiogroup">
                {unis.data?.filter((u) => !joining || !memberOf.has(u.id)).map((u) => (
                  <button key={u.id} role="radio" aria-checked={uni === u.id} onClick={() => setUni(u.id)}
                    className={`w-full text-left rounded-xl border p-3 flex items-center justify-between gap-2 ${uni === u.id ? "border-primary bg-primary/5" : "border-line hover:bg-sunken"}`}>
                    <span className="font-medium">{u.name}</span>{u.is_demo && <DemoBadge />}
                  </button>
                ))}
                {nothingToJoin && (
                  <p className="text-sm text-muted rounded-xl bg-sunken p-3">
                    Ви вже учасник усіх доступних університетів. Нові університети з'являться тут, щойно для них відкриють реєстрацію.
                  </p>
                )}
              </div>
            )}
            {nothingToJoin
              ? <button className="btn-primary" onClick={close}>Повернутися</button>
              : (
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={!uni} onClick={() => setStep(2)}>Далі</button>
                  {canClose && <button className="btn-ghost" onClick={close}>Скасувати</button>}
                </div>
              )}
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="font-display text-xl mb-1">Навчальний контекст</h1>
            <p className="text-sm text-muted mb-4">Допоможе показувати релевантні предмети. Усе можна змінити в профілі.</p>
            <StudyContextForm universityId={uni} initial={me?.memberships.find((m) => m.university_id === uni)} onDone={async () => {
              setActiveUniversity(uni);
              await refreshMe();
              await qc.invalidateQueries();
              setStep(3);
            }} />
          </>
        )}
        {step === 3 && (
          <>
            <h1 className="font-display text-xl mb-1">Підпишіться на предмети</h1>
            <p className="text-sm text-muted mb-4">Це предмети вашого курсу за навчальним планом. Їхні матеріали та запитання з'являтимуться у вкладці «Мої предмети».</p>
            <SubjectPicker onDone={() => nav("/", { replace: true })} />
          </>
        )}
      </div>
    </div>
  );
}
