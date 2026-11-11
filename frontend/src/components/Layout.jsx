import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, BookMarked, BookOpen, ChevronDown, Home, LayoutGrid, LogOut, Menu, MessageCircleQuestion, PanelRight, Plus, Search, Settings, Shield, Sparkles, User, X } from "lucide-react";
import { api } from "../lib/api.js";
import { t } from "../lib/i18n.js";
import { useSession } from "../app/session.jsx";
import { Logo } from "./Logo.jsx";
import { Avatar, DemoBadge } from "./ui.jsx";
import AgentMascot from "./agent/AgentMascot.jsx";
import NewsWidget from "../features/news/NewsWidget.jsx";
import Composer, { useComposer } from "../features/feed/Composer.jsx";
import { useNotifications } from "../features/profile/pages.jsx";

function UniversitySwitcher({ compact }) {
  const { me, activeUniversityId, switchUniversity } = useSession();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const current = me.memberships.find((m) => m.university_id === activeUniversityId)?.university;
  if (compact) return null;
  return (
    <div className="relative px-1">
      <button className="w-full flex items-center gap-2 rounded-xl border border-line px-3 h-10 text-sm hover:bg-sunken" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
        <span className="truncate flex-1 text-left font-medium">{current?.short_name || "Оберіть університет"}</span>
        <ChevronDown size={16} className="text-muted shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <ul className="absolute z-40 left-1 right-1 mt-1 card shadow-xl py-1" role="listbox">
            {me.memberships.map((m) => (
              <li key={m.university_id}>
                <button role="option" aria-selected={m.university_id === activeUniversityId} className="w-full text-left px-3 py-2 text-sm hover:bg-sunken flex items-center gap-2"
                  onClick={async () => { setOpen(false); await switchUniversity(m.university_id); nav("/"); }}>
                  <span className="flex-1 truncate">{m.university.name}</span>{m.university.is_demo && <DemoBadge />}
                </button>
              </li>
            ))}
            <li><button className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-sunken" onClick={() => { setOpen(false); nav("/onboarding?join=1"); }}>+ Приєднатися до університету</button></li>
          </ul>
        </>
      )}
    </div>
  );
}

function ProfileMenu({ compact }) {
  const { me, signOut, membership } = useSession();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div className="relative">
      <button className="w-full flex items-center gap-2.5 rounded-full p-2 hover:bg-sunken" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Меню профілю">
        <Avatar user={me} size={38} />
        {!compact && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-semibold truncate">{me.display_name}</span>
            <span className="block text-xs text-muted truncate">{{ student: "Студент", moderator: "Модератор", admin: "Адміністратор" }[membership?.role]}</span>
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 bottom-full mb-2 left-0 w-56 card shadow-xl py-1 text-sm" role="menu">
            <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken" onClick={() => { setOpen(false); nav("/profile"); }}><User size={16} /> {t("nav.profile")}</button>
            <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken" onClick={() => { setOpen(false); nav("/profile?tab=settings"); }}><Settings size={16} /> {t("nav.settings")}</button>
            <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sunken text-danger" onClick={signOut}><LogOut size={16} /> {t("nav.logout")}</button>
          </div>
        </>
      )}
    </div>
  );
}

function useNavItems() {
  const { isStaff } = useSession();
  const notes = useNotifications();
  return [
    { to: "/", label: t("nav.home"), icon: Home, end: true },
    { to: "/subjects", label: t("nav.subjects"), icon: LayoutGrid },
    { to: "/materials", label: t("nav.materials"), icon: BookOpen },
    { to: "/questions", label: t("nav.questions"), icon: MessageCircleQuestion },
    { to: "/ai", label: t("nav.ai"), icon: Sparkles },
    { to: "/saved", label: t("nav.saved"), icon: BookMarked },
    { to: "/notifications", label: t("nav.notifications"), icon: Bell, badge: notes.data?.unread },
    ...(isStaff ? [{ to: "/admin", label: t("nav.admin"), icon: Shield }] : []),
  ];
}

function LeftNav({ compact }) {
  const items = useNavItems();
  const { open } = useComposer();
  return (
    <nav className={`sticky top-0 h-dvh flex flex-col gap-2 py-3 ${compact ? "items-center px-2" : "px-3"}`} aria-label="Основна навігація">
      <Link to="/" className="px-2 py-1.5 rounded-xl" aria-label="UniPars — на головну"><Logo compact={compact} /></Link>
      <UniversitySwitcher compact={compact} />
      <ul className="flex flex-col gap-0.5 mt-1">
        {items.map(({ to, label, icon: Icon, end, badge }) => (
          <li key={to}>
            <NavLink to={to} end={end} title={compact ? label : undefined}
              className={({ isActive }) => `relative flex items-center gap-4 rounded-full ${compact ? "p-3" : "px-3 py-2.5"} text-[17px] transition-colors hover:bg-sunken ${isActive ? "font-semibold text-primary" : ""}`}>
              {({ isActive }) => (
                <>
                  <Icon size={24} strokeWidth={isActive ? 2.4 : 1.8} />
                  {!compact && <span>{label}</span>}
                  {badge > 0 && <span className="absolute left-6 top-1 min-w-[18px] h-[18px] rounded-full bg-lime text-on-lime text-[11px] font-bold grid place-items-center px-1">{badge}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <button className={`btn-primary h-12 mt-2 text-base ${compact ? "w-12 p-0" : "w-full"}`} onClick={() => open("material")} aria-label={t("nav.create")}>
        {compact ? <Plus size={22} /> : t("nav.create")}
      </button>
      <div className="mt-auto flex flex-col gap-1">
        <div className={compact ? "" : "-ml-2"}><AgentMascot compact={compact} /></div>
        <ProfileMenu compact={compact} />
      </div>
    </nav>
  );
}

function UnansweredWidget() {
  const { activeUniversityId } = useSession();
  const q = useQuery({
    queryKey: ["posts", activeUniversityId, { widget: "unanswered" }],
    queryFn: () => api("/posts", { query: { status: "unanswered", limit: 4 } }),
    enabled: Boolean(activeUniversityId),
  });
  if (!q.data?.items?.length) return null;
  return (
    <section className="card overflow-hidden" aria-labelledby="unans-h">
      <h2 id="unans-h" className="font-display text-base px-4 pt-3 pb-1">Чекають на відповідь</h2>
      <ul>
        {q.data.items.map((p) => (
          <li key={p.id}><Link to={`/p/${p.id}`} className="block px-4 py-2 hover:bg-sunken/60">
            <div className="text-xs text-muted truncate">{p.subject.name}</div>
            <div className="text-sm font-semibold leading-snug line-clamp-2 break-words">{p.title}</div>
          </Link></li>
        ))}
      </ul>
      <Link to="/questions?status=unanswered" className="block px-4 py-2.5 text-sm text-primary hover:bg-sunken/60">Усі без відповіді</Link>
    </section>
  );
}

function PopularSubjects() {
  const { activeUniversityId } = useSession();
  const q = useQuery({ queryKey: ["subjects", activeUniversityId, ""], queryFn: () => api("/subjects"), enabled: Boolean(activeUniversityId) });
  const top = [...(q.data || [])].sort((a, b) => b.post_count - a.post_count).slice(0, 5);
  if (!top.length) return null;
  return (
    <section className="card overflow-hidden" aria-labelledby="pop-h">
      <h2 id="pop-h" className="font-display text-base px-4 pt-3 pb-1">Популярні предмети</h2>
      <ul>{top.map((s) => (
        <li key={s.id}><Link to={`/subjects/${s.slug}`} className="flex items-center justify-between px-4 py-2 hover:bg-sunken/60 gap-2">
          <span className="text-sm font-medium truncate">{s.name}</span><span className="text-xs text-muted shrink-0">{s.post_count}</span>
        </Link></li>
      ))}</ul>
    </section>
  );
}

function RightRail() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  return (
    <div className="flex flex-col gap-4 py-3">
      <form role="search" onSubmit={(e) => { e.preventDefault(); nav(`/materials?q=${encodeURIComponent(q.trim())}`); }} className="sticky top-0 z-10 bg-bg pb-1 -mt-1 pt-1">
        <label className="relative block">
          <span className="sr-only">Пошук в університеті</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input rounded-full pl-10 h-11 bg-sunken border-transparent" placeholder="Пошук в університеті" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </form>
      <NewsWidget />
      <UnansweredWidget />
      <PopularSubjects />
      <footer className="text-xs text-muted px-2">UniPars · платформа взаємодопомоги студентів</footer>
    </div>
  );
}

function MobileBar() {
  const { open } = useComposer();
  const items = [
    { to: "/", icon: Home, label: t("nav.home"), end: true },
    { to: "/subjects", icon: LayoutGrid, label: t("nav.subjects") },
    { action: () => open("material"), icon: Plus, label: "Створити" },
    { to: "/ai", icon: Sparkles, label: t("nav.ai") },
    { to: "/profile", icon: User, label: t("nav.profile") },
  ];
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line flex justify-around pb-[env(safe-area-inset-bottom)]" aria-label="Нижня навігація">
      {items.map(({ to, icon: Icon, label, end, action }) => action ? (
        <button key={label} onClick={action} className="flex flex-col items-center gap-0.5 py-2 px-3 text-[11px]" aria-label={label}>
          <span className="w-9 h-7 rounded-full bg-primary text-on-primary grid place-items-center"><Icon size={18} /></span>{label}
        </button>
      ) : (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 px-3 text-[11px] ${isActive ? "text-primary font-semibold" : "text-muted"}`}>
          <Icon size={22} />{label}
        </NavLink>
      ))}
    </nav>
  );
}

function MobileMenu({ onClose }) {
  const items = useNavItems();
  return (
    <div className="fixed inset-0 z-50 bg-bg overflow-y-auto" role="dialog" aria-label="Меню">
      <div className="flex items-center justify-between px-4 h-14 border-b border-line">
        <Logo />
        <button className="icon-btn" onClick={onClose} aria-label="Закрити меню"><X size={20} /></button>
      </div>
      <div className="p-3"><UniversitySwitcher /></div>
      <ul className="px-3">
        {items.map(({ to, label, icon: Icon, badge }) => (
          <li key={to}><NavLink to={to} onClick={onClose} className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-sunken text-base">
            <Icon size={22} /> {label} {badge > 0 && <span className="chip bg-lime text-on-lime">{badge}</span>}
          </NavLink></li>
        ))}
      </ul>
      <div className="p-3"><NewsWidget limit={4} /></div>
    </div>
  );
}

export default function Layout() {
  const [menu, setMenu] = useState(false);
  const [rail, setRail] = useState(false);
  const { pathname } = useLocation();
  const full = pathname.startsWith("/ai");
  return (
    <div className="mx-auto max-w-app md:grid md:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(600px,1fr)_320px] min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn-primary">До вмісту</a>
      <div className="hidden md:block xl:hidden border-r border-line"><LeftNav compact /></div>
      <div className="hidden xl:block"><LeftNav /></div>

      {/* Мобільна шапка */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 h-14 bg-bg/90 backdrop-blur border-b border-line">
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Відкрити меню"><Menu size={20} /></button>
        <Logo />
        <Link to="/notifications" className="icon-btn" aria-label="Сповіщення"><Bell size={20} /></Link>
      </div>

      <main id="main" className="min-w-0 border-line md:border-r xl:border-l pb-20 md:pb-0 relative">
        {/* Планшет: допоміжні блоки — в окремій панелі */}
        {!full && <button className="hidden md:inline-flex xl:hidden fixed top-3 right-3 z-30 icon-btn bg-surface border border-line" onClick={() => setRail(true)} aria-label="Новини та підказки"><PanelRight size={18} /></button>}
        <Outlet />
      </main>

      <aside className="hidden xl:block pl-6 pr-2 sticky top-0 h-dvh overflow-y-auto scrollbar-none" aria-label="Допоміжна панель"><RightRail /></aside>

      {rail && (
        <div className="fixed inset-0 z-40 xl:hidden" role="dialog" aria-label="Допоміжна панель">
          <div className="absolute inset-0 bg-black/30" onClick={() => setRail(false)} />
          <div className="absolute right-0 top-0 h-full w-[340px] max-w-[90vw] bg-bg border-l border-line overflow-y-auto px-4">
            <div className="flex justify-end pt-3"><button className="icon-btn" onClick={() => setRail(false)} aria-label="Закрити"><X size={18} /></button></div>
            <RightRail />
          </div>
        </div>
      )}
      {menu && <MobileMenu onClose={() => setMenu(false)} />}
      <MobileBar />
      <div className="md:hidden fixed left-2 bottom-[68px] z-20"><AgentMascot compact /></div>
      <Composer />
    </div>
  );
}
