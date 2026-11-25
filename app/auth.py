import functools
import hmac
import re
import secrets
import sqlite3
from datetime import datetime

from flask import (Blueprint, abort, current_app, flash, g, redirect,
                   render_template, request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db

bp = Blueprint("auth", __name__)

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")


def csrf_token():
    """Token por sesión para proteger los formularios POST (CSRF)."""
    if "csrf" not in session:
        session["csrf"] = secrets.token_hex(16)
    return session["csrf"]


@bp.app_context_processor
def inject_csrf():
    return {"csrf_token": csrf_token}


@bp.before_app_request
def load_user_and_check_csrf():
    # Carga el usuario de la sesión (consulta parametrizada)
    g.user = None
    user_id = session.get("user_id")
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, username, is_premium FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    # Todo POST debe traer el token CSRF correcto
    if request.method == "POST":
        expected = session.get("csrf", "")
        sent = request.form.get("csrf_token", "")
        if not expected or not hmac.compare_digest(sent.encode(), expected.encode()):
            current_app.logger.warning(
                "CSRF inválido: ruta=%s ip=%s", request.path, request.remote_addr)
            abort(400)


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            # Recordamos qué página quería ver para llevarle allí tras el login.
            # Se guarda en la SESIÓN (no en la URL, tipo ?next=...), así nadie
            # puede fabricar un enlace que mande al usuario a otra web.
            if request.method == "GET" and not request.path.startswith("/api/"):
                session["volver_a"] = request.path
            return redirect(url_for("auth.login"))
        return view(*args, **kwargs)
    return wrapped


def destino_seguro(ruta):
    """Solo acepta rutas internas como "/play". Rechaza "//otra-web.com" y
    "/\\otra-web.com", que el navegador entendería como OTRA web (redirección abierta)."""
    return (isinstance(ruta, str) and ruta.startswith("/")
            and not ruta.startswith(("//", "/\\")))


@bp.route("/registro", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        error = None

        if not USERNAME_RE.match(username):
            error = "Usuario: 3-20 caracteres (letras, números o guion bajo)."
        elif not 8 <= len(password) <= 128:
            error = "La contraseña debe tener entre 8 y 128 caracteres."

        if error is None:
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                error = "Ese nombre de usuario ya existe."
                current_app.logger.warning(
                    "REGISTRO fallido (usuario existente): usuario=%s ip=%s",
                    username, request.remote_addr)
            else:
                current_app.logger.info(
                    "REGISTRO correcto: usuario=%s ip=%s",
                    username, request.remote_addr)
                flash("Cuenta creada. Ya puedes iniciar sesión.", "success")
                return redirect(url_for("auth.login"))

        flash(error, "error")
    return render_template("register.html")


@bp.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        user = get_db().execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            # %r escapa saltos de línea: evita inyección en los logs
            current_app.logger.warning(
                "LOGIN fallido: usuario=%r ip=%s", username, request.remote_addr)
            flash("Usuario o contraseña incorrectos.", "error")
        else:
            volver_a = session.get("volver_a")  # se lee ANTES de vaciar la sesión
            session.clear()
            session["user_id"] = user["id"]
            current_app.logger.info(
                "LOGIN correcto: usuario=%s ip=%s", user["username"], request.remote_addr)
            if destino_seguro(volver_a):
                return redirect(volver_a)
            return redirect(url_for("main.index"))
    return render_template("login.html")


@bp.post("/logout")
def logout():
    if g.user is not None:
        current_app.logger.info("LOGOUT: usuario=%s", g.user["username"])
    session.clear()
    return redirect(url_for("main.index"))


# Cómo se guarda el resultado de una partida en la tabla games (lo usará /play).
# Siempre desde el punto de vista del usuario: "victoria" = ganó el usuario.
RESULTADOS = ("victoria", "tablas", "derrota")


@bp.app_template_filter("fecha")
def formato_fecha(valor):
    """Convierte '2026-11-18 20:01:25' (como lo guarda SQLite) en '18/11/2026'."""
    try:
        return datetime.strptime(valor, "%Y-%m-%d %H:%M:%S").strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return valor


@bp.get("/perfil")
@login_required
def profile():
    db = get_db()
    # AISLAMIENTO ENTRE USUARIOS: todas las consultas filtran por el id del
    # usuario de la SESIÓN (g.user), nunca por un id que llegue en la URL o en
    # un formulario. Así nadie puede pedir el historial de otra persona.
    uid = g.user["id"]

    # Cuántas victorias, tablas y derrotas tiene (consulta parametrizada)
    conteo = dict.fromkeys(RESULTADOS, 0)
    for fila in db.execute(
        "SELECT result, COUNT(*) AS n FROM games WHERE user_id = ? GROUP BY result",
        (uid,),
    ):
        if fila["result"] in conteo:          # se ignora cualquier valor desconocido
            conteo[fila["result"]] = fila["n"]
    total = sum(conteo.values())

    # Porcentajes para la barra de resultados (enteros calculados aquí, en el servidor)
    porcentajes = {r: round(100 * n / total) if total else 0 for r, n in conteo.items()}

    # Últimas 20 partidas, de la más reciente a la más antigua
    partidas = db.execute(
        "SELECT result, pgn, played_at FROM games WHERE user_id = ? "
        "ORDER BY played_at DESC, id DESC LIMIT 20",
        (uid,),
    ).fetchall()

    alta = db.execute("SELECT created_at FROM users WHERE id = ?", (uid,)).fetchone()

    return render_template(
        "profile.html",
        conteo=conteo,
        total=total,
        porcentajes=porcentajes,
        partidas=partidas,
        miembro_desde=alta["created_at"],
    )
