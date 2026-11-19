"""Оплата (тестовий провайдер), підписка, докупівля, списання й регенерація лише для перегляду."""
from conftest import MAKSYM, OLENA, SOFIIA, UNI_A, as_user, did

SUB = did("sub:db-lab1-iryna")  # затверджений PDF-приклад
OPTS = {"rewrite": {"theory": True, "conclusions": True}, "emphasis": {"bold": True}}


def pay(client, user, kind, quantity=1, success=True):
    p = client.post("/api/billing/checkout", headers=as_user(user), json={"kind": kind, "quantity": quantity}).json()
    assert p["page_url"] == f"/billing/checkout/{p['id']}" and p["status"] == "created"
    return client.post(f"/api/billing/mock/{p['id']}", headers=as_user(user), json={"success": success}).json()


def test_prices_and_empty_balance(client):
    b = client.get("/api/billing", headers=as_user(OLENA)).json()
    assert b["available"] == 0 and b["subscription"] is None
    assert b["prices"] == {"single_kop": 4700, "subscription_kop": 35000, "subscription_credits": 15, "topup_kop": 1800,
                           "currency": "UAH", "provider": "mock"}


def test_no_credits_no_generation(client):
    r = client.post(f"/api/submissions/{SUB}/regenerate", headers=as_user(OLENA), json=OPTS)
    assert r.status_code == 402


def test_single_purchase_then_regenerate_view_only(client):
    p = pay(client, OLENA, "single")
    assert p["status"] == "success" and p["amount_kop"] == 4700
    # повторне підтвердження не зараховує вдруге
    client.post(f"/api/billing/mock/{p['id']}", headers=as_user(OLENA), json={"success": True})
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["available"] == 1
    r = client.post(f"/api/submissions/{SUB}/regenerate", headers=as_user(OLENA), json=OPTS)
    assert r.status_code == 201
    rid = r.json()["id"]
    g = client.get(f"/api/regenerations/{rid}", headers=as_user(OLENA)).json()
    assert g["status"] == "done" and g["result"]["sections"] and g["options"]["rewrite"]["theory"] is True
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["available"] == 0
    # бачить лише той, хто оплатив
    assert client.get(f"/api/regenerations/{rid}", headers=as_user(MAKSYM)).status_code == 404
    assert [x["id"] for x in client.get("/api/regenerations", headers=as_user(OLENA)).json()] == [rid]


def test_must_choose_what_to_rewrite_and_no_charge_on_error(client):
    pay(client, OLENA, "single")
    bad = client.post(f"/api/submissions/{SUB}/regenerate", headers=as_user(OLENA), json={"rewrite": {"theory": False}})
    assert bad.status_code == 400
    other_uni = client.post(f"/api/submissions/{SUB}/regenerate", headers=as_user(SOFIIA), json=OPTS)
    assert other_uni.status_code == 404
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["available"] == 1


def test_subscription_gives_15_and_topup_requires_subscription(client):
    r = client.post("/api/billing/checkout", headers=as_user(MAKSYM), json={"kind": "topup", "quantity": 3})
    assert r.status_code == 400
    pay(client, MAKSYM, "subscription")
    b = client.get("/api/billing", headers=as_user(MAKSYM)).json()
    assert b["subscription"]["credits_left"] == 15 and b["available"] == 15
    t = pay(client, MAKSYM, "topup", quantity=3)
    assert t["amount_kop"] == 3 * 1800
    b = client.get("/api/billing", headers=as_user(MAKSYM)).json()
    assert b["available"] == 18 and b["credits"] == 3
    # спершу списуються генерації підписки
    client.post(f"/api/submissions/{SUB}/regenerate", headers=as_user(MAKSYM), json=OPTS)
    b = client.get("/api/billing", headers=as_user(MAKSYM)).json()
    assert b["subscription"]["credits_left"] == 14 and b["credits"] == 3
    # продовження підписки додає ще 15
    pay(client, MAKSYM, "subscription")
    assert client.get("/api/billing", headers=as_user(MAKSYM)).json()["subscription"]["credits_left"] == 29


def test_failed_payment_gives_nothing_and_payments_are_private(client):
    p = pay(client, OLENA, "single", success=False)
    assert p["status"] == "failure"
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["available"] == 0
    assert client.get(f"/api/billing/payments/{p['id']}", headers=as_user(MAKSYM)).status_code == 404
    assert client.post(f"/api/billing/mock/{p['id']}", headers=as_user(MAKSYM), json={"success": True}).status_code == 404
    assert [x["status"] for x in client.get("/api/billing/history", headers=as_user(OLENA)).json()["payments"]] == ["failure"]


def test_failed_generation_is_refunded(client, monkeypatch):
    from app.services import regeneration

    def boom(_data):
        raise ValueError("У PDF немає тексту")
    monkeypatch.setattr(regeneration, "extract_pdf", boom)
    pay(client, OLENA, "single")
    rid = client.post(f"/api/submissions/{SUB}/regenerate", headers=as_user(OLENA), json=OPTS).json()["id"]
    g = client.get(f"/api/regenerations/{rid}", headers=as_user(OLENA)).json()
    assert g["status"] == "failed" and "немає тексту" in g["error"]
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["available"] == 1


def test_monobank_webhook_rejected_in_mock_mode(client):
    assert client.post("/api/billing/monobank/webhook", content=b"{}", headers={"X-Sign": "x"}).status_code == 404


def test_production_mock_payments_only_for_staff(client, monkeypatch):
    import dataclasses

    from app.core import config
    from app.services import billing
    from conftest import IRYNA

    prod = dataclasses.replace(config.get_settings(), app_mode="supabase")  # імітуємо продакшн (store лишається демо)
    monkeypatch.setattr(billing, "get_settings", lambda: prod)
    r = client.post("/api/billing/checkout", headers=as_user(OLENA), json={"kind": "single"})
    assert r.status_code == 503  # студентам тестова оплата на продакшні недоступна
    p = client.post("/api/billing/checkout", headers=as_user(IRYNA), json={"kind": "single"})
    assert p.status_code == 201  # модерація може показати повний цикл
