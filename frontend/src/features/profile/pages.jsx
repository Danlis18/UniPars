import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { applyTheme, currentTheme } from "../../lib/storage.js";
import { useSession } from "../../app/session.jsx";
import { Avatar, Empty, ErrorState, Loading, useToast } from "../../components/ui.jsx";
import { PageHeader, UrlTabs } from "../../components/PageHeader.jsx";
import PostList from "../feed/PostList.jsx";
import { StudyContextForm } from "../auth/Onboarding.jsx";

export function useNotifications() {
  const { isAuthed } = useSession();
  return useQuery({ queryKey: ["notifications"], queryFn: () => api("/notifications"), enabled: isAuthed, refetchInterval: 60_000 });
}

export function NotificationsPage() {
  const n = useNotifications();
  const qc = useQueryClient();
  const nav = useNavigate();
  const readAll = useMutation({
    mutationFn: () => api("/notifications/read", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  useEffect(() => {
    if (n.data?.unread) {
      const t = setTimeout(() => readAll.mutate(), 1500);
      return () => clearTimeout(t);
    }
  }, [n.data?.unread]); // eslint-disable-line
  return (
    <>
      <PageHeader title="Сповіщення" actions={n.data?.unread ? <button className="btn-ghost h-9" onClick={() => readAll.mutate()}><CheckCheck size={16} /> Прочитати всі</button> : null} />
      {n.isLoading ? <Loading /> : n.isError ? <ErrorState error={n.error} onRetry={n.refetch} /> : !n.data.items.length ? (
        <Empty title="Сповіщень немає" icon={Bell}>Тут з'являться відповіді на ваші дописи, прийняті відповіді та важливі оновлення.</Empty>
      ) : (
        <ul>
          {n.data.items.map((x) => (
            <li key={x.id}>
              <button onClick={() => x.link && nav(x.link)} className={`w-full text-left flex gap-3 px-4 py-3 border-b border-line hover:bg-sunken/50 ${x.is_read ? "" : "bg-lime/10"}`}>
                <Bell size={18} className="text-primary mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold break-words">{x.title}</span>
                  {x.body && <span className="block text-sm text-muted line-clamp-2 break-words">{x.body}</span>}
                  <span className="block text-xs text-muted mt-0.5">{timeAgo(x.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState(currentTheme());
  const choose = (v) => {
    setTheme(v);
    applyTheme(v);
    api("/me", { method: "PATCH", body: { theme: v } }).catch(() => {});
  };
  const opts = [["light", "Світла", Sun], ["dark", "Темна", Moon], ["system", "Як у системі", Monitor]];
  return (
    <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Тема">
      {opts.map(([v, label, Icon]) => (
        <button key={v} role="radio" aria-checked={theme === v} className="pill h-9 px-4 flex items-center gap-1.5" aria-pressed={theme === v} onClick={() => choose(v)}>
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  );
}

export function ProfilePage() {
  const { me, membership, activeUniversityId, refreshMe, signOut } = useSession();
  const toast = useToast();
  const [name, setName] = useState(me.display_name || "");
  const [bio, setBio] = useState(me.bio || "");
  const save = useMutation({
    mutationFn: () => api("/me", { method: "PATCH", body: { display_name: name.trim(), bio } }),
    onSuccess: () => { refreshMe(); toast("Профіль оновлено"); },
    onError: (e) => toast(e.message, "error"),
  });
  const [params] = useSearchParams();
  const tab = params.get("tab") || "posts";
  const roleLabel = { student: "Студент", moderator: "Модератор", admin: "Адміністратор" }[membership?.role] || "";

  return (
    <>
      <PageHeader title={me.display_name} subtitle={`${membership?.university?.short_name || ""} · ${roleLabel}`}>
        <UrlTabs param="tab" defaultValue="posts" tabs={[{ value: "posts", label: "Мої дописи" }, { value: "settings", label: "Налаштування" }]} />
      </PageHeader>
      {tab === "posts" ? (
        <>
          <div className="flex items-center gap-4 p-4 border-b border-line">
            <Avatar user={me} size={64} />
            <div className="min-w-0">
              <div className="font-display text-lg truncate">{me.display_name}</div>
              <div className="text-sm text-muted break-words">{me.bio}</div>
            </div>
          </div>
          <PostList query={{ author: "me", tab: "university" }} empty={<Empty title="Ви ще нічого не публікували">Поділіться конспектом або поставте запитання.</Empty>} />
        </>
      ) : (
        <div className="p-4 space-y-6">
          <section className="space-y-3">
            <h2 className="font-display text-base">Профіль</h2>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div><label className="label" htmlFor="p-name">Ім'я</label><input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></div>
              <div><label className="label" htmlFor="p-bio">Про себе</label><textarea id="p-bio" className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} /></div>
              <button className="btn-primary" disabled={save.isPending}>Зберегти</button>
            </form>
          </section>
          <section className="space-y-3">
            <h2 className="font-display text-base">Тема оформлення</h2>
            <ThemePicker />
          </section>
          <section className="space-y-3">
            <h2 className="font-display text-base">Навчальний контекст</h2>
            <p className="text-sm text-muted">Факультет, спеціальність, курс і група в університеті «{membership?.university?.name}».</p>
            <StudyContextForm universityId={activeUniversityId} initial={membership} submitLabel="Оновити" onDone={() => { refreshMe(); toast("Навчальний контекст оновлено"); }} />
          </section>
          <section className="space-y-3">
            <h2 className="font-display text-base">Університети</h2>
            <ul className="text-sm space-y-1">{me.memberships.map((m) => <li key={m.university_id}>• {m.university.name}</li>)}</ul>
            <Link to="/onboarding?join=1" className="btn-ghost">Приєднатися до іншого університету</Link>
          </section>
          <section className="space-y-2">
            <h2 className="font-display text-base">Мова інтерфейсу</h2>
            <p className="text-sm text-muted">Українська. Структура перекладів готова для інших мов.</p>
          </section>
          <button className="btn-ghost text-danger" onClick={signOut}><LogOut size={16} /> Вийти</button>
        </div>
      )}
    </>
  );
}
