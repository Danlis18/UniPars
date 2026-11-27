import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Undo2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { timeAgo } from "../../lib/format.js";
import { Empty, ErrorState, Loading, Modal, useToast } from "../../components/ui.jsx";
import { useSession } from "../../app/session.jsx";

// Оплати й повернення коштів — лише адміністратор платформи (backend перевіряє кожен запит).
const uah = (kop) => `${(kop / 100).toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`;
const KIND = { single: "Разова генерація", topup: "Докупівля", subscription: "Підписка" };
const PROVIDER = { mock: "тестова", monobank: "monobank", jar: "Банка" };
const REFUND_STATUS = { pending: "в обробці", success: "повернено", failure: "відхилено" };
const BLOCKED = {
  not_paid: "Платіж не оплачено.",
  pending: "Повернення вже в обробці.",
  expired: "Минуло понад 14 днів від оплати.",
  used: "Генерації з цієї оплати вже використані.",
  subscription_used: "З підписки вже використано генерації.",
  already_refunded: "За цей платіж уже все повернено.",
};

function RefundDialog({ payment, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["refund-quote", payment.id], queryFn: () => api(`/admin/payments/${payment.id}/refund-quote`) });
  const [n, setN] = useState(null);
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const isSub = payment.kind === "subscription";
  const limit = d ? (force ? d.max_generations : d.refundable_generations) : 0;
  const count = isSub ? d?.max_generations || 0 : Math.min(n ?? limit, limit);
  const amount = d ? (isSub ? d.amount_kop : count * d.unit_kop) : 0;
  const can = d && count > 0 && reason.trim().length >= 3 && (force || !d.blocked);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api(`/admin/payments/${payment.id}/refunds`, {
        method: "POST", body: { generations: isSub ? null : count, reason: reason.trim(), force },
      });
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
      toast(r.status === "success" ? `Повернено ${uah(r.amount_kop)}` : r.status === "pending"
        ? "Повернення в обробці банку — оновіть статус пізніше" : `Банк відхилив: ${r.failure_reason || ""}`,
        r.status === "failure" ? "error" : "success");
      onClose();
    } catch (err) {
      toast(err.message, "error");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Повернення коштів" labelledBy="refund-h">
      <form onSubmit={submit} className="p-4 space-y-4 text-sm">
        <div>
          <div className="font-medium">{payment.user.display_name} · {KIND[payment.kind]}{payment.quantity > 1 ? ` × ${payment.quantity}` : ""}</div>
          <div className="text-muted">Оплачено {uah(payment.amount_kop)} · {timeAgo(payment.created_at)}{payment.refunded_kop ? ` · уже повернено ${uah(payment.refunded_kop)}` : ""}</div>
        </div>
        {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <>
            {d.blocked && <p className="rounded-xl bg-amber-400/10 text-amber-700 dark:text-amber-300 px-3 py-2">{BLOCKED[d.blocked]} {d.blocked !== "not_paid" && d.blocked !== "pending" && d.max_generations > 0 ? "Повернути можна лише примусово." : ""}</p>}
            {isSub ? (
              <p>Підписка повертається лише повністю: {uah(d.amount_kop)}. Підписку буде скасовано, а невикористані генерації — списано.</p>
            ) : (
              <label className="block">
                <span className="block mb-1">Генерацій до повернення (по {uah(d.unit_kop)})</span>
                <input type="number" className="input h-10 w-28" min={1} max={Math.max(limit, 1)} value={count}
                  onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} disabled={limit === 0} aria-label="Кількість генерацій" />
                <span className="block text-xs text-muted mt-1">На балансі студента: {d.balance}. Без примусового режиму — до {d.refundable_generations}.</span>
              </label>
            )}
            <label className="block">
              <span className="block mb-1">Причина</span>
              <input className="input h-10" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
                placeholder="Напр.: запит студента від 24.11, подвійна оплата" />
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>Примусово — подвійна оплата або результат не відповідає опису. Без обмеження 14 днів і використаних генерацій.</span>
            </label>
            <div className="flex items-center justify-between gap-3 pt-1">
              <span>До повернення: <b>{uah(amount)}</b></span>
              <button className="btn-primary" disabled={!can || busy}><Undo2 size={16} /> Повернути</button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

// Надходження на Банку, які не зіставились автоматично (без коду в коментарі або менша сума)
function JarTransfers() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["jar-transfers"], queryFn: () => api("/admin/jar-transfers") });
  const unpaid = useQuery({ queryKey: ["admin-payments", "created"], queryFn: () => api("/admin/payments", { query: { status: "created" } }),
    enabled: Boolean(list.data?.length) });
  const [pick, setPick] = useState({});
  const sync = async () => {
    try {
      const r = await api("/admin/jar-transfers/sync", { method: "POST" });
      toast(r.new ? `Нових надходжень: ${r.new}` : "Виписку перевірено");
      qc.invalidateQueries({ queryKey: ["jar-transfers"] });
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
    } catch (e) { toast(e.message, "error"); }
  };
  const match = async (t) => {
    try {
      await api(`/admin/jar-transfers/${t.id}/match`, { method: "POST", body: { payment_id: pick[t.id] } });
      toast("Оплату зараховано");
      qc.invalidateQueries({ queryKey: ["jar-transfers"] });
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
    } catch (e) { toast(e.message, "error"); }
  };
  const { config } = useSession();
  if (list.isLoading || list.isError) return null;
  if (config?.payment_provider !== "jar" && !list.data.length) return null; // оплата не через Банку — блок не потрібен
  const jarUnpaid = (unpaid.data || []).filter((p) => p.provider === "jar");
  return (
    <section className="card p-4 text-sm space-y-2" aria-label="Надходження на Банку">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base">Надходження на Банку без зіставлення</h2>
        <button className="btn-ghost h-8 px-3" onClick={sync}><RefreshCw size={14} /> Перевірити виписку</button>
      </div>
      {!list.data.length ? <p className="text-muted">Усі надходження зараховано.</p> : (
        <ul className="divide-y divide-line">
          {list.data.map((t) => (
            <li key={t.id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
              <span className="min-w-0"><b>{uah(t.amount_kop)}</b> · {t.counter_name || "відправник"} · {timeAgo(t.received_at)}
                <span className="block text-xs text-muted break-words">Коментар: {t.comment || "—"}</span></span>
              <span className="flex items-center gap-2">
                <select className="input h-9 max-w-[16rem]" value={pick[t.id] || ""} onChange={(e) => setPick({ ...pick, [t.id]: e.target.value })}
                  aria-label="Платіж для зарахування">
                  <option value="">Оберіть платіж…</option>
                  {jarUnpaid.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.user.display_name} · {uah(p.amount_kop)}</option>)}
                </select>
                <button className="btn-primary h-9" disabled={!pick[t.id]} onClick={() => match(t)}>Зарахувати</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PaymentsAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("success");
  const [open, setOpen] = useState(null);
  const list = useQuery({ queryKey: ["admin-payments", status], queryFn: () => api("/admin/payments", { query: { status } }) });

  const refresh = async (refundId) => {
    try {
      const r = await api(`/admin/refunds/${refundId}/refresh`, { method: "POST" });
      toast(`Статус повернення: ${REFUND_STATUS[r.status]}`);
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
    } catch (e) { toast(e.message, "error"); }
  };

  const complete = async (refundId, success) => {
    try {
      const r = await api(`/admin/refunds/${refundId}/complete`, { method: "POST", body: { success } });
      toast(`Повернення: ${REFUND_STATUS[r.status]}`);
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <div className="p-4 space-y-3">
      <JarTransfers />
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Показати:</span>
        {[["success", "Оплачені"], ["all", "Усі"]].map(([v, l]) => (
          <button key={l} className={status === v ? "btn-primary h-8 px-3" : "btn-ghost h-8 px-3"} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data.length ? (
        <Empty title="Оплат ще немає" />
      ) : (
        <ul className="card divide-y divide-line">
          {list.data.map((p) => (
            <li key={p.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium">{p.user.display_name}</span>
                  <span className="block text-xs text-muted">{KIND[p.kind]}{p.quantity > 1 ? ` × ${p.quantity}` : ""} · {timeAgo(p.created_at)} · {PROVIDER[p.provider] || p.provider}{p.code ? ` · ${p.code}` : ""}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-right"><b>{uah(p.amount_kop)}</b>{p.refunded_kop > 0 && <span className="block text-xs text-muted">повернено {uah(p.refunded_kop)}</span>}</span>
                  {p.status === "success" && <button className="btn-ghost h-9" onClick={() => setOpen(p)} aria-label={`Повернути кошти: ${p.user.display_name}`}><Undo2 size={15} /> Повернути</button>}
                </span>
              </div>
              {p.refunds.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {p.refunds.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className={r.status === "success" ? "text-primary" : r.status === "failure" ? "text-danger" : ""}>
                        {uah(r.amount_kop)} — {REFUND_STATUS[r.status]}{r.forced ? " (примусово)" : ""}</span>
                      <span>· {r.reason}{r.failure_reason ? ` · ${r.failure_reason}` : ""} · {timeAgo(r.created_at)}</span>
                      {r.status === "pending" && p.provider === "jar" ? (
                        <>
                          <button className="btn-quiet h-7 px-2" onClick={() => complete(r.id, true)}>Гроші переказано</button>
                          <button className="btn-quiet h-7 px-2" onClick={() => complete(r.id, false)}>Скасувати</button>
                        </>
                      ) : r.status === "pending" && <button className="btn-quiet h-7 px-2" onClick={() => refresh(r.id)}><RefreshCw size={13} /> Оновити</button>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && <RefundDialog payment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
