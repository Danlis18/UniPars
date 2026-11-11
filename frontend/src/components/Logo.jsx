import { useId } from "react";

// Логотип UniPars: «U» з петлею-зв'язком і вузлом мережі (обмін знаннями).
export const LOGO_PATH =
  "M24 33V17a6 6 0 0 0-12 0v17a20 20 0 0 0 40 0V19a6.5 6.5 0 0 0-13 0v12c0 5-3.5 8.5-7 8.5S24 37 24 33z";

// Фірмовий градієнт: бірюза → смарагд → лайм
export const BRAND_STOPS = [
  ["0", "#5ff5dc"],
  ["0.45", "#14c4a8"],
  ["1", "#a3e635"],
];

export function LogoMark({ size = 36, className = "", animated = true }) {
  // Унікальний id: градієнт у прихованому (display:none) екземплярі не рендериться в інших
  const id = "up-g" + useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`logo-mark ${animated ? "logo-anim" : ""} ${className}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {BRAND_STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
        <radialGradient id={id + "n"} cx="0.35" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.35" stopColor="#2fe0c4" />
          <stop offset="1" stopColor="#0b8f7f" />
        </radialGradient>
      </defs>
      <path d={LOGO_PATH} fill="none" stroke="#0b5f55" strokeOpacity="0.18" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" transform="translate(0.8 1.4)" />
      <path className="logo-stroke" d={LOGO_PATH} pathLength="1" fill="none" stroke={`url(#${id})`} strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="logo-halo" cx="32" cy="39.5" r="6.5" fill="none" stroke="#2fe0c4" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="32" cy="39.5" r="4.2" fill={`url(#${id}n)`} />
    </svg>
  );
}

export function Logo({ compact = false, onDark = false }) {
  return (
    <span className="group flex items-center gap-2">
      <LogoMark size={36} />
      {!compact && (
        <span className="font-display font-semibold text-xl tracking-tight">
          Uni<span className={onDark ? "text-brand-light" : "text-brand"}>Pars</span>
        </span>
      )}
    </span>
  );
}
