import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, Check, Plus, Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { useSession } from "../../app/session.jsx";
import { Empty, ErrorState, Loading, useToast } from "../../components/ui.jsx";
import { PageHeader, UrlTabs } from "../../components/PageHeader.jsx";
import PostList from "../feed/PostList.jsx";
import { useComposer } from "../feed/Composer.jsx";

function SubscribeButton({ subject }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/subjects/${subject.id}/subscribe`, { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["subjects"] });
      qc.invalidateQueries({ queryKey: ["subject"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
      toast(r.subscribed ? `Ви підписались на «${subject.name}»` : "Підписку скасовано");
    },
  });
  return subject.subscribed ? (
    <button className="btn-ghost h-9" onClick={(e) => { e.preventDefault(); m.mutate(); }} disabled={m.isPending}><Check size={16} /> Підписка</button>
  ) : (
    <button className="btn-primary h-9" onClick={(e) => { e.preventDefault(); m.mutate(); }} disabled={m.isPending}><BellPlus size={16} /> Підписатися</button>
  );
}

export function SubjectsPage() {
  const { activeUniversityId } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const mine = params.get("view") === "mine";
  const list = useQuery({ queryKey: ["subjects", activeUniversityId, q, mine], queryFn: () => api("/subjects", { query: { q, mine: mine || undefined } }) });
  return (
    <>
      <PageHeader title="Предмети" subtitle="Каталог дисциплін університету">
        <div className="px-4 pb-2">
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9 rounded-full" placeholder="Пошук предмета" value={q}
              onChange={(e) => setParams((p) => { e.target.value ? p.set("q", e.target.value) : p.delete("q"); return p; }, { replace: true })} />
          </label>
        </div>
        <UrlTabs param="view" defaultValue="all" tabs={[{ value: "all", label: "Усі" }, { value: "mine", label: "Мої підписки" }]} />
      </PageHeader>
      {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data.length ? (
        <Empty title={mine ? "Ви ще не підписані на предмети" : "Предметів не знайдено"} />
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3 p-4">
          {list.data.map((s) => (
            <li key={s.id}>
              <Link to={`/subjects/${s.slug}`} className="card p-4 flex flex-col gap-2 h-full hover:border-primary transition-colors">
                <div className="font-semibold leading-snug break-words">{s.name}</div>
                <div className="text-sm text-muted line-clamp-2 flex-1">{s.description}</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">{s.post_count} дописів{s.courses.length ? ` · ${s.courses.join(", ")} курс` : ""}</span>
                  <SubscribeButton subject={s} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SubjectPage() {
  const { slug } = useParams();
  const { activeUniversityId } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "all";
  const topic = params.get("topic") || undefined;
  const { open } = useComposer();
  const s = useQuery({ queryKey: ["subject", activeUniversityId, slug], queryFn: () => api(`/subjects/${slug}`) });
  if (s.isLoading) return <Loading />;
  if (s.isError) return <ErrorState error={s.error} onRetry={s.refetch} />;
  const subj = s.data;
  const type = { all: undefined, materials: "material", questions: "question", explanations: "explanation" }[tab];
  return (
    <>
      <PageHeader back title={subj.name} subtitle={`${subj.followers} підписників`} actions={<SubscribeButton subject={subj} />}>
        <UrlTabs param="tab" defaultValue="all" tabs={[
          { value: "all", label: "Усі дописи" }, { value: "materials", label: "Матеріали" },
          { value: "questions", label: "Запитання" }, { value: "explanations", label: "Пояснення" },
        ]} />
      </PageHeader>
      <section className="px-4 py-3 border-b border-line">
        {subj.description && <p className="text-sm mb-3">{subj.description}</p>}
        <div className="flex gap-2 flex-wrap" aria-label="Теми">
          <button className="pill" aria-pressed={!topic} onClick={() => setParams((p) => { p.delete("topic"); return p; }, { replace: true })}>Усі теми</button>
          {subj.topics.map((tp) => (
            <button key={tp.id} className="pill" aria-pressed={topic === tp.id}
              onClick={() => setParams((p) => { p.set("topic", tp.id); return p; }, { replace: true })}>{tp.name}</button>
          ))}
        </div>
        <button className="btn-quiet h-8 px-3 mt-3 text-xs text-primary"
          onClick={() => open(tab === "questions" ? "question" : tab === "explanations" ? "explanation" : "material", { subject: subj.id })}>
          <Plus size={14} /> Додати в цей предмет
        </button>
      </section>
      <PostList query={{ subject_id: subj.id, topic_id: topic, type }} />
    </>
  );
}
