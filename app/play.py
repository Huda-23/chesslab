"""Zona de juego: partida contra el bot (/play) y sus dos llamadas internas.

  GET  /play               -> la página con el tablero (requiere sesión)
  GET  /api/jugada-bot     -> pide al servidor la jugada del bot para una posición
  POST /api/partidas       -> guarda una partida terminada en el historial

Las reglas del ajedrez las aplica chess.js en el navegador. El servidor:
  - nunca confía en lo que llega: valida el FEN, el resultado y el PGN;
  - decide él la dificultad (elegirla es una ventaja PRO);
  - guarda cada partida a nombre del usuario de la SESIÓN, nunca de otro.
"""
import json
import os
import re
import urllib.parse
import urllib.request

from flask import Blueprint, current_app, g, jsonify, render_template, request

from .auth import RESULTADOS, login_required
from .db import get_db
from .routes import PORTADA_FEN, fen_a_tablero

bp = Blueprint("play", __name__)

# Dificultad -> profundidad de búsqueda de Stockfish (más profundidad = más fuerte)
NIVELES = {"facil": 1, "media": 5, "dificil": 9, "maestro": 13}
NOMBRES_NIVEL = {"facil": "Fácil", "media": "Media", "dificil": "Difícil", "maestro": "Maestro"}
NIVEL_BASICO = "media"  # el único nivel de las cuentas que no son PRO

STOCKFISH_URL = "https://stockfish.online/api/s/v2.php"
STOCKFISH_TIMEOUT = 4  # segundos; si tarda más, el navegador usa su plan B

# Formato de una posición FEN completa (6 campos). Si no encaja, no se reenvía a nadie.
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


def consultar_stockfish(fen, profundidad):
    """Pide la mejor jugada a la API pública de Stockfish Online.

    Devuelve una jugada UCI (p. ej. "e7e5") o None si algo falla. Nunca lanza
    una excepción: si la API no responde, el navegador juega su plan B.
    """
    url = STOCKFISH_URL + "?" + urllib.parse.urlencode({"fen": fen, "depth": profundidad})
    try:
        with urllib.request.urlopen(url, timeout=STOCKFISH_TIMEOUT) as respuesta:
            datos = json.loads(respuesta.read(10_000))  # como mucho 10 KB
    except (OSError, ValueError) as error:  # sin red, tiempo agotado, JSON roto...
        current_app.logger.warning("BOT: Stockfish Online no disponible (%s)", type(error).__name__)
        return None

    # La API responde algo como {"bestmove": "bestmove e7e5 ponder g1f3", ...}
    texto = datos.get("bestmove", "") if isinstance(datos, dict) else ""
    partes = str(texto).split()
    if len(partes) >= 2 and UCI_RE.match(partes[1]):
        return partes[1]
    return None


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
    jugada = None
    # STOCKFISH_ONLINE=0 en el .env -> nada sale del servidor; el bot juega al azar
    if os.environ.get("STOCKFISH_ONLINE", "1") == "1":
        jugada = consultar_stockfish(fen, NIVELES[nivel])

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
