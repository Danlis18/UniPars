import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, HelpCircle, Lightbulb, Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { t } from "../../lib/i18n.js";
import { useSession } from "../../app/session.jsx";
import { Avatar, Empty } from "../../components/ui.jsx";
import { PageHeader, UrlPills, UrlTabs } from "../../components/PageHeader.jsx";
import PostList from "./PostList.jsx";
import { useComposer } from "./Composer.jsx";

const TYPE_FILTERS = [
  { value: "material", label: "Матеріали" },
  { value: "question", label: "Запитання" },
  { value: "explanation", label: "Пояснення" },
];

function QuickCompose() {
  const { me } = useSession();
  const { open } = useComposer();
  const items = [
    { type: "material", label: "Поділитися матеріалом", icon: BookOpen },
    { type: "question", label: "Поставити запитання", icon: HelpCircle },
    { type: "explanation", label: "Написати пояснення", icon: Lightbulb },
  ];
  return (
    <div className="flex gap-3 px-4 py-3 border-b border-line">
      <Avatar user={me} />
      <div className="flex-1 min-w-0">
        <button onClick={() => open("question")} className="w-full text-left text-muted text-[17px] py-2">Що вивчаєш сьогодні?</button>
        <div className="flex gap-1 flex-wrap">
          {items.map(({ type, label, icon: Icon }) => (
            <button key={type} onClick={() => open(type)} className="btn-quiet h-8 px-3 text-xs text-primary">
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") || "for_me";
  const type = params.get("type") || undefined;
  const empty = tab === "following"
    ? <Empty title="Ви ще ні на кого не підписані">Відкрийте профіль однокурсника й натисніть «Читати» — його роботи з'являться тут.</Empty>
    : tab === "my_subjects"
    ? <Empty title="Немає дописів з ваших предметів">Підпишіться на предмети в каталозі — їхні матеріали з'являться тут.</Empty>
    : undefined;
  return (
    <>
      <PageHeader>
        <UrlTabs param="tab" defaultValue="for_me" tabs={[
          { value: "for_me", label: t("feed.forMe") },
          { value: "following", label: "Підписки" },
          { value: "my_subjects", label: t("feed.mySubjects") },
          { value: "university", label: t("feed.university") },
        ]} />
      </PageHeader>
      <QuickCompose />
      <UrlPills param="type" options={TYPE_FILTERS} allLabel="Усі дописи" />
      <PostList query={{ tab, type }} empty={empty} />
    </>
  );
}

export function QuestionsPage() {
  const [params] = useSearchParams();
  const status = params.get("status") || undefined;
  const subject_id = params.get("subject") || undefined;
  const { activeUniversityId } = useSession();
  const subjects = useQuery({ queryKey: ["subjects", activeUniversityId, ""], queryFn: () => api("/subjects") });
  const { open } = useComposer();
  const [, setParams] = useSearchParams();
  return (
    <>
      <PageHeader title="Запитання" subtitle="Запитуй — спільнота допоможе розібратися"
        actions={<button className="btn-primary h-9" onClick={() => open("question")}><HelpCircle size={16} /> Запитати</button>}>
        <UrlPills param="status" allLabel="Нові" options={[
          { value: "unanswered", label: "Без відповідей" },
          { value: "open", label: "Відкриті" },
          { value: "solved", label: "Вирішені" },
        ]} />
        <div className="px-4 pb-2.5">
          <select className="input h-9 max-w-xs" aria-label="Предмет" value={subject_id || ""}
            onChange={(e) => setParams((p) => { e.target.value ? p.set("subject", e.target.value) : p.delete("subject"); return p; }, { replace: true })}>
            <option value="">Усі предмети</option>
            {subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </PageHeader>
      <PostList query={{ type: "question", status, subject_id }} />
    </>
  );
}

export function MaterialsPage() {
  const [params, setParams] = useSearchParams();
  const { activeUniversityId } = useSession();
  const subjects = useQuery({ queryKey: ["subjects", activeUniversityId, ""], queryFn: () => api("/subjects") });
  const get = (k) => params.get(k) || "";
  const setP = (k) => (e) => setParams((p) => { e.target.value ? p.set(k, e.target.value) : p.delete(k); return p; }, { replace: true });
  return (
    <>
      <PageHeader title="Матеріали" subtitle="Бібліотека конспектів, лабораторних і підготовки до іспитів">
        <form className="px-4 pb-2" onSubmit={(e) => { e.preventDefault(); setP("q")({ target: { value: e.target.q.value.trim() } }); }} role="search">
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={get("q")} key={get("q")} className="input pl-9 rounded-full" placeholder="Пошук за назвою та описом" />
          </label>
        </form>
        <div className="flex gap-2 overflow-x-auto scrollbar-none px-4 pb-2.5">
          <select className="input h-9 w-auto" aria-label="Предмет" value={get("subject")} onChange={setP("subject")}>
            <option value="">Усі предмети</option>
            {subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input h-9 w-auto" aria-label="Тип матеріалу" value={get("kind")} onChange={setP("kind")}>
            <option value="">Усі типи</option>
            {Object.entries(t("materialKind")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input h-9 w-auto" aria-label="Курс" value={get("course")} onChange={setP("course")}>
            <option value="">Курс</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} курс</option>)}
          </select>
          <select className="input h-9 w-auto" aria-label="Семестр" value={get("semester")} onChange={setP("semester")}>
            <option value="">Семестр</option>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} семестр</option>)}
          </select>
          <select className="input h-9 w-auto" aria-label="Сортування" value={get("sort")} onChange={setP("sort")}>
            <option value="">Нові</option><option value="popular">Корисні</option>
          </select>
        </div>
      </PageHeader>
      <PostList query={{ type: "material", q: get("q"), subject_id: get("subject"), kind: get("kind"), course: get("course"), semester: get("semester"), sort: get("sort") || undefined }} />
    </>
  );
}

export function SavedPage() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Збережене" subtitle="Ваші особисті закладки">
        <UrlPills param="type" options={TYPE_FILTERS} />
      </PageHeader>
      <PostList query={{ saved: true, type: params.get("type") || undefined }}
        empty={<Empty title="Тут поки порожньо">Натисніть «Зберегти» на корисному дописі, щоб знайти його пізніше.</Empty>} />
    </>
  );
}
