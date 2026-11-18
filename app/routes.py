from flask import Blueprint, jsonify, render_template
from .db import get_db

bp = Blueprint("main", __name__)

# Posición del tablero de la portada: la inicial. Sobre ella, static/js/home.js
# reproduce la "Partida de la Ópera". Es un valor fijo escrito por nosotros,
# no algo que envíe el usuario.
PORTADA_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

# Mini tableros de las secciones de la portada
PROBLEMA_FEN = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"   # mate del pasillo: 1.Ta8#
PROBLEMA_SOLUCION = "a1a8"                              # la torre va de a1 a a8
CABALLO_FEN = "8/8/8/8/3N4/8/8/8 w - - 0 1"             # un caballo solo en d4

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


def saltos_de_caballo(casilla):
    """Casillas a las que puede saltar un caballo desde `casilla` (en "L")."""
    col, fila = COLUMNAS.index(casilla[0]), int(casilla[1])
    saltos = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
    return {
        f"{COLUMNAS[col + dc]}{fila + df}"
        for dc, df in saltos
        if 0 <= col + dc < 8 and 1 <= fila + df <= 8   # que no se salga del tablero
    }


@bp.get("/")
def index():
    # La portada es pública: no lleva @login_required.
    # Solo se muestran TOTALES de partidas, nunca de quién son: son datos agregados.
    # No mostramos cuántos usuarios hay: ese número ayudaría a un atacante.
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    # played_at se guarda en UTC (CURRENT_TIMESTAMP), igual que date('now')
    hoy = db.execute(
        "SELECT COUNT(*) FROM games WHERE date(played_at) = date('now')"
    ).fetchone()[0]

    return render_template(
        "index.html",
        tablero=fen_a_tablero(PORTADA_FEN),
        partidas_total=total,
        partidas_hoy=hoy,
        tablero_problema=fen_a_tablero(PROBLEMA_FEN),
        problema_solucion=PROBLEMA_SOLUCION,
        tablero_caballo=fen_a_tablero(CABALLO_FEN),
        saltos_caballo=saltos_de_caballo("d4"),
    )


@bp.get("/health")
def health():
    # Si la base de datos no responde, esto falla y el healthcheck lo detecta.
    get_db().execute("SELECT 1")
    return jsonify(status="ok")
