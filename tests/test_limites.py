"""Límite de intentos de login, de registros y de peticiones al bot."""
from conftest import CLAVE, FEN_INICIAL, crear_y_entrar, entrar, post, registrar


def test_login_se_bloquea_tras_5_fallos_aunque_luego_acierte(app):
    c = app.test_client()
    registrar(c, "ana")
    for _ in range(5):
        assert entrar(c, "ana", "mala-clave-123").status_code == 200
    resp = entrar(c, "ana", CLAVE)             # contraseña CORRECTA, pero ya bloqueado
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    assert c.get("/perfil").status_code == 302  # sigue sin sesión


def test_el_bloqueo_de_un_usuario_no_afecta_a_otro(app):
    c = app.test_client()
    registrar(c, "ana")
    registrar(c, "beto")
    for _ in range(5):
        entrar(c, "ana", "mala-clave-123")
    assert entrar(c, "beto", CLAVE).status_code == 302   # beto entra sin problema


def test_acertar_borra_el_contador_del_usuario(app):
    c = app.test_client()
    registrar(c, "ana")
    for _ in range(4):
        entrar(c, "ana", "mala-clave-123")
    assert entrar(c, "ana", CLAVE).status_code == 302
    c.post("/logout", data={"csrf_token": "token-de-pruebas"})
    for _ in range(4):                                    # otros 4 fallos NO bloquean
        assert entrar(c, "ana", "mala-clave-123").status_code == 200


def test_fuerza_bruta_probando_muchos_usuarios_se_frena_por_ip(app):
    c = app.test_client()
    for i in range(10):
        entrar(c, f"usuario{i}", "x" * 10)
    assert entrar(c, "usuario99", "x" * 10).status_code == 429


def test_limite_de_registros_por_ip(app):
    c = app.test_client()
    for i in range(5):
        assert registrar(c, f"nuevo{i}").status_code == 302
    assert registrar(c, "nuevo5").status_code == 429


def test_bot_limitado_por_usuario(app):
    ana = crear_y_entrar(app, "ana")
    beto = crear_y_entrar(app, "beto")
    for _ in range(30):
        assert ana.get("/api/jugada-bot", query_string={"fen": FEN_INICIAL}).status_code == 200
    resp = ana.get("/api/jugada-bot", query_string={"fen": FEN_INICIAL})
    assert resp.status_code == 429 and int(resp.headers["Retry-After"]) >= 1
    # beto tiene su propio contador
    assert beto.get("/api/jugada-bot", query_string={"fen": FEN_INICIAL}).status_code == 200
