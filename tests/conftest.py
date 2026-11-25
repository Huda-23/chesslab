"""Preparación común de los tests: una app nueva y una base de datos vacía por test."""
import pytest

from app import create_app, motor, seguridad

TOKEN = "token-de-pruebas"
CLAVE = "Contrasena-de-prueba-1"


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "secreto-solo-para-tests")
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.db"))
    # El bot de mentira: los tests no dependen de que Stockfish esté instalado.
    monkeypatch.setattr(motor, "mejor_jugada", lambda fen, nivel: "e7e5")
    monkeypatch.setattr(motor, "disponible", lambda: True)
    for limitador in seguridad.TODOS:
        limitador.reiniciar()
    return create_app()


@pytest.fixture
def cliente(app):
    return app.test_client()


def poner_csrf(cliente):
    with cliente.session_transaction() as s:
        s["csrf"] = TOKEN


def post(cliente, url, **datos):
    """POST con el token CSRF correcto (los tests de CSRF lo mandan a mano)."""
    poner_csrf(cliente)
    return cliente.post(url, data={"csrf_token": TOKEN, **datos})


def registrar(cliente, usuario, clave=CLAVE):
    return post(cliente, "/registro", username=usuario, password=clave)


def entrar(cliente, usuario, clave=CLAVE):
    return post(cliente, "/login", username=usuario, password=clave)


def crear_y_entrar(app, usuario, premium=False):
    """Devuelve un cliente ya con la sesión iniciada como `usuario`."""
    c = app.test_client()
    registrar(c, usuario)
    entrar(c, usuario)
    if premium:
        with app.app_context():
            from app.db import get_db
            d = get_db()
            d.execute("UPDATE users SET is_premium = 1 WHERE username = ?", (usuario,))
            d.commit()
    return c


FEN_INICIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
