import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api } from "../../lib/api.js";

// Обкладинки профілю — лише з бібліотеки UniPars (фото Pexels, у public/covers).
export const coverUrl = (key, thumb = false) => (key ? `/covers/${key}${thumb ? "-thumb" : ""}.webp` : null);

export function ProfileCover({ cover }) {
  return (
    <div className="relative h-36 sm:h-44 overflow-hidden bg-[radial-gradient(120%_120%_at_0%_0%,rgb(var(--teal))_0%,rgb(var(--primary))_45%,rgb(var(--lime))_120%)]">
      {cover ? (
        <>
          <img src={coverUrl(cover)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" decoding="async" />
          {/* легке затемнення знизу — аватар і текст читаються на будь-якому фото */}
          <div aria-hidden className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/35 via-transparent to-transparent" />
        </>
      ) : (
        <div aria-hidden className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_20%_30%,white_1px,transparent_1.5px)] [background-size:22px_22px]" />
      )}
    </div>
  );
}

export function CoverPicker({ value, onChange }) {
  const q = useQuery({ queryKey: ["covers"], queryFn: () => api("/covers"), staleTime: Infinity });
  const themes = [...new Set((q.data || []).map((c) => c.theme))];
  return (
    <div>
      <div className="label">Обкладинка профілю</div>
      <div className="max-h-[280px] overflow-y-auto pr-1 -mr-1 space-y-3" role="radiogroup" aria-label="Обкладинка профілю">
        <button type="button" role="radio" aria-checked={!value} onClick={() => onChange("")}
          className={`relative w-full h-12 rounded-xl overflow-hidden text-xs font-semibold text-white ring-2 transition ${!value ? "ring-teal" : "ring-transparent hover:ring-line"} bg-[radial-gradient(120%_120%_at_0%_0%,rgb(var(--teal))_0%,rgb(var(--primary))_45%,rgb(var(--lime))_120%)]`}>
          Фірмовий градієнт {!value && <Check size={14} className="inline ml-1" />}
        </button>
        {themes.map((theme) => (
          <div key={theme}>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">{theme}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {q.data.filter((c) => c.theme === theme).map((c) => (
                <button type="button" key={c.key} role="radio" aria-checked={value === c.key} aria-label={c.name} title={c.name}
                  onClick={() => onChange(c.key)}
                  className={`relative h-14 rounded-xl overflow-hidden ring-2 transition ${value === c.key ? "ring-teal scale-[0.97]" : "ring-transparent hover:ring-line"}`}>
                  <img src={coverUrl(c.key, true)} alt="" loading="lazy" className="w-full h-full object-cover" />
                  {value === c.key && <span className="absolute inset-0 grid place-items-center bg-black/30 text-white"><Check size={18} /></span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-1.5">Фото: Pexels. Власні фото для обкладинки поки недоступні.</p>
    </div>
  );
}
