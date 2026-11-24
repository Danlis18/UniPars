import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Crown, Loader2, Lock, RefreshCw, Wand2, XCircle } from "lucide-react";
import { api } from "../../lib/api.js";
import { local } from "../../lib/storage.js";
import { timeAgo } from "../../lib/format.js";
import { Empty, ErrorState, Loading, Modal, useToast } from "../../components/ui.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { taskFullTitle } from "../tasks/shared.jsx";

const uah = (kop) => `${(kop / 100).toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`;
const INTENT = "unipars.regenerateIntent"; // що згенерувати після оплати

// Один рядок згоди біля кнопок оплати — з посиланням на оферту
export function PayConsent({ className = "" }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      Оплачуючи, ви погоджуєтеся з умовами <Link to="/offer" target="_blank" className="text-primary hover:underline">публічної оферти</Link>.
    </p>
  );
}

export function useBilling() {
  return useQuery({ queryKey: ["billing"], queryFn: () => api("/billing"), staleTime: 15_000 });
}

// Перехід на оплату: тестова сторінка — всередині сайту, monobank — на сторінку банку
export function useCheckout() {
  const nav = useNavigate();
  const toast = useToast();
  return async (kind, quantity = 1) => {
    try {
      const p = await api("/billing/checkout", { method: "POST", body: { kind, quantity } });
      if (p.page_url.startsWith("/")) nav(p.page_url);
      else window.location.assign(p.page_url);
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

async function startRegeneration(submissionId, options) {
  return api(`/submissions/${submissionId}/regenerate`, { method: "POST", body: options });
}

// ---------- «Регенерувати звіт» ----------

export function RegenerateDialog({ example, task, open, onClose }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const checkout = useCheckout();
  const billing = useBilling();
  const [busy, setBusy] = useState(false);
  const any = true;
  const b = billing.data;
  const options = {};

  const run = async () => {
    setBusy(true);
    try {
      const r = await startRegeneration(example.id, options);
      qc.invalidateQueries({ queryKey: ["billing"] });
      nav(`/regenerations/${r.id}`);
    } catch (e) {
      toast(e.message, "error");
      setBusy(false);
    }
  };
  const buy = (kind) => {
    local.set(INTENT, { submissionId: example.id, options, back: `/tasks/${task.id}` });
    checkout(kind);
  };

  return (
    <Modal open={open} onClose={onClose} title="Регенерувати звіт" labelledBy="regen-h" wide>
      <div className="p-4 sm:p-5 space-y-5">
        <div className="rounded-2xl bg-primary/10 p-4 text-sm leading-relaxed">
          <div className="flex items-center gap-2 font-semibold mb-2"><Wand2 size={16} className="text-primary" aria-hidden /> Що буде зроблено</div>
          <ul className="space-y-1.5">
            <li>✓ <b>Нова стилізація</b> — щоразу інша: виділення ключових термінів жирним, курсивом чи підкресленням і стиль підзаголовків.</li>
            <li>✓ <b>Висновки</b> — ті самі думки іншими словами.</li>
            <li>✓ <b>Без змін:</b> підзаголовки, теорія, хід роботи, скріни, схеми, код і результати.</li>
            <li>✓ Times New Roman 14. Лише для перегляду вами на сайті, з позначкою «Приклад оформлення».</li>
          </ul>
          <div className="mt-2 text-xs text-muted break-words">Основа: {example.file_name} · {taskFullTitle(task)}</div>
        </div>

        {billing.isLoading ? <Loading /> : b && b.available > 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between rounded-2xl border border-line p-4">
            <div className="text-sm">Доступно генерацій: <b>{b.available}</b>{b.subscription && <span className="text-muted"> · підписка до {new Date(b.subscription.period_end).toLocaleDateString("uk-UA")}</span>}</div>
            <button className="btn-primary" disabled={!any || busy} onClick={run}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Регенерувати · 1 генерація</button>
          </div>
        ) : b ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line p-4 flex flex-col">
              <div className="text-sm text-muted">Одна генерація</div>
              <div className="font-display text-2xl my-1">{uah(b.prices.single_kop)}</div>
              <p className="text-xs text-muted flex-1">Разова покупка, без терміну дії.</p>
              <button className="btn-primary mt-3" disabled={!any} onClick={() => buy("single")}><CreditCard size={16} /> Купити</button>
            </div>
            <div className="rounded-2xl border border-primary/60 bg-primary/5 p-4 flex flex-col">
              <div className="text-sm text-primary font-semibold flex items-center gap-1.5"><Crown size={15} aria-hidden /> Підписка на місяць</div>
              <div className="font-display text-2xl my-1">{uah(b.prices.subscription_kop)}</div>
              <p className="text-xs text-muted flex-1">{b.prices.subscription_credits} генерацій на 30 днів, далі — по {uah(b.prices.topup_kop)} за кожну.</p>
              <button className="btn-accent mt-3" disabled={!any} onClick={() => buy("subscription")}><Crown size={16} /> Оформити</button>
            </div>
          </div>
        ) : <ErrorState error={billing.error} onRetry={billing.refetch} />}
        {b && !(b.available > 0) && <PayConsent className="text-center" />}
        {b?.prices.provider === "mock" && <p className="text-xs text-muted text-center">Тестовий режим оплати: гроші не списуються.</p>}
      </div>
    </Modal>
  );
}

// ---------- Тестова сторінка оплати (PAYMENT_PROVIDER=mock) ----------
export function MockCheckoutPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const p = useQuery({ queryKey: ["payment", id], queryFn: () => api(`/billing/payments/${id}`) });
  const finish = async (success) => {
    setBusy(true);
    try {
      await api(`/billing/mock/${id}`, { method: "POST", body: { success } });
      nav(`/billing/return/${id}`, { replace: true });
    } catch (e) { toast(e.message, "error"); setBusy(false); }
  };
  if (p.isLoading) return <Loading />;
  if (p.isError) return <ErrorState error={p.error} onRetry={p.refetch} />;
  const x = p.data;
  return (
    <>
      <PageHeader back title="Оплата" subtitle="Тестовий режим" />
      <div className="p-4 max-w-md mx-auto">
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between"><span className="font-display text-lg">UniPars</span><span className="chip bg-amber-400/15 text-amber-600 dark:text-amber-300">Тестова оплата</span></div>
          <div><div className="text-sm text-muted">{x.label}{x.quantity > 1 ? ` × ${x.quantity}` : ""}</div><div className="font-display text-4xl mt-1">{uah(x.amount_kop)}</div></div>
          <p className="text-xs text-muted">Це імітація сторінки банку для перевірки й демонстрації. Реальні гроші не списуються. На продакшні тут відкривається сторінка оплати monobank.</p>
          {x.status === "created" ? (
            <div className="flex flex-col gap-2">
              <button className="btn-primary h-12" disabled={busy} onClick={() => finish(true)}><Lock size={16} /> Оплатити {uah(x.amount_kop)}</button>
              <button className="btn-ghost" disabled={busy} onClick={() => finish(false)}>Скасувати</button>
            </div>
          ) : <Link to={`/billing/return/${id}`} className="btn-primary">Продовжити</Link>}
        </div>
      </div>
    </>
  );
}

// ---------- Повернення після оплати ----------
export function PaymentReturnPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [startError, setStartError] = useState(null);
  const p = useQuery({
    queryKey: ["payment", id], queryFn: () => api(`/billing/payments/${id}`),
    refetchInterval: (q) => (["success", "failure", "expired"].includes(q.state.data?.status) ? false : 2000),
  });
  const status = p.data?.status;
  useEffect(() => {
    if (status !== "success") return;
    qc.invalidateQueries({ queryKey: ["billing"] });
    const intent = local.get(INTENT);
    if (!intent) return;
    local.remove(INTENT);
    startRegeneration(intent.submissionId, intent.options)
      .then((r) => nav(`/regenerations/${r.id}`, { replace: true }))
      .catch((e) => setStartError(e.message));
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p.isLoading) return <Loading />;
  if (p.isError) return <ErrorState error={p.error} onRetry={p.refetch} />;
  return (
    <>
      <PageHeader title="Оплата" />
      <div className="p-6 max-w-md mx-auto text-center space-y-3">
        {status === "success" ? (
          <><CheckCircle2 size={44} className="mx-auto text-primary" aria-hidden /><h2 className="font-display text-xl">Оплату зараховано</h2>
            <p className="text-sm text-muted">{p.data.label} · {uah(p.data.amount_kop)}</p>
            {startError ? <p className="text-sm text-danger">{startError}</p> : local.get(INTENT) ? <p className="text-sm text-muted">Запускаємо генерацію…</p> : null}
            <Link to="/billing" className="btn-primary">До моїх генерацій</Link></>
        ) : ["failure", "expired"].includes(status) ? (
          <><XCircle size={44} className="mx-auto text-danger" aria-hidden /><h2 className="font-display text-xl">Оплата не пройшла</h2>
            <p className="text-sm text-muted">{p.data.failure_reason || "Кошти не списано."}</p>
            <Link to="/billing" className="btn-ghost">Спробувати ще раз</Link></>
        ) : (
          <><Loader2 size={40} className="mx-auto animate-spin text-primary" aria-hidden /><h2 className="font-display text-xl">Чекаємо підтвердження банку…</h2>
            <p className="text-sm text-muted">Зазвичай це кілька секунд.</p></>
        )}
      </div>
    </>
  );
}

// ---------- Кабінет: баланс, підписка, історія ----------
export function BillingPage() {
  const billing = useBilling();
  const checkout = useCheckout();
  const [qty, setQty] = useState(5);
  const hist = useQuery({ queryKey: ["billing-history"], queryFn: () => api("/billing/history") });
  const regs = useQuery({ queryKey: ["regenerations"], queryFn: () => api("/regenerations") });
  if (billing.isLoading) return <Loading />;
  if (billing.isError) return <ErrorState error={billing.error} onRetry={billing.refetch} />;
  const b = billing.data;
  return (
    <>
      <PageHeader title="Генерації" subtitle="Баланс, підписка та ваші регенеровані звіти" />
      <div className="p-4 space-y-4">
        <section className="grid sm:grid-cols-2 gap-3">
          <div className="card p-4">
            <div className="text-sm text-muted">Доступно генерацій</div>
            <div className="font-display text-4xl mt-1">{b.available}</div>
            <div className="text-xs text-muted mt-1">Разових: {b.credits}{b.subscription ? ` · з підписки: ${b.subscription.credits_left}` : ""}</div>
            <button className="btn-ghost mt-3" onClick={() => checkout("single")}><CreditCard size={16} /> Купити 1 за {uah(b.prices.single_kop)}</button>
          </div>
          <div className="card p-4 border-primary/50">
            <div className="text-sm text-primary font-semibold flex items-center gap-1.5"><Crown size={15} aria-hidden /> Підписка</div>
            {b.subscription ? (
              <>
                <div className="mt-1">Активна до <b>{new Date(b.subscription.period_end).toLocaleDateString("uk-UA")}</b></div>
                <div className="text-xs text-muted">Лишилось {b.subscription.credits_left} з {b.subscription.credits_included}</div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <input type="number" min={1} max={50} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} className="input h-9 w-20" aria-label="Кількість генерацій" />
                  <button className="btn-primary h-9" onClick={() => checkout("topup", qty)}>Докупити за {uah(b.prices.topup_kop * qty)}</button>
                </div>
                <button className="btn-quiet h-8 px-2 mt-2 text-xs" onClick={() => checkout("subscription")}>Продовжити ще на 30 днів · {uah(b.prices.subscription_kop)}</button>
              </>
            ) : (
              <>
                <div className="font-display text-2xl mt-1">{uah(b.prices.subscription_kop)} <span className="text-sm text-muted font-sans">/ 30 днів</span></div>
                <p className="text-xs text-muted">{b.prices.subscription_credits} генерацій, далі — по {uah(b.prices.topup_kop)}.</p>
                <button className="btn-accent mt-3" onClick={() => checkout("subscription")}><Crown size={16} /> Оформити підписку</button>
              </>
            )}
          </div>
        </section>
        <PayConsent />
        {b.prices.provider === "mock" && <p className="text-xs text-muted">Тестовий режим оплати: гроші не списуються.</p>}

        <section className="card overflow-hidden">
          <h2 className="font-display text-base px-4 pt-3 pb-2">Мої регенеровані звіти</h2>
          {regs.data?.length ? (
            <ul className="divide-y divide-line">
              {regs.data.map((r) => (
                <li key={r.id}><Link to={`/regenerations/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-sunken/60">
                  <span className="min-w-0"><span className="block text-sm font-medium break-words">{r.task?.title ? taskFullTitle(r.task) : "Звіт"}</span>
                    <span className="block text-xs text-muted">{timeAgo(r.created_at)}</span></span>
                  <span className={`chip shrink-0 ${r.status === "done" ? "bg-primary/15 text-primary" : r.status === "failed" ? "bg-danger/15 text-danger" : "bg-sunken text-muted"}`}>
                    {{ done: "Готово", failed: "Помилка", running: "Генерується" }[r.status]}</span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="px-4 pb-4 text-sm text-muted">Відкрийте затверджений приклад біля завдання й натисніть «Регенерувати».</p>}
        </section>

        <section className="card overflow-hidden">
          <h2 className="font-display text-base px-4 pt-3 pb-2">Історія оплат</h2>
          {hist.data?.payments?.length ? (
            <ul className="divide-y divide-line text-sm">
              {hist.data.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0"><span className="block truncate">{p.label}{p.quantity > 1 ? ` × ${p.quantity}` : ""}</span>
                    <span className="block text-xs text-muted">{timeAgo(p.created_at)}</span></span>
                  <span className="text-right shrink-0"><span className="block font-medium">{uah(p.amount_kop)}</span>
                    <span className={`text-xs ${p.status === "success" ? "text-primary" : p.status === "failure" ? "text-danger" : "text-muted"}`}>
                      {{ success: "Оплачено", failure: "Не пройшла", expired: "Прострочено", created: "Очікує", processing: "Обробляється" }[p.status]}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 pb-4 text-sm text-muted">Оплат ще не було.</p>}
        </section>
      </div>
    </>
  );
}

// ---------- Перегляд регенерованого звіту (лише на сайті) ----------
function Inline({ text }) {
  // **жирний**, *курсив*, __підкреслення__
  const parts = useMemo(() => text.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g).filter(Boolean), [text]);
  return parts.map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
      : p.startsWith("__") ? <u key={i}>{p.slice(2, -2)}</u>
      : p.startsWith("*") ? <i key={i}>{p.slice(1, -1)}</i> : <span key={i}>{p}</span>);
}

const HEADING_CLASS = { "bold-caps": "uppercase tracking-wide", "bold-underline": "underline underline-offset-4", "bold-italic": "italic" };

const WATERMARK = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'><text x='20' y='150' transform='rotate(-24 210 130)' font-family='Arial' font-size='20' fill='rgba(15,90,70,0.10)'>Приклад оформлення · UniPars</text></svg>")}")`;

export function RegenerationPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["regeneration", id], queryFn: () => api(`/regenerations/${id}`),
    refetchInterval: (s) => (s.state.data?.status === "running" ? 2500 : false),
  });
  const block = (e) => e.preventDefault();
  // спільне для аркушів: Times New Roman 14, водяний знак, без виділення й копіювання
  const sheet = {
    className: "no-print-doc mx-auto max-w-[210mm] bg-white text-black shadow-xl rounded-sm px-6 sm:px-[20mm] py-8 sm:py-[18mm] select-none",
    style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "14pt", lineHeight: 1.5, backgroundImage: WATERMARK },
    onCopy: block, onCut: block, onContextMenu: block, onDragStart: block,
  };
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data;
  return (
    <>
      <style>{"@media print { .no-print-doc { display: none !important } }"}</style>
      <PageHeader back title="Регенерований звіт" subtitle={r.task?.title ? taskFullTitle(r.task) : undefined}
        actions={r.status === "done" && <button className="btn-ghost h-9" onClick={() => q.refetch()} aria-label="Оновити рисунки"><RefreshCw size={15} /></button>} />
      {r.status === "running" ? (
        <div className="p-10 text-center"><Loader2 size={40} className="mx-auto animate-spin text-primary" aria-hidden />
          <h2 className="font-display text-xl mt-3">Генеруємо приклад оформлення…</h2><p className="text-sm text-muted">Зазвичай до хвилини. Сторінка оновиться сама.</p></div>
      ) : r.status === "failed" ? (
        <Empty title="Не вдалося згенерувати" icon={XCircle}>{r.error || "Генерацію повернуто на ваш баланс."}</Empty>
      ) : (
        <div className="p-3 sm:p-6 bg-sunken min-h-full">
          <p className="text-xs text-muted text-center mb-3">Лише перегляд: приклад іншого оформлення затвердженого звіту. Збереження й копіювання недоступні.</p>
          {r.result.title_page && (
            // Титулка — окремий аркуш, розкладка як в оригіналі
            <article {...sheet} aria-label="Титульна сторінка"
              className={`${sheet.className} mb-6 flex flex-col justify-between min-h-[160mm] sm:min-h-[257mm]`}>
              <div className="text-center font-bold">{r.result.title_page.top.map((l, i) => <div key={i}>{l}</div>)}</div>
              <div className="text-center">
                {r.result.title_page.center.map((l, i) => <div key={i} className={i === 0 ? "font-bold text-[16pt]" : /^«.*»$/.test(l) ? "font-bold" : ""}>{l}</div>)}
              </div>
              <div className="self-end text-right">{r.result.title_page.right.map((l, i) => <div key={i}>{l}</div>)}</div>
              <div className="text-center font-bold">{r.result.title_page.bottom.map((l, i) => <div key={i}>{l}</div>)}</div>
            </article>
          )}
          <article {...sheet} aria-label="Регенерований звіт">
            {!r.result.title_page && r.result.title && <h1 className="text-center font-bold mb-4" style={{ fontSize: "14pt" }}>{r.result.title}</h1>}
            {r.result.sections.map((s, i) => (
              <section key={i} className="mb-3">
                {s.heading && <h2 className={`font-bold mt-3 mb-1 ${HEADING_CLASS[r.result.heading_style] || ""}`} style={{ fontSize: "14pt" }}><Inline text={s.heading} /></h2>}
                {s.blocks.map((bl, j) =>
                  bl.type === "paragraph" ? <p key={j} className="mb-2 text-justify indent-[1.25cm]"><Inline text={bl.text} /></p>
                  : bl.type === "list" ? (bl.ordered ? <ol key={j} start={bl.start || 1} className="list-decimal pl-[1.25cm] mb-2">{bl.items.map((it, k) => <li key={k}><Inline text={it} /></li>)}</ol>
                    : <ul key={j} className="list-disc pl-[1.25cm] mb-2">{bl.items.map((it, k) => <li key={k}><Inline text={it} /></li>)}</ul>)
                  : bl.type === "code" ? <pre key={j} className="mb-2 p-3 bg-neutral-100 text-[11pt] whitespace-pre-wrap" style={{ fontFamily: "Consolas, monospace" }}>{bl.text}</pre>
                  : bl.type === "table" ? (
                    <table key={j} className="w-full mb-2 border-collapse text-[12pt]"><tbody>{bl.rows.map((row, k) => (
                      <tr key={k}>{row.map((c, m) => <td key={m} className="border border-black px-2 py-1"><Inline text={String(c)} /></td>)}</tr>))}</tbody></table>)
                  : bl.type === "figure" ? (
                    <figure key={j} className="my-3 text-center">
                      {r.result.figure_urls?.[bl.n - 1]
                        ? <img src={r.result.figure_urls[bl.n - 1]} alt="" className="mx-auto max-h-[110mm] pointer-events-none" draggable={false} />
                        : <div className="mx-auto h-24 border border-dashed border-neutral-400" aria-hidden />}
                    </figure>)
                  : null)}
              </section>
            ))}
          </article>
        </div>
      )}
    </>
  );
}
