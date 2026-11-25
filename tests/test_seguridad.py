"""Cabeceras, CSP y límites de tamaño."""
import re

from conftest import crear_y_entrar

PAGINAS_PUBLICAS = ["/", "/login", "/registro", "/learn", "/premium"]
PAGINAS_PRIVADAS = ["/play", "/perfil"]


def test_cabeceras_de_seguridad_en_todas_las_paginas(app, cliente):
    for url in PAGINAS_PUBLICAS:
        h = cliente.get(url).headers
        csp = h["Content-Security-Policy"]
        assert "script-src 'self'" in csp and "style-src 'self'" in csp, url
        assert "frame-ancestors 'none'" in csp and "object-src 'none'" in csp, url
        assert "unsafe-inline" not in csp and "unsafe-eval" not in csp, url
        assert h["X-Content-Type-Options"] == "nosniff", url
        assert h["Referrer-Policy"] == "same-origin", url
        assert h["Cache-Control"] == "no-store", url


def test_cabeceras_tambien_en_estaticos_y_errores(cliente):
    css = cliente.get("/static/css/main.css")
    assert css.status_code == 200
    assert "Content-Security-Policy" in css.headers
    assert "no-store" not in css.headers.get("Cache-Control", "")
    assert "Content-Security-Policy" in cliente.get("/no-existe").headers


def test_ninguna_pagina_usa_estilos_ni_scripts_en_linea(app):
    """Con la CSP estricta, un style="..." o un <script> en línea dejaría de funcionar."""
    c = crear_y_entrar(app, "ana")
    for url in PAGINAS_PUBLICAS + PAGINAS_PRIVADAS:
        html = c.get(url).get_data(as_text=True)
        assert not re.search(r"\sstyle\s*=", html), f"style= en {url}"
        assert not re.search(r"<style", html, re.I), f"<style> en {url}"
        assert not re.search(r"\son[a-z]+\s*=", html, re.I), f"manejador on* en {url}"
        for etiqueta in re.findall(r"<script[^>]*>", html, re.I):
            assert "src=" in etiqueta, f"<script> en línea en {url}"


def test_cookie_de_sesion_httponly_y_samesite(app):
    c = app.test_client()
    resp = c.get("/login")
    # La cookie solo existe si la sesión se usa: el token CSRF la crea.
    cookie = [v for k, v in resp.headers if k == "Set-Cookie"]
    assert cookie and "HttpOnly" in cookie[0] and "SameSite=Lax" in cookie[0]


def test_cookie_secure_si_se_activa(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "x-secreto-de-test")
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv("COOKIE_SECURE", "1")
    from app import create_app
    resp = create_app().test_client().get("/login")
    assert "Secure" in [v for k, v in resp.headers if k == "Set-Cookie"][0]


def test_peticion_enorme_se_rechaza(app):
    c = crear_y_entrar(app, "ana")
    resp = c.post("/api/partidas", data={"csrf_token": "x", "pgn": "a" * 200_000})
    assert resp.status_code == 413


def test_sin_secreto_la_app_no_arranca(tmp_path, monkeypatch):
    import pytest
    from app import create_app
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        create_app()
    monkeypatch.setenv("SESSION_SECRET", "cambia-esto")
    with pytest.raises(RuntimeError):
        create_app()
