"""Academia de ChessLab (/learn).

La página es PÚBLICA: cualquiera puede aprender sin cuenta.
Solo dos cosas dependen de la sesión, y las decide el SERVIDOR:
  - Enviar una opinión (formulario): hace falta haber iniciado sesión.
  - La apertura exclusiva de PRO: sus jugadas solo se envían a cuentas PRO.
    A las demás les llega el título y un candado, nunca las jugadas
    (ocultarlas con CSS no serviría: estarían en el código de la página).
"""

import re

from flask import (Blueprint, current_app, flash, g, redirect,
                   render_template, request, url_for)

from .auth import login_required
from .db import get_db
from .routes import fen_a_tablero

bp = Blueprint("learn", __name__)

# ---------- 1. Piezas: cómo se mueve cada una ----------
# Todas las posiciones son fijas y las hemos escrito nosotros.
# No hay rey negro a propósito: si lo hubiera, al mover libremente la torre
# o la dama podrían "comérselo". learn.js las carga sin validar (libre=True).
PIEZAS = [
    {
        "id": "caballo", "nombre": "Caballo", "simbolo": "♞", "valor": "3 puntos",
        "fen": "8/8/8/8/3N4/8/8/K7 w - - 0 1", "casilla": "d4",
        "texto": "Salta en forma de «L»: dos casillas en una dirección y una hacia el lado. "
                 "Es la única pieza que puede saltar por encima de otras.",
    },
    {
        "id": "alfil", "nombre": "Alfil", "simbolo": "♝", "valor": "3 puntos",
        "fen": "8/8/8/8/3B4/8/8/K7 w - - 0 1", "casilla": "d4",
        "texto": "Se mueve en diagonal tantas casillas como quiera. "
                 "Por eso siempre se queda en casillas del mismo color.",
    },
    {
        "id": "torre", "nombre": "Torre", "simbolo": "♜", "valor": "5 puntos",
        "fen": "8/8/8/8/3R4/8/8/K7 w - - 0 1", "casilla": "d4",
        "texto": "Se mueve en línea recta, por filas y columnas, tantas casillas como quiera. "
                 "Participa en el enroque junto al rey.",
    },
    {
        "id": "dama", "nombre": "Dama", "simbolo": "♛", "valor": "9 puntos",
        "fen": "8/8/8/8/3Q4/8/8/K7 w - - 0 1", "casilla": "d4",
        "texto": "La pieza más poderosa: combina la torre y el alfil. "
                 "Se mueve en línea recta y en diagonal. Fíjate en que su propio rey le corta el paso en a1.",
    },
    {
        "id": "rey", "nombre": "Rey", "simbolo": "♚", "valor": "Sin precio: si cae, pierdes",
        "fen": "8/8/8/8/3K4/8/8/8 w - - 0 1", "casilla": "d4",
        "texto": "Se mueve una sola casilla en cualquier dirección. "
                 "Nunca puede ir a una casilla que esté atacada por el rival.",
    },
    {
        "id": "peon", "nombre": "Peón", "simbolo": "♟", "valor": "1 punto",
        "fen": "8/8/8/8/8/3p4/4P3/K7 w - - 0 1", "casilla": "e2",
        "texto": "Avanza una casilla (dos en su primera jugada) pero captura en diagonal, "
                 "como ves en d3. Si llega al final del tablero, se convierte en otra pieza (coronación).",
    },
]

# ---------- 2. Reglas clave ----------
# "jaque" marca en rojo el rey atacado; "origen", la pieza que ataca.
REGLAS = [
    {
        "id": "jaque", "titulo": "Jaque",
        "fen": "4k3/8/8/8/8/8/8/4R1K1 b - - 0 1", "jaque": "e8", "origen": ("e1",),
        "texto": "La torre de e1 ataca al rey negro: es jaque. Hay tres formas de salir: "
                 "mover el rey, tapar la línea con otra pieza o capturar a la que ataca.",
    },
    {
        "id": "mate", "titulo": "Jaque mate",
        "fen": "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1", "jaque": "g8", "origen": ("a8",),
        "texto": "El rey está en jaque y no hay forma de salir: sus propios peones le cierran el paso. "
                 "Es jaque mate y la partida termina. Este patrón se llama «mate del pasillo».",
    },
    {
        "id": "ahogado", "titulo": "Rey ahogado",
        "fen": "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "jaque": None, "origen": ("f7", "g6"),
        "texto": "Juegan negras. Su rey NO está en jaque, pero cualquier casilla a la que vaya está atacada. "
                 "Sin jugadas legales y sin jaque, la partida acaba en tablas aunque las blancas tengan mucha ventaja.",
    },
]

# Enroque: se practica moviendo el rey (lo comprueba learn.js con chess.js)
ENROQUE_FEN = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1"

# ---------- 3. Aperturas ----------
# Las jugadas van en notación inglesa (la que entiende chess.js); en la página
# se muestran traducidas. Cada jugada lleva una explicación corta.
APERTURAS = [
    {
        "id": "espanola", "nombre": "Apertura Española", "pro": False,
        "resumen": "También llamada Ruy López. Una de las aperturas más antiguas y estudiadas.",
        "jugadas": [
            ("e4", "Las blancas ocupan el centro y abren paso a la dama y al alfil."),
            ("e5", "Las negras responden igual y disputan el centro."),
            ("Nf3", "El caballo sale atacando el peón de e5."),
            ("Nc6", "Las negras lo defienden desarrollando su caballo."),
            ("Bb5", "La jugada que da nombre a la Española: el alfil presiona al caballo que defiende e5."),
            ("a6", "Las negras preguntan al alfil qué quiere hacer."),
            ("Ba4", "El alfil se retira, pero sigue presionando al caballo de c6."),
            ("Nf6", "Otra pieza desarrollada, y ahora es el peón de e4 el atacado."),
            ("O-O", "Enroque corto: el rey queda a salvo y la torre se acerca al centro."),
            ("Be7", "Las negras preparan su propio enroque. Es la Española Cerrada."),
        ],
    },
    {
        "id": "siciliana", "nombre": "Defensa Siciliana", "pro": False,
        "resumen": "La respuesta más popular a 1.e4: crea posiciones desequilibradas y combativas.",
        "jugadas": [
            ("e4", "Las blancas ocupan el centro."),
            ("c5", "La Siciliana: las negras controlan d4 desde un lado, sin copiar a las blancas."),
            ("Nf3", "Desarrollo, preparando el avance d4."),
            ("d6", "Controla e5 y abre la diagonal del alfil de c8."),
            ("d4", "Las blancas rompen en el centro."),
            ("cxd4", "Las negras cambian un peón lateral por uno central."),
            ("Nxd4", "El caballo recupera el peón y queda en el centro."),
            ("Nf6", "Ataca el peón de e4."),
            ("Nc3", "Lo defiende desarrollando otra pieza."),
            ("a6", "La Variante Najdorf, favorita de Fischer y Kasparov: controla b5."),
        ],
    },
    {
        "id": "gambito-dama", "nombre": "Gambito de Dama", "pro": False,
        "resumen": "La apertura clásica con 1.d4. Sólida, posicional y llena de ideas.",
        "jugadas": [
            ("d4", "Las blancas ocupan el centro con el peón de dama."),
            ("d5", "Las negras responden con simetría."),
            ("c4", "El «gambito»: se ofrece un peón para alejar el de d5 del centro."),
            ("e6", "Gambito de Dama Rehusado: las negras mantienen su peón en d5."),
            ("Nc3", "Más presión sobre d5."),
            ("Nf6", "Las negras también defienden d5."),
            ("Bg5", "El alfil clava el caballo: si se moviera, la dama de d8 quedaría atacada."),
            ("Be7", "Las negras deshacen la clavada interponiendo el alfil."),
            ("e3", "Abre camino al alfil de f1 y refuerza d4."),
            ("O-O", "Las negras enrocan. Es una de las estructuras más sólidas del ajedrez."),
        ],
    },
    {
        "id": "gambito-rey", "nombre": "Gambito de Rey", "pro": True,
        "resumen": "Una apertura romántica y agresiva: las blancas sacrifican un peón para atacar.",
        "jugadas": [
            ("e4", "Las blancas ocupan el centro."),
            ("e5", "Las negras responden igual."),
            ("f4", "El Gambito de Rey: se ofrece un peón para abrir la columna f."),
            ("exf4", "Gambito aceptado: las negras toman el peón."),
            ("Nf3", "El caballo impide el jaque de la dama en h4 y prepara d4."),
            ("g5", "Las negras defienden su peón de más."),
            ("h4", "Las blancas atacan la cadena de peones negros."),
            ("g4", "El peón avanza y ataca al caballo."),
            ("Ne5", "Gambito Kieseritzky: el caballo salta al centro en lugar de retirarse."),
        ],
    },
]

# ---------- 4. Problemas tácticos ----------
# "mate": vale cualquier jugada que dé jaque mate.
# "jugada": solo vale esa jugada concreta (formato origen+destino, p. ej. "d5e7").
TACTICAS = [
    {
        "id": "pastor", "titulo": "Mate en 1", "tipo": "mate", "solucion": "",
        "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
        "enunciado": "Juegan blancas. Las negras han descuidado un punto débil. ¿Ves el mate?",
        "explicacion": "Dxf7#: la dama, apoyada por el alfil de c4, captura en f7. "
                       "El rey no puede tomarla ni escapar. Es el famoso «mate del pastor».",
    },
    {
        "id": "horquilla", "titulo": "Gana la dama", "tipo": "jugada", "solucion": "d5e7",
        "fen": "2q3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1",
        "enunciado": "Juegan blancas. Con un solo salto del caballo puedes ganar la dama negra.",
        "explicacion": "Ce7+: el caballo da jaque al rey y a la vez ataca a la dama de c8. "
                       "Es una «horquilla»: el rey tiene que apartarse y el caballo se come la dama.",
    },
]

# ---------- 5. Opiniones (formulario) ----------
OPINION_MAX = 1000
OPINIONES_POR_HORA = 5
# Cualquier carácter de control (salvo salto de línea y tabulador) se rechaza
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


# Notación en español: Caballo, Alfil, Torre, Dama, Rey (el enroque O-O no cambia)
LETRAS_ES = str.maketrans({"N": "C", "B": "A", "R": "T", "Q": "D", "K": "R"})


@bp.app_template_filter("san_es")
def san_es(san):
    """'Nf3' -> 'Cf3'. Solo traduce letras de piezas (en SAN van en mayúscula)."""
    return san.translate(LETRAS_ES)


def apertura_para_usuario(apertura):
    """Copia de la apertura sin sus jugadas si el usuario no puede verla."""
    es_pro = bool(g.user and g.user["is_premium"])
    if apertura["pro"] and not es_pro:
        return {**apertura, "jugadas": [], "bloqueada": True}
    return {**apertura, "bloqueada": False}


@bp.get("/learn")
def learn():
    # Pública: sin @login_required
    opiniones = []
    if g.user:
        # Solo las opiniones del usuario de la SESIÓN (nunca un id de la petición)
        opiniones = get_db().execute(
            "SELECT message, created_at FROM feedback WHERE user_id = ? "
            "ORDER BY id DESC LIMIT 3",
            (g.user["id"],),
        ).fetchall()

    pieza_inicial = PIEZAS[0]
    return render_template(
        "learn.html",
        piezas=PIEZAS,
        pieza_inicial=pieza_inicial,
        tablero_piezas=fen_a_tablero(pieza_inicial["fen"]),
        reglas=[{**r, "tablero": fen_a_tablero(r["fen"])} for r in REGLAS],
        enroque_fen=ENROQUE_FEN,
        tablero_enroque=fen_a_tablero(ENROQUE_FEN),
        aperturas=[apertura_para_usuario(a) for a in APERTURAS],
        tablero_inicial=fen_a_tablero("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
        tacticas=[{**t, "tablero": fen_a_tablero(t["fen"])} for t in TACTICAS],
        opiniones=opiniones,
        opinion_max=OPINION_MAX,
    )


@bp.post("/learn/opinion")
@login_required
def enviar_opinion():
    # El token CSRF ya lo ha comprobado auth.py antes de llegar aquí
    mensaje = request.form.get("mensaje", "").strip()
    volver = redirect(url_for("learn.learn") + "#opinion")

    if not mensaje:
        flash("Escribe algo antes de enviar tu opinión.", "error")
        return volver
    if len(mensaje) > OPINION_MAX:
        flash(f"La opinión puede tener como mucho {OPINION_MAX} caracteres.", "error")
        return volver
    if CONTROL_RE.search(mensaje):
        flash("La opinión contiene caracteres no permitidos.", "error")
        return volver

    db = get_db()
    # Límite sencillo contra el spam: como mucho 5 opiniones por hora y usuario
    recientes = db.execute(
        "SELECT COUNT(*) FROM feedback WHERE user_id = ? "
        "AND created_at >= datetime('now', '-1 hour')",
        (g.user["id"],),
    ).fetchone()[0]
    if recientes >= OPINIONES_POR_HORA:
        current_app.logger.warning(
            "OPINION rechazada (límite por hora): usuario=%s ip=%s",
            g.user["username"], request.remote_addr)
        flash("Has enviado muchas opiniones seguidas. Prueba de nuevo dentro de un rato.", "error")
        return volver

    # Consulta parametrizada: el texto nunca se mezcla con el SQL
    db.execute("INSERT INTO feedback (user_id, message) VALUES (?, ?)",
               (g.user["id"], mensaje))
    db.commit()
    current_app.logger.info(
        "OPINION guardada: usuario=%s longitud=%d", g.user["username"], len(mensaje))
    flash("¡Gracias! Hemos guardado tu opinión.", "success")
    # Patrón POST -> redirección -> GET: si recargas, no se envía otra vez
    return volver
