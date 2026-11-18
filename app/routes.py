from flask import Blueprint, jsonify, render_template
from .db import get_db

bp = Blueprint("main", __name__)

# Posición del tablero de la portada: la inicial. Sobre ella, static/js/home.js
# reproduce la "Partida de la Ópera". Es un valor fijo escrito por nosotros,
# no algo que envíe el usuario.
PORTADA_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

# Símbolos Unicode de las piezas. El "︎" pide al sistema que los dibuje
# como texto y no como emoji (si no, ♟ sale como un emoji en algunos equipos).
PIEZAS = {"k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♟"}
TEXTO = "︎"
COLUMNAS = "abcdefgh"


def fen_a_tablero(fen):
    """Convierte la parte de piezas de un FEN en 8 filas de 8 casillas.

    Cada casilla es un diccionario con su nombre (p. ej. "e4"), si es clara
    u oscura, y la pieza que tiene (símbolo y color), o None si está vacía.
    """
    filas = []
    for i, fila_fen in enumerate(fen.split()[0].split("/")):
        fila = []
        for caracter in fila_fen:
            # Un número en el FEN significa "tantas casillas vacías seguidas"
            huecos = int(caracter) if caracter.isdigit() else 1
            for _ in range(huecos):
                col = len(fila)
                casilla = {
                    "nombre": f"{COLUMNAS[col]}{8 - i}",
                    "clara": (i + col) % 2 == 0,
                    "pieza": None,
                    "color": None,
                }
                if not caracter.isdigit():
                    casilla["pieza"] = PIEZAS[caracter.lower()] + TEXTO
                    casilla["color"] = "w" if caracter.isupper() else "b"
                fila.append(casilla)
        filas.append(fila)
    return filas


@bp.get("/")
def index():
    # La portada es pública: no lleva @login_required.
    # Solo se muestra el TOTAL de partidas, nunca de quién son: es un dato agregado.
    partidas = get_db().execute("SELECT COUNT(*) FROM games").fetchone()[0]
    return render_template(
        "index.html",
        tablero=fen_a_tablero(PORTADA_FEN),
        partidas_jugadas=partidas,
    )


@bp.get("/health")
def health():
    # Si la base de datos no responde, esto falla y el healthcheck lo detecta.
    get_db().execute("SELECT 1")
    return jsonify(status="ok")
