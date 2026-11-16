import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Download, ExternalLink, Eye, FileText, Lock, ShoppingBag, Sparkles, Upload, X } from "lucide-react";
import { api, uploadFile } from "../../lib/api.js";
import { fileSize } from "../../lib/format.js";
import { Modal, useToast } from "../../components/ui.jsx";

// Розділи предмета: порядок вкладок і підписи
export const KINDS = {
  lab: { tab: "Лабораторні", one: "Лабораторна робота", short: "ЛР" },
  practical: { tab: "Практичні", one: "Практична робота", short: "ПР" },
  module: { tab: "Модулі", one: "Модульна контрольна", short: "МК" },
  exam: { tab: "Екзамени", one: "Екзамен", short: "ЕК" },
};

export const STATUS = {
  pending: { label: "На розгляді", cls: "bg-amber-400/15 text-amber-700 dark:text-amber-300" },
  approved: { label: "Опубліковано", cls: "bg-primary/15 text-primary" },
  rejected: { label: "Відхилено", cls: "bg-danger/15 text-danger" },
};

export function StatusChip({ status }) {
  const s = STATUS[status];
  return s ? <span className={`chip ${s.cls}`}>{s.label}</span> : null;
}

export function taskLabel(t) {
  return `${KINDS[t.kind]?.one || "Завдання"} №${t.number}`;
}

// «Лабораторна робота №1 · Назва», без повтору, якщо назва збігається з типовою
export function taskFullTitle(t) {
  const label = taskLabel(t);
  return !t.title || t.title.trim() === label ? label : `${label} · ${t.title}`;
}

const DATE = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" });
const DATE_TIME = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function deadlineInfo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const when = days <= 0 ? "сьогодні" : days === 1 ? "завтра" : `через ${days} дн.`;
  return { text: DATE.format(d), full: DATE_TIME.format(d), when, urgent: days <= 2, past: d.getTime() < Date.now() };
}

export function DeadlineChip({ iso }) {
  const d = deadlineInfo(iso);
  if (!d) return null;
  return (
    <span className={`chip ${d.past ? "bg-sunken text-muted" : d.urgent ? "bg-danger/15 text-danger" : "bg-sunken text-ink"}`} title={d.full}>
      <CalendarClock size={12} aria-hidden /> {d.past ? `минув ${d.text}` : `до ${d.text}`}
    </span>
  );
}

const IMAGE = new Set(["PNG", "JPG", "WEBP", "GIF"]);

// Перегляд PDF і зображень прямо на сайті: тимчасове посилання inline, без завантаження файлу
function PreviewModal({ file, linkPath, open, onClose, onDownload }) {
  const link = useQuery({
    queryKey: ["file-link", linkPath],
    queryFn: () => api(linkPath),
    enabled: open,
    staleTime: 60_000, // посилання живе 120 с
    gcTime: 0,
  });
  const url = link.data?.url;
  return (
    <Modal open={open} onClose={onClose} title={file.file_name} labelledBy={`pv-${file.id}`} wide="xl">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line">
        <span className="text-xs text-muted mr-auto">{file.format} · {fileSize(file.size_bytes)}</span>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="btn-quiet h-8 px-3 text-xs"><ExternalLink size={14} /> У новій вкладці</a>}
        <button type="button" className="btn-ghost h-8 px-3 text-xs" onClick={onDownload}><Download size={14} /> Завантажити</button>
      </div>
      <div className="bg-sunken grid place-items-center" style={{ height: "min(75vh, 900px)" }}>
        {link.isLoading ? <span className="text-sm text-muted">Відкриваємо файл…</span>
          : link.isError ? <span className="text-sm text-danger px-4 text-center">{link.error.message}</span>
          : IMAGE.has(file.format) ? <img src={url} alt={file.file_name} className="max-w-full max-h-full object-contain" />
          : <iframe src={url} title={`Перегляд: ${file.file_name}`} className="w-full h-full border-0 bg-white" />}
      </div>
    </Modal>
  );
}

// Рядок файлу: «Переглянути» (PDF і зображення — у вікні на сайті) та «Завантажити»
export function FileRow({ file, linkPath, children }) {
  const toast = useToast();
  const [preview, setPreview] = useState(false);
  const download = async () => {
    try {
      const { url } = await api(linkPath, { query: { download: true } });
      // посилання з Content-Disposition: attachment — браузер завантажує файл, не залишаючи сторінку
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  const view = async () => {
    // на телефонах PDF у вбудованому вікні часто не відображається — відкриваємо системний переглядач
    const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    if (touch && file.format === "PDF") {
      const w = window.open("", "_blank");
      try {
        const { url } = await api(linkPath);
        if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
      } catch (e) { w?.close(); toast(e.message, "error"); }
      return;
    }
    setPreview(true);
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 min-w-0">
      <button type="button" onClick={file.previewable ? view : download} className="w-10 h-10 rounded-lg bg-sunken grid place-items-center shrink-0 hover:bg-primary/15" tabIndex={-1} aria-hidden>
        <FileText size={18} className="text-primary" />
      </button>
      <span className="flex-1 min-w-0">
        <span className="text-sm font-medium break-all line-clamp-2">{file.file_name}</span>
        <span className="block text-xs text-muted">{file.format} · {fileSize(file.size_bytes)}</span>
        {children}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        {file.previewable && (
          <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={view} aria-label={`Переглянути ${file.file_name}`}>
            <Eye size={15} /><span className="hidden sm:inline">Переглянути</span>
          </button>
        )}
        <button type="button" className={file.previewable ? "icon-btn" : "btn-ghost h-9 px-3 text-xs"} onClick={download} aria-label={`Завантажити ${file.file_name}`} title="Завантажити">
          <Download size={15} />{!file.previewable && <span className="hidden sm:inline">Завантажити</span>}
        </button>
      </span>
      {preview && <PreviewModal file={file} linkPath={linkPath} open={preview} onClose={() => setPreview(false)} onDownload={download} />}
    </div>
  );
}

const ACCEPT = ".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.zip";

// Вибір файлу з перетягуванням
export function FilePicker({ file, onChange, maxMb = 25 }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <input ref={ref} type="file" accept={ACCEPT} className="sr-only" id="file-input"
        onChange={(e) => onChange(e.target.files?.[0] || null)} />
      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/50 bg-primary/5 px-3 py-2.5">
          <FileText size={18} className="text-primary shrink-0" aria-hidden />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium break-all">{file.name}</span>
            <span className="block text-xs text-muted">{fileSize(file.size)}</span>
          </span>
          <button type="button" className="icon-btn" onClick={() => { onChange(null); if (ref.current) ref.current.value = ""; }} aria-label="Прибрати файл"><X size={16} /></button>
        </div>
      ) : (
        <label htmlFor="file-input"
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onChange(e.dataTransfer.files?.[0] || null); }}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center cursor-pointer transition-colors
            ${drag ? "border-primary bg-primary/5" : "border-line hover:border-primary/50 hover:bg-sunken"}`}>
          <Upload size={22} className="text-primary" aria-hidden />
          <span className="text-sm font-medium">Оберіть файл або перетягніть сюди</span>
          <span className="text-xs text-muted">PDF, DOCX, PPTX, зображення або ZIP · до {maxMb} МБ</span>
        </label>
      )}
    </div>
  );
}

// «Подати свій варіант»: предмет і завдання підставляються автоматично
export function SubmitDialog({ task, open, onClose }) {
  const [file, setFile] = useState(null);
  const [comment, setComment] = useState("");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const qc = useQueryClient();
  const toast = useToast();
  const close = () => { if (progress === null) { setFile(null); setComment(""); setError(null); onClose(); } };
  const send = async (e) => {
    e.preventDefault();
    if (!file) return setError("Оберіть файл");
    setError(null);
    setProgress(0);
    try {
      await uploadFile(`/tasks/${task.id}/submissions`, file, setProgress, { comment: comment.trim() });
      qc.invalidateQueries({ queryKey: ["task", task.id] });
      qc.invalidateQueries({ queryKey: ["my-submissions"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Роботу надіслано на розгляд");
      setProgress(null);
      setFile(null);
      setComment("");
      onClose();
    } catch (err) {
      setProgress(null);
      setError(err.message);
    }
  };
  return (
    <Modal open={open} onClose={close} title="Подати свій варіант" labelledBy="submit-h">
      <form onSubmit={send} className="p-4 space-y-4">
        <div className="rounded-xl bg-sunken px-3 py-2.5 text-sm">
          <div className="text-xs text-muted">{task.subject?.name}</div>
          <div className="font-semibold break-words">{taskFullTitle(task)}</div>
        </div>
        <FilePicker file={file} onChange={(f) => { setFile(f); setError(null); }} />
        <div>
          <label className="label" htmlFor="sub-comment">Коментар для модератора (необов'язково)</label>
          <textarea id="sub-comment" className="textarea min-h-[80px]" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Наприклад: варіант 7, оцінка 5" />
        </div>
        <p className="text-xs text-muted">Після перевірки модератором робота з'явиться серед прикладів до цього завдання. Статус видно в розділі «Мої подання».</p>
        {error && <div className="text-sm text-danger" role="alert">{error}</div>}
        {progress !== null && (
          <div className="h-1.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Завантаження файлу">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={close} disabled={progress !== null}>Скасувати</button>
          <button className="btn-primary" disabled={progress !== null || !file}>{progress !== null ? `Завантаження ${progress}%` : "Надіслати на розгляд"}</button>
        </div>
      </form>
    </Modal>
  );
}

export const BUY_TEXT = "Скоро тут можна буде замовити окремий варіант звіту для цього завдання. ШІ адаптуватиме структуру, формулювання й оформлення, щоб кожен варіант відрізнявся від інших.";

// «Купити звіт» — поки лише анонс, без оплати й замовлень
export function BuyReport() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <button type="button" className="btn-ghost shrink-0" onClick={() => setOpen(true)}>
        <ShoppingBag size={16} /> Купити звіт <span className="chip bg-lime/20 text-lime !px-1.5 !py-0 text-[10px]">Скоро</span>
      </button>
      <p className="text-xs text-muted">{BUY_TEXT}</p>
      <Modal open={open} onClose={() => setOpen(false)} title="Купити звіт" labelledBy="buy-h">
        <div className="p-5 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-lime/15 text-lime grid place-items-center mb-3"><Sparkles size={26} aria-hidden /></div>
          <span className="chip bg-lime/20 text-lime mb-3"><Lock size={12} aria-hidden /> Скоро</span>
          <p className="text-sm leading-relaxed">{BUY_TEXT}</p>
          <button className="btn-primary mt-5" onClick={() => setOpen(false)}>Зрозуміло</button>
        </div>
      </Modal>
    </div>
  );
}
