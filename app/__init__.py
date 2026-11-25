import logging
import os

from flask import Flask

from . import auth, db, learn, motor, play, premium, routes, seguridad


def create_app():
    app = Flask(__name__)
    app.logger.setLevel(logging.INFO)

    # El secreto sale del entorno. Si falta, la app NO arranca.
    secret = os.environ.get("SESSION_SECRET")
    if not secret or secret == "cambia-esto":
        raise RuntimeError("Falta SESSION_SECRET: defínela en el archivo .env")

    app.config["SECRET_KEY"] = secret
    app.config["DATABASE"] = os.environ.get("DATABASE_PATH", "/data/chesslab.db")
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Con HTTPS (producción) se pone COOKIE_SECURE=1 en .env: la cookie de
        # sesión entonces nunca viaja por HTTP sin cifrar. En localhost (HTTP)
        # debe ir apagado o el navegador no la guardaría.
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",
    )

    db.init_app(app)
    seguridad.init_app(app)
    app.register_blueprint(routes.bp)
    app.register_blueprint(auth.bp)
    app.register_blueprint(play.bp)
    app.register_blueprint(learn.bp)
    app.register_blueprint(premium.bp)

    # Aviso en el log si falta Stockfish (el bot jugaría al azar)
    if motor.disponible():
        app.logger.info("Stockfish listo: %s", motor.ruta_motor())
    else:
        app.logger.warning("Stockfish NO encontrado en %s: el bot jugará al azar", motor.ruta_motor())
    return app
