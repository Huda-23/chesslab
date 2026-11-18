import os
from flask import Flask
from . import db, routes


def create_app():
    app = Flask(__name__)

    # El secreto sale del entorno. Si falta, la app NO arranca.
    secret = os.environ.get("SESSION_SECRET")
    if not secret or secret == "cambia-esto":
        raise RuntimeError("Falta SESSION_SECRET: defínela en el archivo .env")

    app.config["SECRET_KEY"] = secret
    app.config["DATABASE"] = os.environ.get("DATABASE_PATH", "/data/chesslab.db")
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )

    db.init_app(app)
    app.register_blueprint(routes.bp)
    return app
