import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { useSession } from "../../app/session.jsx";
import { DemoBadge, Spinner } from "../../components/ui.jsx";

export default function NewsWidget({ limit = 5 }) {
  const { activeUniversityId } = useSession();
  // Новини змінюються разом з університетом (ключ кешу містить id)
  const news = useQuery({
    queryKey: ["news", activeUniversityId, limit],
    queryFn: () => api("/news", { query: { limit } }),
    enabled: Boolean(activeUniversityId),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  return (
    <section className="card overflow-hidden" aria-labelledby="news-h">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 id="news-h" className="font-display text-base">Новини університету</h2>
        <button className="icon-btn w-8 h-8" onClick={() => news.refetch()} aria-label="Оновити новини" disabled={news.isFetching}>
          {news.isFetching ? <Spinner className="!w-4 !h-4" /> : <RefreshCw size={15} />}
        </button>
      </div>
      {news.isLoading ? <div className="px-4 py-3 text-sm text-muted">Завантаження…</div> : news.isError ? (
        <div className="px-4 py-3 text-sm text-muted">Не вдалося отримати новини. <button className="text-primary underline" onClick={() => news.refetch()}>Повторити</button></div>
      ) : !news.data.has_sources ? (
        <div className="px-4 py-3 text-sm text-muted">Джерело новин ще не налаштоване адміністратором.</div>
      ) : (
        <>
          {news.data.degraded && <div className="mx-4 my-1 text-xs rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-1">Джерело тимчасово недоступне — показано останні отримані новини</div>}
          <ul>
            {news.data.items.map((n) => {
              const Tag = n.url ? "a" : "div";
              return (
                <li key={n.id}>
                  <Tag {...(n.url ? { href: n.url, target: "_blank", rel: "noopener noreferrer" } : {})} className="block px-4 py-2.5 hover:bg-sunken/60">
                    <div className="text-xs text-muted flex items-center gap-1.5 mb-0.5">
                      <span className="truncate">{n.source}</span> · <time dateTime={n.published_at}>{timeAgo(n.published_at)}</time>
                      {n.is_demo && <DemoBadge className="!text-[10px] !px-1.5" />}
                    </div>
                    <div className="text-sm font-semibold leading-snug break-words">{n.title.replace(/^\[ДЕМО\]\s*/, "")}{n.url && <ExternalLink size={12} className="inline ml-1 text-muted" />}</div>
                    {n.summary && <div className="text-xs text-muted line-clamp-2 mt-0.5">{n.summary}</div>}
                  </Tag>
                </li>
              );
            })}
          </ul>
          {news.data.last_synced_at && <div className="px-4 py-2 text-[11px] text-muted border-t border-line">Оновлено {timeAgo(news.data.last_synced_at)} тому</div>}
        </>
      )}
    </section>
  );
}
