import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, LayoutGrid, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { useSession } from "../../app/session.jsx";
import { useMedia } from "../../lib/useMedia.js";
import { Avatar, Empty, ErrorState, Skeleton } from "../../components/ui.jsx";
import { PageHeader, UrlPills } from "../../components/PageHeader.jsx";
import NewsWidget from "../news/NewsWidget.jsx";
import PostList from "./PostList.jsx";
import { FileRow, KINDS, deadlineInfo, taskFullTitle } from "../tasks/shared.jsx";

function Block({ id, title, icon: Icon, action, children }) {
  return (
    <section aria-labelledby={id} className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 id={id} className="font-display text-base flex items-center gap-2"><Icon size={18} className="text-primary" aria-hidden /> {title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Deadlines({ items }) {
  if (!items.length) {
    return <p className="px-4 pb-4 text-sm text-muted">Найближчих дедлайнів немає. Підпишіться на предмети — їхні дедлайни з'являться тут.</p>;
  }
  return (
    <ul className="pb-2">
      {items.map((t) => {
        const d = deadlineInfo(t.deadline_at);
        return (
          <li key={t.id}>
            <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/60">
              <span className={`w-12 shrink-0 rounded-xl text-center py-1.5 leading-tight ${d.urgent ? "bg-danger/15 text-danger" : "bg-sunken"}`}>
                <span className="block font-display text-lg">{new Date(t.deadline_at).getDate()}</span>
                <span className="block text-[10px] uppercase">{new Date(t.deadline_at).toLocaleDateString("uk-UA", { month: "short" }).replace(".", "")}</span>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-muted truncate">{t.subject.name}</span>
                <span className="block text-sm font-semibold leading-snug break-words">{taskFullTitle(t)}</span>
                <span className={`block text-xs ${d.urgent ? "text-danger" : "text-muted"}`}>{d.full} · {d.when}</span>
              </span>
              <ChevronRight size={16} className="text-muted shrink-0" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Materials({ items }) {
  if (!items.length) {
    return <p className="px-4 pb-4 text-sm text-muted">Опубліковані приклади з'являться тут після перевірки модераторами.</p>;
  }
  return (
    <ul className="px-4 pb-4 space-y-2">
      {items.map((m) => (
        <li key={m.id}>
          <Link to={`/tasks/${m.task.id}`} className="block text-xs text-muted hover:text-primary mb-1 break-words">
            {m.subject?.name} · {KINDS[m.task.kind]?.short}-{m.task.number} · {m.task.title}
          </Link>
          <FileRow file={m} linkPath={`/submissions/${m.id}/link`}>
            <span className="flex items-center gap-1.5 mt-1 text-xs text-muted min-w-0">
              <Avatar user={m.author} size={16} /><span className="truncate">{m.author.display_name}</span>
              <span aria-hidden>·</span><span className="shrink-0">{timeAgo(m.published_at)}</span>
            </span>
          </FileRow>
        </li>
      ))}
    </ul>
  );
}

export function HomePage() {
  const { me, activeUniversityId } = useSession();
  const isXl = useMedia("(min-width: 1280px)");
  const home = useQuery({ queryKey: ["home", activeUniversityId], queryFn: () => api("/home"), enabled: Boolean(activeUniversityId) });
  const first = me?.display_name?.split(" ")[0];
  return (
    <>
      <PageHeader title={first ? `Привіт, ${first}!` : "Головна"} subtitle="Дедлайни й нові приклади з ваших предметів"
        actions={<Link to="/subjects" className="btn-ghost h-9"><LayoutGrid size={16} /> <span className="hidden sm:inline">Предмети</span></Link>} />
      <div className="p-4 space-y-4">
        {home.isError ? <ErrorState error={home.error} onRetry={home.refetch} /> : (
          <>
            <Block id="dl-h" title="Найближчі дедлайни" icon={CalendarClock}>
              {home.isLoading ? <div className="px-4 pb-4"><Skeleton rows={2} /></div> : <Deadlines items={home.data.deadlines} />}
            </Block>
            {/* Права колонка не вміщується — новини між дедлайнами й добіркою */}
            {!isXl && <NewsWidget limit={4} headingId="news-home-h" />}
            <Block id="mat-h" title={home.data?.materials_mode === "popular" ? "Популярні матеріали" : "Нещодавно опубліковані"} icon={Sparkles}>
              {home.isLoading ? <div className="px-4 pb-4"><Skeleton rows={3} /></div> : <Materials items={home.data.materials} />}
            </Block>
          </>
        )}
      </div>
    </>
  );
}

export function SavedPage() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Збережене" subtitle="Ваші особисті закладки">
        <UrlPills param="type" options={[{ value: "question", label: "Питання" }]} />
      </PageHeader>
      <PostList query={{ saved: true, type: params.get("type") || undefined }}
        empty={<Empty title="Тут поки порожньо">Натисніть «Зберегти» на корисному питанні, щоб знайти його пізніше.</Empty>} />
    </>
  );
}
