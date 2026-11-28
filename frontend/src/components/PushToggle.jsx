import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useSession } from "../app/session.jsx";
import { useToast } from "./ui.jsx";
import { currentSubscription, disablePush, enablePush, needsHomeScreen, pushSupported } from "../lib/push.js";

// Push-сповіщення в браузері: нагадування про кінець підписки й інші важливі події, навіть коли сайт закритий.
// compact — коротка підказка (картка підписки); інакше — рядок налаштування (сторінка «Сповіщення»).
export default function PushToggle({ compact = false }) {
  const { config } = useSession();
  const toast = useToast();
  const [on, setOn] = useState(null); // null — ще перевіряємо
  const [busy, setBusy] = useState(false);
  const key = config?.vapid_public_key;

  useEffect(() => {
    let alive = true;
    if (!key || !pushSupported()) { setOn(false); return undefined; }
    currentSubscription().then((s) => alive && setOn(Boolean(s))).catch(() => alive && setOn(false));
    return () => { alive = false; };
  }, [key]);

  if (!key || on === null) return null;
  if (compact && on) return null;
  const unsupported = !pushSupported();
  const ios = needsHomeScreen();
  const denied = !unsupported && Notification.permission === "denied";

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) { await disablePush(); setOn(false); toast("Push-сповіщення вимкнено"); }
      else { await enablePush(key); setOn(true); toast("Push-сповіщення увімкнено"); }
    } catch (e) {
      toast(e.message || "Не вдалося змінити налаштування", "error");
    } finally {
      setBusy(false);
    }
  };

  const hint = ios ? "На iPhone: Поділитися → «На початковий екран», потім відкрийте UniPars з екрана й увімкніть тут."
    : unsupported ? "Цей браузер не підтримує push-сповіщення."
      : denied ? "Сповіщення заборонені для цього сайту — дозвольте їх у налаштуваннях браузера."
        : compact ? "Нагадаємо за 3 дні до кінця підписки, навіть коли сайт закритий."
          : "Нагадування про кінець підписки та важливі події — навіть коли UniPars закритий.";
  const canToggle = !ios && !unsupported && !denied;

  return (
    <div className={compact ? "rounded-xl bg-sunken/60 p-3 mt-3 text-xs flex items-start gap-2" : "card m-4 p-4 flex items-start gap-3"}>
      <BellRing size={compact ? 16 : 20} className="text-primary shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className={compact ? "font-semibold" : "font-semibold text-sm"}>Push-сповіщення{on ? " увімкнено" : ""}</div>
        <div className="text-muted">{hint}</div>
      </div>
      {canToggle && (
        <button className={on ? "btn-ghost h-8 px-3 shrink-0" : "btn-primary h-8 px-3 shrink-0"} disabled={busy} onClick={toggle}>
          {on ? "Вимкнути" : "Увімкнути"}
        </button>
      )}
    </div>
  );
}
