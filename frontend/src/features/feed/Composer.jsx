import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, FileUp, HelpCircle, Lightbulb, Paperclip, RotateCcw, Trash2 } from "lucide-react";
import { api, uploadFile } from "../../lib/api.js";
import { fileSize } from "../../lib/format.js";
import { local } from "../../lib/storage.js";
import { t } from "../../lib/i18n.js";
import { useSession } from "../../app/session.jsx";
import { Modal, useToast } from "../../components/ui.jsx";

const MODES = [
  { type: "material", label: "Поділитися матеріалом", icon: BookOpen },
  { type: "question", label: "Поставити запитання", icon: HelpCircle },
  { type: "explanation", label: "Написати пояснення", icon: Lightbulb },
];
const ACCEPT = ".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.zip";
const ALLOWED_EXT = ACCEPT.split(",");
const EMPTY = { title: "", body: "", subject_id: "", topic_id: "", kind: "notes", link_url: "", course: "", semester: "", tried: "", unclear_step: "", visibility: "university" };

// Відкривається через ?compose=material|question|explanation (стан у URL)
export function useComposer() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("compose");
  return {
    mode,
    open: (type = "material", extra = {}) => setParams((p) => { p.set("compose", type); Object.entries(extra).forEach(([k, v]) => p.set(k, v)); return p; }),
    close: () => setParams((p) => { p.delete("compose"); p.delete("subject"); return p; }, { replace: true }),
    presetSubject: params.get("subject"),
  };
}

export default function Composer() {
  const { mode, close, presetSubject } = useComposer();
  if (!mode) return null;
  return <ComposerDialog key={mode} type={MODES.some((m) => m.type === mode) ? mode : "material"} onClose={close} presetSubject={presetSubject} />;
}

function ComposerDialog({ type: initialType, onClose, presetSubject }) {
  const [type, setType] = useState(initialType);
  const { activeUniversityId, config, membership } = useSession();
  const draftKey = `unipars.draft.${activeUniversityId}.${type}`;
  const [form, setForm] = useState(() => ({ ...EMPTY, subject_id: presetSubject || "", ...local.get(draftKey, {}) }));
  const [files, setFiles] = useState([]); // {file, progress, status: pending|uploading|done|error, error}
  const [stage, setStage] = useState("edit"); // edit | saving | uploading
  const [error, setError] = useState(null);
  const [createdId, setCreatedId] = useState(null);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const fileInput = useRef(null);
  const maxMb = config?.max_upload_mb || 25;

  useEffect(() => { setForm({ ...EMPTY, subject_id: presetSubject || "", ...local.get(`unipars.draft.${activeUniversityId}.${type}`, {}) }); }, [type]); // eslint-disable-line
  // Чернетка зберігається автоматично — не загубиться при випадковому закритті
  useEffect(() => { if (stage === "edit") local.set(draftKey, form); }, [form, draftKey, stage]);

  const subjects = useQuery({ queryKey: ["subjects", activeUniversityId, ""], queryFn: () => api("/subjects") });
  const subject = useQuery({
    queryKey: ["subject", activeUniversityId, form.subject_id],
    queryFn: () => api(`/subjects/${form.subject_id}`),
    enabled: Boolean(form.subject_id),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === "subject_id" ? { topic_id: "" } : {}) }));

  const addFiles = (list) => {
    const next = [];
    for (const file of list) {
      const ext = "." + file.name.split(".").pop().toLowerCase();
      let err = null;
      if (!ALLOWED_EXT.includes(ext)) err = "Непідтримуваний формат";
      else if (file.size > maxMb * 1024 * 1024) err = `Більше ${maxMb} МБ`;
      next.push({ id: Math.random(), file, progress: 0, status: err ? "invalid" : "pending", error: err });
    }
    setFiles((f) => [...f, ...next].slice(0, 10));
  };

  const valid = form.title.trim() && form.subject_id && (type !== "material" || form.kind) && (form.kind !== "link" || type !== "material" || form.link_url);

  async function uploadOne(postId, item) {
    setFiles((fs) => fs.map((f) => (f.id === item.id ? { ...f, status: "uploading", progress: 0, error: null } : f)));
    try {
      await uploadFile(`/posts/${postId}/attachments`, item.file, (p) =>
        setFiles((fs) => fs.map((f) => (f.id === item.id ? { ...f, progress: p } : f))));
      setFiles((fs) => fs.map((f) => (f.id === item.id ? { ...f, status: "done", progress: 100 } : f)));
      return true;
    } catch (e) {
      setFiles((fs) => fs.map((f) => (f.id === item.id ? { ...f, status: "error", error: e.message } : f)));
      return false;
    }
  }

  async function finish(postId) {
    local.remove(draftKey);
    await qc.invalidateQueries({ queryKey: ["posts"] });
    toast("Опубліковано");
    onClose();
    nav(`/p/${postId}`);
  }

  async function submit(e) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    let postId = createdId;
    if (!postId) {
      setStage("saving");
      try {
        const body = {
          type, title: form.title.trim(), body: form.body, subject_id: form.subject_id, topic_id: form.topic_id || null,
          visibility: form.visibility,
          material: type === "material" ? { kind: form.kind, link_url: form.kind === "link" ? form.link_url : null,
            course: form.course ? Number(form.course) : null, semester: form.semester ? Number(form.semester) : null } : null,
          question: type === "question" ? { tried: form.tried, unclear_step: form.unclear_step } : null,
        };
        const post = await api("/posts", { method: "POST", body });
        postId = post.id;
        setCreatedId(post.id);
      } catch (err) {
        setError(err.message);
        setStage("edit");
        return;
      }
    }
    setStage("uploading");
    let ok = true;
    for (const item of files.filter((f) => f.status === "pending" || f.status === "error")) {
      ok = (await uploadOne(postId, item)) && ok;
    }
    if (ok) await finish(postId);
    else setStage("uploading"); // залишаємось: можна повторити або пропустити
  }

  const failed = files.some((f) => f.status === "error");
  const busy = stage === "saving" || files.some((f) => f.status === "uploading");
  const subjectTopics = subject.data?.topics || [];
  const mode = useMemo(() => MODES.find((m) => m.type === type), [type]);

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={mode.label} wide labelledBy="composer-title">
      <form onSubmit={submit} className="p-4 space-y-4">
        {!createdId && (
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Тип допису">
            {MODES.map(({ type: tp, label, icon: Icon }) => (
              <button type="button" key={tp} role="radio" aria-checked={type === tp} onClick={() => setType(tp)}
                className={`rounded-xl border p-2.5 text-xs sm:text-sm font-semibold flex flex-col sm:flex-row items-center gap-1.5 justify-center transition-colors ${type === tp ? "border-primary bg-primary/10 text-primary" : "border-line hover:bg-sunken"}`}>
                <Icon size={16} /> <span className="text-center">{label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="c-subject">Предмет *</label>
            <select id="c-subject" className="input" value={form.subject_id} onChange={set("subject_id")} required disabled={Boolean(createdId)}>
              <option value="">Оберіть предмет</option>
              {subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="c-topic">Тема</label>
            <select id="c-topic" className="input" value={form.topic_id} onChange={set("topic_id")} disabled={!form.subject_id || Boolean(createdId)}>
              <option value="">Без теми</option>
              {subjectTopics.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
          </div>
        </div>

        {type === "material" && (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="label" htmlFor="c-kind">Тип матеріалу *</label>
              <select id="c-kind" className="input" value={form.kind} onChange={set("kind")} disabled={Boolean(createdId)}>
                {Object.entries(t("materialKind")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="c-course">Курс</label>
              <select id="c-course" className="input" value={form.course} onChange={set("course")} disabled={Boolean(createdId)}>
                <option value="">—</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="c-sem">Семестр</label>
              <select id="c-sem" className="input" value={form.semester} onChange={set("semester")} disabled={Boolean(createdId)}>
                <option value="">—</option>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="c-title">{type === "question" ? "Короткий заголовок *" : "Назва *"}</label>
          <input id="c-title" className="input" maxLength={200} value={form.title} onChange={set("title")} required disabled={Boolean(createdId)}
            placeholder={type === "question" ? "Наприклад: Чому рекурсія не завершується?" : type === "explanation" ? "Що пояснюєш?" : "Наприклад: Конспект лекцій 1–5"} />
        </div>

        {type === "material" && form.kind === "link" && (
          <div>
            <label className="label" htmlFor="c-link">Посилання *</label>
            <input id="c-link" type="url" className="input" value={form.link_url} onChange={set("link_url")} placeholder="https://" required disabled={Boolean(createdId)} />
          </div>
        )}

        <div>
          <label className="label" htmlFor="c-body">{type === "question" ? "Умова або опис проблеми" : type === "material" ? "Короткий опис" : "Пояснення"}</label>
          <textarea id="c-body" className="textarea min-h-[110px] font-[inherit]" value={form.body} onChange={set("body")} disabled={Boolean(createdId)}
            placeholder="Підтримується Markdown, код у ```блоках``` і формули $a^2+b^2$" />
        </div>

        {type === "question" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="c-tried">Що вже пробував</label>
              <textarea id="c-tried" className="textarea min-h-[70px]" value={form.tried} onChange={set("tried")} disabled={Boolean(createdId)} />
            </div>
            <div>
              <label className="label" htmlFor="c-unclear">Який крок незрозумілий</label>
              <textarea id="c-unclear" className="textarea min-h-[70px]" value={form.unclear_step} onChange={set("unclear_step")} disabled={Boolean(createdId)} />
            </div>
          </div>
        )}

        {membership?.group_id && !createdId && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.visibility === "group"} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.checked ? "group" : "university" }))} />
            Лише для моєї навчальної групи
          </label>
        )}

        {/* Вкладення */}
        <div>
          <div className="flex items-center justify-between">
            <span className="label mb-0">Файли {type === "question" ? "(необов'язково)" : ""}</span>
            <button type="button" className="btn-quiet h-8 text-xs" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Paperclip size={14} /> Додати файл
            </button>
            <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
          </div>
          <div
            className="mt-2 rounded-xl border border-dashed border-line p-3 text-xs text-muted text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}
          >
            <FileUp size={16} className="inline mr-1" /> Перетягніть сюди PDF, DOCX, PPTX, зображення або ZIP (до {maxMb} МБ)
          </div>
          {files.length > 0 && (
            <ul className="mt-2 space-y-2">
              {files.map((f) => (
                <li key={f.id} className="rounded-xl border border-line p-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="truncate flex-1 min-w-0">{f.file.name}</span>
                    <span className="text-xs text-muted shrink-0">{fileSize(f.file.size)}</span>
                    {f.status === "done" && <CheckCircle2 size={16} className="text-primary" />}
                    {f.status === "error" && createdId && (
                      <button type="button" className="icon-btn w-7 h-7" onClick={() => uploadOne(createdId, f)} aria-label="Повторити"><RotateCcw size={14} /></button>
                    )}
                    {(f.status === "pending" || f.status === "invalid" || f.status === "error") && (
                      <button type="button" className="icon-btn w-7 h-7" onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))} aria-label="Прибрати"><Trash2 size={14} /></button>
                    )}
                  </div>
                  {(f.status === "uploading" || f.status === "done") && (
                    <div className="mt-2 h-1.5 rounded-full bg-sunken overflow-hidden" role="progressbar" aria-valuenow={f.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-primary transition-all" style={{ width: `${f.progress}%` }} />
                    </div>
                  )}
                  {f.error && <div className="mt-1 text-xs text-danger">{f.error}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <div className="text-sm text-danger" role="alert">{error}</div>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted">{createdId ? "Допис створено. Завершіть завантаження файлів." : "Чернетка зберігається автоматично"}</span>
          <div className="flex gap-2">
            {createdId && failed && <button type="button" className="btn-ghost" onClick={() => finish(createdId)}>Без цих файлів</button>}
            <button className="btn-primary" disabled={!valid || busy || files.some((f) => f.status === "invalid")}>
              {stage === "saving" ? "Публікація…" : createdId ? (failed ? "Повторити" : "Готово") : "Опублікувати"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
