from flask import Blueprint, jsonify, render_template
from .db import get_db

bp = Blueprint("main", __name__)


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/health")
def health():
    # Si la base de datos no responde, esto falla y el healthcheck lo detecta.
    get_db().execute("SELECT 1")
    return jsonify(status="ok")
