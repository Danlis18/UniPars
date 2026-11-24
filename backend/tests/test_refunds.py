"""Повернення коштів через API: лише адміністратор платформи; тестова оплата й monobank (банк підмінено)."""
from conftest import ANDRII, MAKSYM, OLENA, as_user, did

from app.services import billing

TARAS = did("user:taras")  # адміністратор платформи в демо


def pay(client, user, kind="single", quantity=1):
    p = client.post("/api/billing/checkout", headers=as_user(user), json={"kind": kind, "quantity": quantity}).json()
    return client.post(f"/api/billing/mock/{p['id']}", headers=as_user(user), json={"success": True}).json()


def test_only_platform_admin_sees_payments_and_refunds(client):
    p = pay(client, OLENA)
    for who in (OLENA, ANDRII):  # студент і адміністратор університету
        assert client.get("/api/admin/payments", headers=as_user(who)).status_code == 403
        r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(who), json={"generations": 1, "reason": "тест"})
        assert r.status_code == 403
    rows = client.get("/api/admin/payments", headers=as_user(TARAS)).json()
    assert any(x["id"] == p["id"] and x["user"]["display_name"] == "Олена Коваль" for x in rows)


def test_mock_refund_flow_with_quote_history_and_notification(client):
    p = pay(client, OLENA, "single", 3)
    q = client.get(f"/api/admin/payments/{p['id']}/refund-quote", headers=as_user(TARAS)).json()
    assert q["refundable_generations"] == 3 and q["blocked"] is None
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS), json={"generations": 2, "reason": "запит студента"})
    assert r.status_code == 201 and r.json()["status"] == "success" and r.json()["amount_kop"] == 9400
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 1
    hist = client.get("/api/billing/history", headers=as_user(OLENA)).json()["payments"]
    assert next(x for x in hist if x["id"] == p["id"])["refunded_kop"] == 9400
    notes = client.get("/api/notifications", headers=as_user(OLENA)).json()
    items = notes["items"] if isinstance(notes, dict) else notes
    assert any(n["title"] == "Кошти повернено" for n in items)
    # більше, ніж лишилось на балансі, — лише примусово
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS), json={"generations": 1, "reason": "ще раз"})
    assert r.status_code == 201  # одна генерація ще є
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS), json={"generations": 1, "reason": "ще раз"})
    assert r.status_code == 422  # більше нічого повертати


def test_used_generations_need_force(client):
    p = pay(client, MAKSYM, "single", 1)
    client.post(f"/api/submissions/{did('sub:db-lab1-iryna')}/regenerate", headers=as_user(MAKSYM), json={})
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS), json={"generations": 1, "reason": "не сподобалось"})
    assert r.status_code == 409 and "примусово" in r.json()["detail"]
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS),
                    json={"generations": 1, "reason": "подвійна оплата", "force": True})
    assert r.status_code == 201 and r.json()["forced"] is True and r.json()["credits_removed"] == 0


class FakeMono:
    def __init__(self, cancel="processing", status=None, reject=False):
        self.cancel, self.status, self.reject, self.calls = cancel, status, reject, []

    def cancel_invoice(self, **kw):
        from app.integrations.payments.monobank import MonobankRejected

        self.calls.append(kw)
        if self.reject:
            raise MonobankRejected("monobank: 400 invoice not refundable")
        return self.cancel

    def cancel_status(self, invoice_id, ext_ref):
        return self.status


def _as_monobank(client, monkeypatch, fake):
    p = pay(client, OLENA, "single", 2)
    from app.core.deps import get_store

    get_store().update("payments", {"id": p["id"]}, {"provider": "monobank", "invoice_id": "inv-77"})
    monkeypatch.setattr(billing, "_monobank", lambda: fake)
    return p


def test_monobank_refund_processing_then_refreshed(client, monkeypatch):
    fake = FakeMono(cancel="processing")
    p = _as_monobank(client, monkeypatch, fake)
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS), json={"generations": 2, "reason": "запит"}).json()
    assert r["status"] == "pending" and fake.calls == [{"invoice_id": "inv-77", "amount_kop": 9400, "ext_ref": r["id"]}]
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 0
    fake.status = "success"
    assert client.post(f"/api/admin/refunds/{r['id']}/refresh", headers=as_user(TARAS)).json()["status"] == "success"


def test_monobank_rejection_restores_balance(client, monkeypatch):
    p = _as_monobank(client, monkeypatch, FakeMono(reject=True))
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS), json={"generations": 2, "reason": "запит"}).json()
    assert r["status"] == "failure" and "відхилив" in r["failure_reason"]
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 2
