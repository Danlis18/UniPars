import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useSession } from "../../app/session.jsx";
import { Empty, ErrorState, Skeleton } from "../../components/ui.jsx";
import PostCard from "../posts/PostCard.jsx";

// Стрічка з пагінацією. Кеш TanStack Query + ScrollRestoration зберігають
// позицію і завантажені сторінки після повернення з допису.
export default function PostList({ query, empty }) {
  const { activeUniversityId } = useSession();
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const q = useInfiniteQuery({
    queryKey: ["posts", activeUniversityId, clean],
    queryFn: ({ pageParam }) => api("/posts", { query: { ...clean, offset: pageParam, limit: 15 } }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: Boolean(activeUniversityId),
  });

  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  if (!items.length) return empty || <Empty title="Нічого не знайдено">Спробуйте змінити фільтри або створіть перший допис.</Empty>;
  return (
    <div>
      {items.map((p) => <PostCard key={p.id} post={p} />)}
      <div className="p-4 text-center">
        {q.hasNextPage ? (
          <button className="btn-ghost" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? "Завантаження…" : "Показати ще"}
          </button>
        ) : (
          <span className="text-xs text-muted">Це все на зараз</span>
        )}
      </div>
    </div>
  );
}
