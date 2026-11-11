import { useId } from "react";

// Логотип UniPars: «U» з петлею-зв'язком і вузлом мережі (обмін знаннями).
export const LOGO_PATH =
  "M24 33V17a6 6 0 0 0-12 0v17a20 20 0 0 0 40 0V19a6.5 6.5 0 0 0-13 0v12c0 5-3.5 8.5-7 8.5S24 37 24 33z";

export function LogoMark({ size = 36, className = "" }) {
  // Унікальний id: градієнт у прихованому (display:none) екземплярі не рендериться в інших
  const id = "up-g" + useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2fe0c4" />
          <stop offset="1" stopColor="#0f8f86" />
        </linearGradient>
      </defs>
      <path d={LOGO_PATH} fill="none" stroke={`url(#${id})`} strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="39.5" r="4" fill="#0f8f86" />
    </svg>
  );
}

export function Logo({ compact = false }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={34} />
      {!compact && <span className="font-display font-semibold text-xl tracking-tight">UniPars</span>}
    </span>
  );
}
