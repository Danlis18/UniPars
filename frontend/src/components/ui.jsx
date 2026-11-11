// Спільні дрібні компоненти: аватар, стани, модальні вікна, підтвердження, тости.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import { colorFor, initials } from "../lib/format.js";

export function Avatar({ user, size = 40 }) {
  const name = user?.display_name || "?";
  if (user?.avatar_url) return <img src={user.avatar_url} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  return (
    <div
      aria-hidden
      className="rounded-full grid place-items-center text-white font-semibold shrink-0 select-none"
      style={{ width: size, height: size, background: colorFor(user?.id || name), fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  );
}

export function Spinner({ className = "" }) {
  return <Loader2 className={`animate-spin text-muted ${className}`} size={20} aria-label="Завантаження" />;
}

export function Loading({ label = "Завантаження…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted text-sm" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ rows = 3 }) {
  return (
    <div className="divide-y divide-line" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 p-4 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-sunken" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-sunken" />
            <div className="h-4 w-3/4 rounded bg-sunken" />
            <div className="h-3 w-full rounded bg-sunken" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title = "Поки порожньо", children, icon: Icon = Inbox }) {
  return (
    <div className="text-center px-6 py-12">
      <Icon className="mx-auto text-muted mb-3" size={32} />
      <div className="font-display text-lg mb-1">{title}</div>
      {children && <div className="text-sm text-muted max-w-sm mx-auto">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="text-center px-6 py-10" role="alert">
      <AlertTriangle className="mx-auto text-danger mb-2" size={28} />
      <div className="font-semibold mb-1">Не вдалося завантажити</div>
      <div className="text-sm text-muted mb-4">{error?.message || "Сталася помилка"}</div>
      {onRetry && <button className="btn-ghost" onClick={onRetry}>Спробувати ще</button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false, labelledBy }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={labelledBy}
      className={`backdrop:bg-black/40 bg-surface text-ink rounded-2xl p-0 w-[min(100vw-24px,${wide ? "720px" : "560px"})] max-h-[90vh] border border-line shadow-2xl`}
      style={{ width: `min(calc(100vw - 24px), ${wide ? 720 : 560}px)` }}
    >
      {open && (
        <div className="flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
            <h2 id={labelledBy} className="font-display text-base">{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Закрити"><X size={18} /></button>
          </div>
          <div className="overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ---------- Підтвердження ----------
const ConfirmCtx = createContext(null);
const ToastCtx = createContext(null);

export function UiProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);

  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  const toast = useCallback((text, kind = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  const close = (v) => { confirmState?.resolve(v); setConfirmState(null); };

  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={toast}>
        {children}
        <Modal open={Boolean(confirmState)} onClose={() => close(false)} title={confirmState?.title || "Підтвердження"}>
          <div className="p-4 text-sm">{confirmState?.message}</div>
          <div className="flex justify-end gap-2 px-4 pb-4">
            <button className="btn-ghost" onClick={() => close(false)}>Скасувати</button>
            <button className={confirmState?.danger ? "btn bg-danger text-white" : "btn-primary"} onClick={() => close(true)} autoFocus>
              {confirmState?.confirmLabel || "Підтвердити"}
            </button>
          </div>
        </Modal>
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${t.kind === "error" ? "bg-danger text-white" : "bg-primary text-on-primary"}`}>
              {t.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
export const useToast = () => useContext(ToastCtx);

export function DemoBadge({ className = "" }) {
  return <span className={`chip bg-lime text-on-lime ${className}`} title="Демонстраційні дані">ДЕМО</span>;
}
