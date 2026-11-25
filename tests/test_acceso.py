"""CSRF, aislamiento entre usuarios (IDOR), ventajas PRO, redirecciones y entradas maliciosas."""
import pytest

from app.auth import destino_seguro
from conftest import FEN_INICIAL, TOKEN, crear_y_entrar, post

PGN = "1. e4 e5 2. Nf3 Nc6"


@pytest.mark.parametrize("url", [
    "/login", "/registro", "/logout", "/api/partidas",
    "/premium/activar", "/premium/cancelar", "/learn/opinion",
])
def test_todo_post_sin_token_csrf_es_400(app, url):
    c = crear_y_entrar(app, "ana")
    assert c.post(url, data={}).status_code == 400
    assert c.post(url, data={"csrf_token": "falso"}).status_code == 400


def test_paginas_privadas_exigen_sesion(cliente):
    for url in ("/play", "/perfil", "/premium/pagar", "/api/jugada-bot"):
        resp = cliente.get(url)
        assert resp.status_code == 302 and "/login" in resp.headers["Location"], url


def test_aislamiento_entre_usuarios_en_el_historial(app):
    ana = crear_y_entrar(app, "ana")
    beto = crear_y_entrar(app, "beto")
    # ana intenta guardar una partida a nombre de otro (user_id=2): se ignora
    post(ana, "/api/partidas", resultado="victoria", pgn=PGN, user_id="2")
    assert "1. e4 e5" in ana.get("/perfil").get_data(as_text=True)
    assert "1. e4 e5" not in beto.get("/perfil").get_data(as_text=True)
    assert beto.get("/perfil?user_id=1&id=1").get_data(as_text=True).count("1. e4 e5") == 0


def test_partida_con_datos_invalidos(app):
    c = crear_y_entrar(app, "ana")
    assert post(c, "/api/partidas", resultado="gané", pgn=PGN).status_code == 400
    assert post(c, "/api/partidas", resultado="victoria", pgn="").status_code == 400
    assert post(c, "/api/partidas", resultado="victoria", pgn="x\x00y").status_code == 400
    assert post(c, "/api/partidas", resultado="victoria", pgn="a" * 20_001).status_code == 400
    assert post(c, "/api/partidas", resultado="victoria", pgn=PGN).status_code == 201


def test_nivel_maestro_solo_para_pro(app):
    basica = crear_y_entrar(app, "ana")
    pro = crear_y_entrar(app, "beto", premium=True)
    q = {"fen": FEN_INICIAL, "nivel": "maestro"}
    assert basica.get("/api/jugada-bot", query_string=q).get_json()["nivel"] == "media"
    assert pro.get("/api/jugada-bot", query_string=q).get_json()["nivel"] == "maestro"
    q["nivel"] = "inventado"
    assert pro.get("/api/jugada-bot", query_string=q).get_json()["nivel"] == "media"


@pytest.mark.parametrize("fen", [
    "", "no es un fen", FEN_INICIAL + "\nquit", FEN_INICIAL + "; rm -rf /",
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 go infinite",
    "position startpos moves e2e4",
])
def test_fen_malicioso_no_llega_al_motor(app, fen):
    c = crear_y_entrar(app, "ana")
    assert c.get("/api/jugada-bot", query_string={"fen": fen}).status_code == 400


def test_pro_aislado_cada_usuario_activa_solo_el_suyo(app):
    ana = crear_y_entrar(app, "ana")
    crear_y_entrar(app, "beto")
    post(ana, "/premium/activar", acepto="si", user_id="2", is_premium="1")
    from app.db import get_db
    with app.app_context():
        filas = {f["username"]: f["is_premium"] for f in get_db().execute("SELECT username, is_premium FROM users")}
    assert filas == {"ana": 1, "beto": 0}


def test_activar_pro_exige_aceptar_y_no_guarda_tarjeta(app):
    c = crear_y_entrar(app, "ana")
    post(c, "/premium/activar")                       # sin marcar la casilla
    assert "badge-pro" not in c.get("/perfil").get_data(as_text=True)
    post(c, "/premium/activar", acepto="si", tarjeta="4242424242424242", cvc="123")
    from app.db import get_db
    with app.app_context():
        volcado = " ".join(str(tuple(f)) for t in ("users", "games", "feedback")
                           for f in get_db().execute(f"SELECT * FROM {t}"))
    assert "4242" not in volcado and "123" not in volcado.replace("pbkdf2", "")


@pytest.mark.parametrize("ruta,ok", [
    ("/play", True), ("/perfil", True), ("//evil.com", False), ("/\\evil.com", False),
    ("https://evil.com", False), ("javascript:alert(1)", False), ("", False), (None, False),
])
def test_destino_seguro_contra_redireccion_abierta(ruta, ok):
    assert destino_seguro(ruta) is ok


def test_tras_login_vuelve_a_la_pagina_pedida(app):
    c = app.test_client()
    from conftest import registrar, entrar
    registrar(c, "ana")
    assert c.get("/premium/pagar").status_code == 302
    resp = entrar(c, "ana")
    assert resp.status_code == 302 and resp.headers["Location"].endswith("/premium/pagar")


def test_registro_valida_y_guarda_hash(app):
    from conftest import registrar
    c = app.test_client()
    assert registrar(c, "a'; DROP TABLE users;--").status_code == 200   # usuario no válido
    assert registrar(c, "ana", "corta").status_code == 200              # contraseña corta
    registrar(c, "ana")
    from app.db import get_db
    with app.app_context():
        h = get_db().execute("SELECT password_hash FROM users WHERE username='ana'").fetchone()[0]
    assert "Contrasena-de-prueba-1" not in h and h.startswith(("scrypt:", "pbkdf2:"))


def test_inyeccion_sql_en_login_no_entra(app):
    c = app.test_client()
    from conftest import registrar, entrar
    registrar(c, "ana")
    resp = entrar(c, "ana' OR '1'='1", "' OR '1'='1")
    assert resp.status_code == 200 and c.get("/perfil").status_code == 302


def test_opinion_xss_sale_escapada_y_con_limites(app):
    c = crear_y_entrar(app, "ana")
    post(c, "/learn/opinion", mensaje="<script>alert(1)</script>")
    html = c.get("/learn").get_data(as_text=True)
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html
    for i in range(6):
        post(c, "/learn/opinion", mensaje=f"opinion {i}")
    from app.db import get_db
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 5   # límite 5/hora
    assert post(c, "/learn/opinion", mensaje="x" * 1001).status_code in (200, 302)


def test_health_publico(cliente):
    assert cliente.get("/health").get_json() == {"status": "ok"}
