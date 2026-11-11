import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export function PageHeader({ title, subtitle, back = false, actions, children }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-20 bg-bg/85 backdrop-blur border-b border-line">
      {(title || actions) && (
        <div className="flex items-center gap-3 px-4 min-h-[56px] py-2">
          {back && <button className="icon-btn -ml-2" onClick={() => nav(-1)} aria-label="Назад"><ArrowLeft size={20} /></button>}
          <div className="flex-1 min-w-0">
            {title && <h1 className="font-display text-lg leading-tight truncate">{title}</h1>}
            {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </header>
  );
}

// Вкладки, стан яких зберігається в URL
export function UrlTabs({ param, tabs, defaultValue }) {
  const [params, setParams] = useSearchParams();
  const value = params.get(param) || defaultValue;
  return (
    <div className="flex overflow-x-auto scrollbar-none" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.value} role="tab" aria-selected={value === tb.value} className="tab flex-1"
          onClick={() => setParams((p) => { tb.value === defaultValue ? p.delete(param) : p.set(param, tb.value); return p; }, { replace: true })}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export function UrlPills({ param, options, allLabel = "Усі" }) {
  const [params, setParams] = useSearchParams();
  const value = params.get(param) || "";
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-none px-4 py-2.5">
      {[{ value: "", label: allLabel }, ...options].map((o) => (
        <button key={o.value} className="pill" aria-pressed={value === o.value}
          onClick={() => setParams((p) => { o.value ? p.set(param, o.value) : p.delete(param); return p; }, { replace: true })}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
