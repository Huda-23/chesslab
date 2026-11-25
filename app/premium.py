"""ChessLab PRO (/premium): planes y pago SIMULADO.

  GET  /premium            -> planes (pública) y, con sesión, el formulario de pago
  GET  /premium/pagar      -> pide sesión; tras el login vuelve aquí y salta al pago
  POST /premium/activar    -> activa PRO para el usuario de la sesión
  POST /premium/cancelar   -> vuelve al plan Básico

Decisiones de seguridad:
  - Los datos de la tarjeta NUNCA llegan a este servidor. En la plantilla,
    los campos de la tarjeta no tienen atributo "name", así que el navegador
    no los envía. En una tienda real la tarjeta va directa a la pasarela de
    pago (Stripe, Redsys...) y nuestro servidor solo recibe un justificante:
    así no hay números de tarjeta que proteger ni que puedan robarse.
  - El precio lo fija el servidor; el navegador solo lo muestra.
  - Se cambia SIEMPRE la cuenta de la sesión (nunca un id recibido) y con
    token CSRF (lo comprueba auth.py en cada POST).
"""

from flask import (Blueprint, current_app, flash, g, redirect,
                   render_template, request, url_for)

from .auth import login_required
from .db import get_db

bp = Blueprint("premium", __name__)

PRECIO = "4,99 €"
PERIODO = "al mes"

VENTAJAS = [
    ("Elige la dificultad del bot", "Fácil, Media, Difícil o Maestro (Stockfish a plena potencia)."),
    ("Apertura exclusiva", "El Gambito de Rey, jugada a jugada, en la academia."),
    ("Insignia dorada", "Tu nombre lleva la insignia PRO y tu avatar, el anillo dorado."),
]


@bp.get("/premium")
def premium():
    # Pública: cualquiera puede ver los planes. Pagar requiere sesión.
    return render_template("premium.html", precio=PRECIO, periodo=PERIODO, ventajas=VENTAJAS)


@bp.get("/premium/pagar")
@login_required
def pagar():
    # login_required guarda esta ruta en la sesión: tras iniciar sesión,
    # el usuario vuelve aquí y lo llevamos directo al formulario de pago.
    return redirect(url_for("premium.premium") + "#pago")


@bp.post("/premium/activar")
@login_required
def activar():
    if g.user["is_premium"]:
        flash("Tu cuenta ya es PRO.", "info")
        return redirect(url_for("premium.premium"))

    # Casilla obligatoria: confirma que sabe que es una simulación
    if request.form.get("acepto") != "si":
        flash("Marca la casilla para confirmar que es un pago simulado.", "error")
        return redirect(url_for("premium.premium") + "#pago")

    db = get_db()
    db.execute("UPDATE users SET is_premium = 1 WHERE id = ?", (g.user["id"],))
    db.commit()
    current_app.logger.info(
        "PRO activado (pago simulado): usuario=%s ip=%s", g.user["username"], request.remote_addr)
    flash("¡Bienvenido a ChessLab PRO! Ya tienes todas las ventajas.", "success")
    return redirect(url_for("premium.premium"))


@bp.post("/premium/cancelar")
@login_required
def cancelar():
    if not g.user["is_premium"]:
        return redirect(url_for("premium.premium"))
    db = get_db()
    db.execute("UPDATE users SET is_premium = 0 WHERE id = ?", (g.user["id"],))
    db.commit()
    current_app.logger.info(
        "PRO cancelado: usuario=%s ip=%s", g.user["username"], request.remote_addr)
    flash("Has vuelto al plan Básico. Puedes volver a PRO cuando quieras.", "info")
    return redirect(url_for("premium.premium"))
