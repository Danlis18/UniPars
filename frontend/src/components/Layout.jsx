import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, BookMarked, ChevronDown, ClipboardList, Home, LayoutGrid, LogOut, Menu, MessageCircle, PanelRight, Search, Settings, Shield, Sparkles, User, X } from "lucide-react";
import { api } from "../lib/api.js";
import { t } from "../lib/i18n.js";
import { useSession } from "../app/session.jsx";
import { useMedia } from "../lib/useMedia.js";
import { Logo } from "./Logo.jsx";
import { Avatar, DemoBadge } from "./ui.jsx";
import AgentMascot from "./agent/AgentMascot.jsx";
import NewsWidget from "../features/news/NewsWidget.jsx";
import { useNotifications } from "../features/profile/pages.jsx";
import { useUnreadMessages } from "../features/messages/MessagesPage.jsx";
import { SoonChip } from "../features/ai/ComingSoon.jsx";
import { FollowButton } from "../features/profile/UserProfile.jsx";

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
      <button className={`flex items-center rounded-full hover:bg-sunken ${compact ? "w-[54px] h-[54px] justify-center mx-auto" : "w-full gap-2.5 p-2"}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Меню профілю">
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
          <div className={`absolute z-40 bottom-full mb-2 w-56 card shadow-xl p-1 text-sm left-0`} role="menu">
            <button role="menuitem" className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left cursor-pointer hover:bg-sunken" onClick={() => { setOpen(false); nav("/u/me"); }}><User size={16} /> {t("nav.profile")}</button>
            <button role="menuitem" className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left cursor-pointer hover:bg-sunken" onClick={() => { setOpen(false); nav("/settings"); }}><Settings size={16} /> {t("nav.settings")}</button>
            <button role="menuitem" className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left cursor-pointer hover:bg-sunken text-danger" onClick={signOut}><LogOut size={16} /> {t("nav.logout")}</button>
          </div>
        </>
      )}
    </div>
  );
}

function useNavItems() {
  const { isStaff, config, activeUniversityId } = useSession();
  const notes = useNotifications();
  const dms = useUnreadMessages();
  // Кількість робіт у черзі модерації — лише для модераторів і адміністраторів
  const queue = useQuery({
    queryKey: ["moderation", activeUniversityId, "pending"],
    queryFn: () => api("/moderation/submissions", { query: { status: "pending" } }),
    enabled: Boolean(isStaff && activeUniversityId),
    refetchInterval: 60_000,
  });
  return [
    { to: "/", label: t("nav.home"), icon: Home, end: true },
    { to: "/subjects", label: t("nav.subjects"), icon: LayoutGrid },
    { to: "/submissions", label: "Мої подання", icon: ClipboardList },
    { to: "/ai", label: t("nav.ai"), icon: Sparkles, soon: !config?.ai_enabled },
    { to: "/saved", label: t("nav.saved"), icon: BookMarked },
    { to: "/messages", label: "Повідомлення", icon: MessageCircle, badge: dms.data?.unread },
    { to: "/notifications", label: t("nav.notifications"), icon: Bell, badge: notes.data?.unread },
    { to: "/u/me", label: t("nav.profile"), icon: User },
    ...(isStaff ? [{ to: "/admin", label: t("nav.admin"), icon: Shield, badge: queue.data?.length }] : []),
  ];
}

function LeftNav({ compact }) {
  const items = useNavItems();
  return (
    <nav className={`sticky top-0 z-30 h-dvh flex flex-col gap-2 py-3 ${compact ? "items-center px-2" : "px-3"}`} aria-label="Основна навігація">
      <Link to="/" className="px-2 py-1.5 rounded-xl" aria-label="UniPars — на головну"><Logo compact={compact} /></Link>
      <UniversitySwitcher compact={compact} />
      <ul className="flex flex-col gap-0.5 mt-1">
        {items.map(({ to, label, icon: Icon, end, badge, soon }) => (
          <li key={to}>
            <NavLink to={to} end={end} title={compact ? label : undefined} aria-label={badge > 0 ? `${label}, нових: ${badge}` : label}
              className={({ isActive }) => `relative flex items-center gap-4 rounded-full ${compact ? "p-3" : "px-3 py-2.5"} text-[17px] transition-all hover:bg-sunken active:scale-[0.97] ${isActive ? "font-semibold text-primary bg-gradient-to-r from-teal/15 via-lime/10 to-transparent" : ""}`}>
              {({ isActive }) => (
                <>
                  <Icon size={24} strokeWidth={isActive ? 2.4 : 1.8} />
                  {!compact && <span>{label}</span>}
                  {!compact && soon && <SoonChip className="ml-auto" />}
                  {badge > 0 && <span aria-hidden="true" className="absolute left-6 top-1 min-w-[18px] h-[18px] rounded-full bg-lime text-on-lime text-[11px] font-bold grid place-items-center px-1">{badge}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-1">
        <div className={compact ? "" : "-ml-2"}><AgentMascot compact={compact} /></div>
        <ProfileMenu compact={compact} />
      </div>
    </nav>
  );
}

function WhoToFollow() {
  const { activeUniversityId } = useSession();
  const q = useQuery({ queryKey: ["people", activeUniversityId, "suggest"], queryFn: () => api("/users", { query: { suggest: true, limit: 4 } }), enabled: Boolean(activeUniversityId) });
  if (!q.data?.length) return null;
  return (
    <section className="card overflow-hidden" aria-labelledby="wtf-h">
      <h2 id="wtf-h" className="font-display text-base px-4 pt-3 pb-1">Кого читати</h2>
      <ul>{q.data.map((u) => (
        <li key={u.id} className="flex items-center gap-3 px-4 py-2 hover:bg-sunken/60">
          <Link to={`/u/${u.id}`} className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar user={u} size={38} ring />
            <span className="min-w-0"><span className="block text-sm font-semibold truncate">{u.display_name}</span>
              <span className="block text-xs text-muted truncate">{u.bio || "Студент"}</span></span>
          </Link>
          <FollowButton user={u} size="sm" />
        </li>
      ))}</ul>
    </section>
  );
}

function PopularSubjects() {
  const { activeUniversityId } = useSession();
  const q = useQuery({ queryKey: ["subjects", activeUniversityId, ""], queryFn: () => api("/subjects"), enabled: Boolean(activeUniversityId) });
  const top = [...(q.data || [])].sort((a, b) => (b.example_count + b.question_count) - (a.example_count + a.question_count)).slice(0, 5);
  if (!top.length) return null;
  return (
    <section className="card overflow-hidden" aria-labelledby="pop-h">
      <h2 id="pop-h" className="font-display text-base px-4 pt-3 pb-1">Популярні предмети</h2>
      <ul>{top.map((s) => (
        <li key={s.id}><Link to={`/subjects/${s.slug}`} className="flex items-center justify-between px-4 py-2 hover:bg-sunken/60 gap-2">
          <span className="text-sm font-medium truncate">{s.name}</span><span className="text-xs text-muted shrink-0">{s.example_count} прикл.</span>
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
      <form role="search" onSubmit={(e) => { e.preventDefault(); nav(`/subjects?view=all&q=${encodeURIComponent(q.trim())}`); }} className="sticky top-0 z-10 bg-bg pb-1 -mt-1 pt-1">
        <label className="relative block">
          <span className="sr-only">Пошук предмета</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input rounded-full pl-10 h-11 bg-sunken border-transparent" placeholder="Пошук предмета" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </form>
      <NewsWidget />
      <WhoToFollow />
      <PopularSubjects />
      <footer className="text-xs text-muted px-2">UniPars · платформа взаємодопомоги студентів</footer>
    </div>
  );
}

function MobileBar() {
  const items = [
    { to: "/", icon: Home, label: t("nav.home"), end: true },
    { to: "/subjects", icon: LayoutGrid, label: t("nav.subjects") },
    { to: "/submissions", icon: ClipboardList, label: "Подання" },
    { to: "/ai", icon: Sparkles, label: t("nav.ai") },
    { to: "/u/me", icon: User, label: t("nav.profile") },
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
      <div className="p-3"><NewsWidget limit={4} headingId="news-menu-h" /></div>
    </div>
  );
}

export default function Layout() {
  // Одна копія навігації та 3D-агента замість трьох схованих через CSS (кожна мала б свій WebGL)
  const isMd = useMedia("(min-width: 768px)");
  const isXl = useMedia("(min-width: 1280px)");
  const [menu, setMenu] = useState(false);
  const [rail, setRail] = useState(false);
  const { pathname } = useLocation();
  const full = pathname.startsWith("/ai") || pathname.startsWith("/messages");
  return (
    <div className="mx-auto max-w-app md:grid md:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(600px,1fr)_320px] min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn-primary">До вмісту</a>
      {isMd && !isXl && <div className="border-r border-line"><LeftNav compact /></div>}
      {isXl && <div><LeftNav /></div>}

      {/* Мобільна шапка */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 h-14 bg-bg/90 backdrop-blur border-b border-line">
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Відкрити меню"><Menu size={20} /></button>
        <Logo />
        <Link to="/notifications" className="icon-btn" aria-label="Сповіщення"><Bell size={20} /></Link>
      </div>

      <main id="main" className="min-w-0 border-line md:border-r xl:border-l pb-20 md:pb-0 relative">
        {/* Планшет: допоміжні блоки — в окремій панелі */}
        {!full && <button className="hidden md:inline-flex xl:hidden fixed top-3 right-3 z-30 icon-btn bg-surface border border-line" onClick={() => setRail(true)} aria-label="Новини та підказки"><PanelRight size={18} /></button>}
        <div key={pathname} className="page-in"><Outlet /></div>
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
      {!isMd && <div className="fixed left-2 bottom-[68px] z-20"><AgentMascot compact /></div>}
    </div>
  );
}
