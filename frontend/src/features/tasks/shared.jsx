import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Download, Eye, FileText, Lock, ShoppingBag, Sparkles, Upload, X } from "lucide-react";
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

// Відкриття файлу за тимчасовим посиланням (права перевіряє backend)
export function useFileOpener() {
  const toast = useToast();
  return async (path) => {
    // вікно відкриваємо одразу, інакше браузер заблокує його після await
    const w = window.open("", "_blank");
    try {
      const { url } = await api(path);
      if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
    } catch (e) {
      w?.close();
      toast(e.message, "error");
    }
  };
}

export function FileRow({ file, onOpen, children }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 min-w-0">
      <span className="w-10 h-10 rounded-lg bg-sunken grid place-items-center shrink-0" aria-hidden><FileText size={18} className="text-primary" /></span>
      <span className="flex-1 min-w-0">
        <span className="text-sm font-medium break-all line-clamp-2">{file.file_name}</span>
        <span className="block text-xs text-muted">{file.format} · {fileSize(file.size_bytes)}</span>
        {children}
      </span>
      <button type="button" className="btn-ghost h-9 px-3 text-xs shrink-0" onClick={onOpen}
        aria-label={`${file.previewable ? "Переглянути" : "Завантажити"} ${file.file_name}`}>
        {file.previewable ? <Eye size={15} /> : <Download size={15} />}
        <span className="hidden sm:inline">{file.previewable ? "Переглянути" : "Завантажити"}</span>
      </button>
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
