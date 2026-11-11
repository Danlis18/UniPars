import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
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
        <label className="label" htmlFor="o-fac">Факультет або підрозділ</label>
        <select id="o-fac" className="input" value={f.faculty_id} onChange={set("faculty_id")}>
          <option value="">Не обрано</option>
          {s.data?.faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <div className="grid sm:grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="label" htmlFor="o-prog">Спеціальність</label>
          <select id="o-prog" className="input" value={f.program_id} onChange={set("program_id")} disabled={!f.faculty_id}>
            <option value="">Не обрано</option>
            {programs.map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} ` : ""}{x.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="o-course">Курс</label>
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
      <button className="btn-primary" disabled={busy}>{busy ? "Збереження…" : submitLabel}</button>
    </form>
  );
}

function SubjectPicker({ onDone }) {
  const { activeUniversityId } = useSession();
  const subjects = useQuery({ queryKey: ["subjects", activeUniversityId, "onb"], queryFn: () => api("/subjects") });
  const [picked, setPicked] = useState(new Set());
  useEffect(() => { if (subjects.data) setPicked(new Set(subjects.data.filter((s) => s.subscribed).map((s) => s.id))); }, [subjects.data]);
  if (subjects.isLoading) return <Loading />;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {subjects.data?.map((s) => (
          <button key={s.id} type="button" className="pill h-9 px-4 flex items-center gap-1.5" aria-pressed={picked.has(s.id)} onClick={() => toggle(s.id)}>
            {picked.has(s.id) && <Check size={14} />} {s.name}
          </button>
        ))}
      </div>
      <button className="btn-primary" onClick={async () => { await api("/me/subscriptions", { method: "PUT", body: { subject_ids: [...picked] } }); onDone(); }}>
        Перейти до стрічки
      </button>
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

  useEffect(() => { if (!needsOnboarding && !joining && step === 1) nav("/", { replace: true }); }, []); // eslint-disable-line

  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <div className="card w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <Logo />
          <span className="text-xs text-muted">Крок {step} з 3</span>
        </div>
        {step === 1 && (
          <>
            <h1 className="font-display text-xl mb-1">Оберіть університет</h1>
            <p className="text-sm text-muted mb-4">Ви бачитимете матеріали, новини та запитання саме свого університету.</p>
            {unis.isLoading ? <Loading /> : (
              <div className="space-y-2 mb-4" role="radiogroup">
                {unis.data?.filter((u) => !joining || !memberOf.has(u.id)).map((u) => (
                  <button key={u.id} role="radio" aria-checked={uni === u.id} onClick={() => setUni(u.id)}
                    className={`w-full text-left rounded-xl border p-3 flex items-center justify-between gap-2 ${uni === u.id ? "border-primary bg-primary/5" : "border-line hover:bg-sunken"}`}>
                    <span className="font-medium">{u.name}</span>{u.is_demo && <DemoBadge />}
                  </button>
                ))}
                {joining && unis.data?.every((u) => memberOf.has(u.id)) && <p className="text-sm text-muted">Ви вже учасник усіх доступних університетів.</p>}
              </div>
            )}
            <button className="btn-primary" disabled={!uni} onClick={() => setStep(2)}>Далі</button>
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
            <p className="text-sm text-muted mb-4">Їхні матеріали та запитання з'являтимуться у вкладці «Мої предмети».</p>
            <SubjectPicker onDone={() => nav("/", { replace: true })} />
          </>
        )}
      </div>
    </div>
  );
}
