"""Zona de juego: partida contra el bot (/play) y sus dos llamadas internas.

  GET  /play               -> la página con el tablero (requiere sesión)
  GET  /api/jugada-bot     -> el servidor pregunta la jugada a Stockfish (motor
                              LOCAL, dentro del contenedor: ver motor.py)
  POST /api/partidas       -> guarda una partida terminada en el historial

Las reglas del ajedrez las aplica chess.js en el navegador. El servidor:
  - nunca confía en lo que llega: valida el FEN, el resultado y el PGN;
  - decide él la dificultad (elegirla es una ventaja PRO);
  - guarda cada partida a nombre del usuario de la SESIÓN, nunca de otro.
"""
import re

from flask import Blueprint, current_app, g, jsonify, render_template, request

from . import motor
from .auth import RESULTADOS, login_required
from .db import get_db
from .routes import PORTADA_FEN, fen_a_tablero

bp = Blueprint("play", __name__)

# Dificultades disponibles (cómo juega cada una está en motor.AJUSTES)
NIVELES = tuple(motor.AJUSTES)
NOMBRES_NIVEL = {"facil": "Fácil", "media": "Media", "dificil": "Difícil", "maestro": "Maestro"}
NIVEL_BASICO = "media"  # el único nivel de las cuentas que no son PRO

# Formato de una posición FEN completa (6 campos). Si no encaja, no llega al motor.
# No admite saltos de línea: así nadie puede colar órdenes extra al motor.
FEN_RE = re.compile(
    r"^[pnbrqkPNBRQK1-8]{1,8}(/[pnbrqkPNBRQK1-8]{1,8}){7}"
    r" [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d{1,3} \d{1,4}$"
)
# Una jugada en notación UCI: casilla origen + destino (+ pieza de coronación)
UCI_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")

PGN_MAX = 20_000                                  # caracteres; una partida larga ocupa ~2.000
PGN_PROHIBIDO = re.compile(r"[^\t\n\r\x20-\x7E]")  # solo texto ASCII imprimible


def nivel_permitido(pedido):
    """Elegir la dificultad es una ventaja PRO: lo decide el SERVIDOR.

    Si una cuenta básica manda nivel=maestro (por ejemplo, editando la
    petición), se ignora y juega con el nivel básico.
    """
    if g.user["is_premium"] and pedido in NIVELES:
        return pedido
    return NIVEL_BASICO


@bp.get("/play")
@login_required
def play():
    return render_template(
        "play.html",
        tablero=fen_a_tablero(PORTADA_FEN),
        niveles=NOMBRES_NIVEL,
        nivel_basico=NIVEL_BASICO,
    )


@bp.get("/api/jugada-bot")
@login_required
def jugada_bot():
    fen = request.args.get("fen", "")
    if not FEN_RE.match(fen):
        return jsonify(error="Posición no válida"), 400

    nivel = nivel_permitido(request.args.get("nivel", ""))
    # Si el motor falla, jugada es None y el navegador juega su plan B
    jugada = motor.mejor_jugada(fen, nivel)
    return jsonify(jugada=jugada, nivel=nivel)


@bp.post("/api/partidas")
@login_required
def guardar_partida():
    # El token CSRF ya lo ha comprobado auth.py antes de llegar aquí.
    resultado = request.form.get("resultado", "")
    pgn = request.form.get("pgn", "")

    if resultado not in RESULTADOS:
        return jsonify(error="Resultado no válido"), 400
    if not pgn.strip() or len(pgn) > PGN_MAX or PGN_PROHIBIDO.search(pgn):
        return jsonify(error="PGN no válido"), 400

    db = get_db()
    db.execute(
        "INSERT INTO games (user_id, result, pgn) VALUES (?, ?, ?)",
        (g.user["id"], resultado, pgn),  # el dueño SIEMPRE es el usuario de la sesión
    )
    db.commit()
    current_app.logger.info(
        "PARTIDA guardada: usuario=%s resultado=%s tam_pgn=%d ip=%s",
        g.user["username"], resultado, len(pgn), request.remote_addr)
    return jsonify(ok=True), 201
