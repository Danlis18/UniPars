import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Camera, CalendarDays, GraduationCap, Heart, Pencil, Send, Settings, UserCheck, UserPlus } from "lucide-react";
import { api, uploadFile } from "../../lib/api.js";
import { useSession } from "../../app/session.jsx";
import { Avatar, Empty, ErrorState, Loading, Modal, useConfirm, useToast } from "../../components/ui.jsx";
import { PageHeader, UrlTabs } from "../../components/PageHeader.jsx";
import PostList from "../feed/PostList.jsx";
import { FileRow, taskFullTitle, useFileOpener } from "../tasks/shared.jsx";
import { CoverPicker, ProfileCover } from "./Covers.jsx";
import { MessageButton } from "../messages/MessagesPage.jsx";

export function FollowButton({ user, size = "md", onChange }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState(user.is_following);
  const m = useMutation({
    mutationFn: () => api(`/users/${user.id}/follow`, { method: "POST" }),
    onMutate: () => setState((s) => !s),
    onSuccess: (r) => {
      setState(r.is_following);
      onChange?.(r);
      qc.invalidateQueries({ queryKey: ["user"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => { setState((s) => !s); toast(e.message, "error"); },
  });
  if (user.is_me) return null;
  const h = size === "sm" ? "h-8 px-3 text-xs" : "h-10";
  return (
    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); m.mutate(); }} disabled={m.isPending}
      className={`${state ? "btn-ghost" : "btn-accent"} ${h} transition-all active:scale-95`} aria-pressed={state}>
      {state ? <><UserCheck size={15} /> Ви читаєте</> : <><UserPlus size={15} /> Читати</>}
    </button>
  );
}

export function BotChip() {
  return <span className="chip bg-sunken text-muted border border-line" title="Автоматичний акаунт UniPars"><Bot size={11} /> Бот</span>;
}

function PeopleRows({ userId, kind, onNavigate }) {
  const q = useQuery({ queryKey: ["user", userId, kind], queryFn: () => api(`/users/${userId}/${kind}`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length) return <Empty title={kind === "followers" ? "Поки немає читачів" : "Поки ні на кого не підписаний"} />;
  return (
    <ul className="py-1">
      {q.data.map((u) => (
        <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/40">
          <Link to={`/u/${u.id}`} onClick={onNavigate} className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar user={u} size={44} ring={!u.is_bot} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-semibold"><span className="truncate">{u.display_name}</span>{u.is_bot && <BotChip />}</span>
              <span className="block text-xs text-muted truncate">{u.bio}</span>
            </span>
          </Link>
          {!u.is_bot && <FollowButton user={u} size="sm" />}
        </li>
      ))}
    </ul>
  );
}

function PeopleList({ userId, kind, onClose }) {
  return (
    <Modal open onClose={onClose} title={kind === "followers" ? "Читачі" : "Читає"}>
      <PeopleRows userId={userId} kind={kind} onNavigate={onClose} />
    </Modal>
  );
}

function AvatarEditor({ profile }) {
  const { refreshMe } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef(null);
  const [progress, setProgress] = useState(null);
  const [url, setUrl] = useState(profile.avatar_url);
  const refresh = () => { refreshMe(); qc.invalidateQueries({ queryKey: ["user"] }); qc.invalidateQueries({ queryKey: ["posts"] }); };
  const pick = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Оберіть зображення: JPG, PNG або WEBP", "error");
    if (file.size > 8 * 1024 * 1024) return toast("Фото завелике. Максимум 8 МБ", "error");
    setProgress(0);
    try {
      const r = await uploadFile("/me/avatar", file, setProgress);
      setUrl(r.avatar_url);
      refresh();
      toast("Фото профілю оновлено");
    } catch (e) { toast(e.message, "error"); }
    setProgress(null);
  };
  const remove = async () => {
    if (!(await confirm({ title: "Прибрати фото профілю?", message: "Замість фото показуватимуться ваші ініціали.", confirmLabel: "Прибрати", danger: true }))) return;
    await api("/me/avatar", { method: "DELETE" });
    setUrl(null);
    refresh();
  };
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar user={{ ...profile, avatar_url: url }} size={76} ring />
        {progress !== null && (
          <div className="absolute inset-0 rounded-full bg-black/50 grid place-items-center text-white text-xs font-bold">{progress}%</div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 items-start">
        <button type="button" className="btn-ghost h-9" onClick={() => input.current?.click()} disabled={progress !== null}>
          <Camera size={15} /> {url ? "Змінити фото" : "Додати фото"}
        </button>
        {url && <button type="button" className="text-xs text-muted hover:text-danger" onClick={remove}>Прибрати фото</button>}
        <span className="text-[11px] text-muted">JPG, PNG або WEBP до 8 МБ. Ми обріжемо до квадрата.</span>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
        onChange={(e) => { pick(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

function EditProfile({ profile, onClose }) {
  const { refreshMe } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ display_name: profile.display_name || "", bio: profile.bio || "", telegram: profile.telegram ? "@" + profile.telegram : "", cover: profile.cover || "" });
  const [error, setError] = useState(null);
  const save = useMutation({
    mutationFn: () => api("/me", { method: "PATCH", body: {
      display_name: f.display_name.trim(), bio: f.bio, telegram: f.telegram.trim(),
      // обкладинку надсилаємо, лише якщо її змінили
      ...((f.cover || "") !== (profile.cover || "") ? { cover: f.cover } : {}),
    } }),
    onSuccess: () => { refreshMe(); qc.invalidateQueries({ queryKey: ["user"] }); toast("Профіль оновлено"); onClose(); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Редагувати профіль">
      <form className="p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <AvatarEditor profile={profile} />
        <div><label className="label" htmlFor="e-name">Ім'я</label>
          <input id="e-name" className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} maxLength={80} required /></div>
        <div><label className="label" htmlFor="e-bio">Про себе</label>
          <textarea id="e-bio" className="textarea min-h-[80px]" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={500}
            placeholder="Що вивчаєш, у чому можеш допомогти іншим" /></div>
        <CoverPicker value={f.cover} onChange={(cover) => setF({ ...f, cover })} />
        <div><label className="label" htmlFor="e-tg">Telegram (необов'язково)</label>
          <div className="relative">
            <Send size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#229ED9]" />
            <input id="e-tg" className="input pl-9" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} placeholder="@нік або t.me/нік" />
          </div>
          <p className="text-xs text-muted mt-1">Посилання з'явиться у вашому профілі, щоб однокурсники могли написати вам.</p></div>
        {error && <div className="text-sm text-danger" role="alert">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Скасувати</button>
          <button className="btn-primary" disabled={save.isPending}>Зберегти</button>
        </div>
      </form>
    </Modal>
  );
}

function Stat({ value, label, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`text-left ${onClick ? "hover:opacity-70 transition-opacity" : ""}`}>
      <span className="font-display text-lg">{value}</span> <span className="text-sm text-muted">{label}</span>
    </Tag>
  );
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// Опубліковані (схвалені модерацією) роботи користувача
function PublishedWorks({ userId, isMe }) {
  const { activeUniversityId } = useSession();
  const open = useFileOpener();
  const q = useQuery({ queryKey: ["works", activeUniversityId, userId], queryFn: () => api(`/users/${userId}/works`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length) return (
    <Empty title={isMe ? "Ще немає опублікованих робіт" : "Тут поки порожньо"}>
      {isMe ? <>Подайте свій варіант на сторінці завдання. Статус перевірки — у розділі <Link to="/submissions" className="text-primary hover:underline">«Мої подання»</Link>.</> : null}
    </Empty>
  );
  return (
    <ul className="p-4 space-y-3">
      {q.data.map((w) => (
        <li key={w.id}>
          <Link to={`/tasks/${w.task.id}`} className="block text-xs text-muted hover:text-primary mb-1 break-words">
            {w.subject?.name} · {taskFullTitle(w.task)}
          </Link>
          <FileRow file={w} onOpen={() => open(`/submissions/${w.id}/link`)} />
        </li>
      ))}
    </ul>
  );
}

export default function UserProfile() {
  const { id } = useParams();
  const { me } = useSession();
  const [params] = useSearchParams();
  const tab = params.get("tab") || "works";
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(false);
  const userId = id === "me" ? me.id : id;
  const q = useQuery({ queryKey: ["user", userId], queryFn: () => api(`/users/${userId}`) });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <><PageHeader back title="Профіль" /><ErrorState error={q.error} onRetry={q.refetch} /></>;
  const p = q.data;
  const ctx = p.context;
  const type = { questions: "question", archive: "legacy" }[tab];

  return (
    <>
      <PageHeader back title={p.display_name} />
      <div className="relative">
        <ProfileCover cover={p.cover} />
        <div className="px-4 pb-4 border-b border-line">
          <div className="flex items-end justify-between -mt-12 sm:-mt-14">
            {/* z-10: аватар поверх обкладинки */}
            <div className="relative z-10 rounded-full p-1 bg-bg"><Avatar user={p} size={104} ring /></div>
            <div className="flex gap-2 pb-1">
              {p.is_me ? (
                <>
                  <button className="btn-ghost h-10" onClick={() => setEditing(true)}><Pencil size={15} /> Редагувати</button>
                  <Link to="/settings" className="btn-ghost h-10 w-10 p-0" aria-label="Налаштування"><Settings size={16} /></Link>
                </>
              ) : <><MessageButton user={p} /><FollowButton user={p} /></>}
            </div>
          </div>
          <h2 className="font-display text-2xl mt-3 break-words flex items-center gap-2">{p.display_name}{p.is_bot && <BotChip />}</h2>
          {p.follows_you && <span className="chip bg-sunken text-muted mt-1">Читає вас</span>}
          {p.bio && <p className="mt-2 text-[15px] whitespace-pre-wrap break-words">{p.bio}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-muted">
            {ctx && (
              <span className="flex items-center gap-1.5"><GraduationCap size={16} />
                {[ctx.university, ctx.program, ctx.group, ctx.course && `${ctx.course} курс`].filter(Boolean).join(" · ")}
              </span>
            )}
            {p.created_at && <span className="flex items-center gap-1.5"><CalendarDays size={16} /> З нами з {new Date(p.created_at).toLocaleDateString("uk-UA", { month: "long", year: "numeric" })}</span>}
            {p.telegram && (
              <a href={`https://t.me/${p.telegram}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[#229ED9] font-medium hover:underline">
                <Send size={15} /> @{p.telegram}
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
            <Stat value={p.following} label="читає" onClick={() => setList("following")} />
            <Stat value={p.followers} label={plural(p.followers, "читач", "читачі", "читачів")} onClick={() => setList("followers")} />
            <span className="flex items-center gap-1 text-sm text-muted"><Heart size={14} className="text-rose-500" fill="currentColor" /> <b className="text-ink font-display">{p.useful}</b> «корисно»</span>
          </div>
        </div>
      </div>
      <div className="sticky top-[56px] z-10 bg-bg/90 backdrop-blur border-b border-line">
        <UrlTabs param="tab" defaultValue="works" tabs={[
          { value: "works", label: "Роботи" }, { value: "questions", label: "Питання" },
          ...(p.legacy_posts ? [{ value: "archive", label: "Архів" }] : []),
          { value: "followers", label: `Читачі · ${p.followers}` }, { value: "following", label: `Читає · ${p.following}` },
        ]} />
      </div>
      {tab === "followers" || tab === "following" ? <PeopleRows userId={p.id} kind={tab} /> : tab === "works" ? <PublishedWorks userId={p.id} isMe={p.is_me} /> : (
      <PostList query={{ author_id: p.id, type, tab: "university" }}
        empty={<Empty title={p.is_me ? "Ви ще не ставили питань" : "Тут поки порожньо"}>{p.is_me ? "Питання ставлять у вкладці «Питання» потрібного предмета." : null}</Empty>} />
      )}
      {list && <PeopleList userId={p.id} kind={list} onClose={() => setList(null)} />}
      {editing && <EditProfile profile={p} onClose={() => setEditing(false)} />}
    </>
  );
}
