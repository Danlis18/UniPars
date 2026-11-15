from fastapi.testclient import TestClient

from app.main import app


def test_unhandled_error_is_json_with_cors():
    # непередбачена помилка не має виглядати для браузера як «немає з'єднання»
    @app.get("/api/_test_boom")
    def boom():
        raise RuntimeError("boom")

    origin = app.user_middleware[0].kwargs["allow_origins"][0] if app.user_middleware[0].kwargs.get("allow_origins") else "http://localhost:5173"
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/api/_test_boom", headers={"Origin": origin})
    assert r.status_code == 500
    assert r.json()["detail"].startswith("Внутрішня помилка сервера")
    assert r.headers.get("access-control-allow-origin") == origin
