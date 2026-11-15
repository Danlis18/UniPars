import { KeyRound, Lock, Sparkles } from "lucide-react";
import { useSession } from "../../app/session.jsx";

// AI ще не запущено: показуємо інтерфейс під «матовим склом» із замком і SOON.
// Логіка AI лишається в коді — щойно на сервері з'явиться ключ провайдера
// (config.ai_enabled = true), заглушка зникне сама.
export function useAIEnabled() {
  const { config } = useSession();
  return Boolean(config?.ai_enabled);
}

export function SoonChip({ className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-extrabold tracking-wider text-[#0b2a1f] ${className}`}
      style={{ background: "linear-gradient(120deg,#2fe0c4,#bef248)" }}>
      SOON
    </span>
  );
}

export default function AIComingSoon({ children }) {
  return (
    <div className="relative h-full">
      {/* Сам інтерфейс AI — видно силует, але взаємодіяти не можна */}
      <div aria-hidden inert="" className="h-full pointer-events-none select-none blur-[6px] opacity-60 saturate-50">
        {children}
      </div>
      <div className="absolute inset-0 grid place-items-center p-6 bg-bg/30 backdrop-blur-[2px]">
        <section className="glass rounded-[32px] px-8 py-9 max-w-md w-full text-center page-in" aria-labelledby="ai-soon-title">
          <div className="relative mx-auto mb-5 w-20 h-20">
            <div className="absolute inset-0 rounded-[26px] blur-xl opacity-70" style={{ background: "linear-gradient(135deg,#2fe0c4,#bef248)" }} />
            <div className="relative w-20 h-20 rounded-[26px] grid place-items-center text-[#0b2a1f] shadow-xl" style={{ background: "linear-gradient(135deg,#2fe0c4,#bef248)" }}>
              <KeyRound size={34} strokeWidth={2.2} />
            </div>
            <span className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-[#0f2a20] text-[#bef248] grid place-items-center ring-4 ring-bg">
              <Lock size={14} strokeWidth={2.6} />
            </span>
          </div>
          <h1 id="ai-soon-title" className="font-display text-5xl font-bold tracking-tight text-brand">SOON</h1>
          <p className="mt-3 text-[15px] text-ink/90">
            <b>AI-помічник UniPars</b> уже в розробці: пояснення тем, розбір задач покроково, перевірка розв'язань і коду.
          </p>
          <ul className="mt-5 grid grid-cols-2 gap-2 text-left text-xs text-muted">
            {["Пояснить тему простими словами", "Розбере задачу покроково", "Знайде помилку в коді", "Підготує до захисту лаби"].map((t) => (
              <li key={t} className="flex items-start gap-1.5"><Sparkles size={13} className="text-teal mt-0.5 shrink-0" /> {t}</li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-muted">Ми повідомимо в сповіщеннях, щойно AI відкриється.</p>
        </section>
      </div>
    </div>
  );
}
