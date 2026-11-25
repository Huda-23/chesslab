"""Seguridad transversal: cabeceras HTTP, límites de tamaño y límite de peticiones.

Tres cosas, todas sin librerías externas:

1. CABECERAS DE SEGURIDAD en cada respuesta (after_request).
   La más importante es la CSP (Content-Security-Policy): le dice al navegador
   "solo ejecuta scripts y estilos que vengan de MI propio servidor". Si alguien
   consiguiera colar un <script> o un style="..." en una página (XSS), el
   navegador se negaría a ejecutarlo. Es una segunda barrera detrás del
   autoescapado de Jinja.

2. LÍMITE DE TAMAÑO de las peticiones (MAX_CONTENT_LENGTH): nadie puede
   mandarnos un POST de 500 MB para llenar la memoria.

3. LIMITADOR DE PETICIONES (ventana deslizante en memoria): frena la fuerza
   bruta contra el login y el abuso del bot (cada jugada del bot lanza un
   proceso Stockfish que consume CPU).
"""
import threading
import time
from collections import defaultdict, deque

from flask import jsonify, request

# --- 1. CSP y compañía -------------------------------------------------------
# Cada directiva, una por línea para poder explicarla.
CSP = "; ".join((
    "default-src 'self'",        # por defecto, todo solo de nuestro dominio
    "script-src 'self'",         # nada de <script> en línea ni de otros dominios
    "style-src 'self'",          # nada de style="..." ni <style> en línea
    "img-src 'self'",            # imágenes solo nuestras
    "font-src 'self'",
    "connect-src 'self'",        # fetch() solo hacia nuestro servidor
    "object-src 'none'",         # sin <object>/<embed> (plugins antiguos)
    "base-uri 'none'",           # nadie puede cambiar la <base> de la página
    "form-action 'self'",        # los formularios solo se envían a nosotros
    "frame-ancestors 'none'",    # nadie puede meter ChessLab en un <iframe> (clickjacking)
))

CABECERAS = {
    "Content-Security-Policy": CSP,
    # El navegador no "adivina" el tipo de un archivo: usa el que decimos.
    "X-Content-Type-Options": "nosniff",
    # Al salir hacia otra web no se filtra la URL en la que estabas.
    "Referrer-Policy": "same-origin",
    # Desactiva funciones del navegador que ChessLab no usa.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    # Aísla nuestra ventana de las que abra otra web.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def _anadir_cabeceras(respuesta):
    for nombre, valor in CABECERAS.items():
        respuesta.headers.setdefault(nombre, valor)
    # Las páginas dinámicas (con tu sesión) no deben guardarse en cachés compartidas.
    if request.endpoint != "static":
        respuesta.headers.setdefault("Cache-Control", "no-store")
    return respuesta


# --- 3. Limitador ------------------------------------------------------------
class Limitador:
    """Cuenta eventos por clave (IP, usuario...) en una ventana de tiempo.

    Está en MEMORIA: cada worker de gunicorn tiene el suyo (con 2 workers, el
    límite real es hasta el doble). Para una web de práctica es suficiente; en
    producción se usaría Redis. Se reinicia al reiniciar el contenedor.
    """

    def __init__(self, maximo, ventana, nombre=""):
        self.maximo = maximo
        self.ventana = ventana          # segundos
        self.nombre = nombre
        self._eventos = defaultdict(deque)
        self._cerrojo = threading.Lock()

    def _limpiar(self, cola, ahora):
        while cola and cola[0] <= ahora - self.ventana:
            cola.popleft()

    def espera(self, clave):
        """Segundos que faltan para poder volver a intentarlo (0 = permitido)."""
        ahora = time.monotonic()
        with self._cerrojo:
            cola = self._eventos.get(clave)
            if not cola:
                return 0
            self._limpiar(cola, ahora)
            if len(cola) < self.maximo:
                return 0
            return max(1, int(cola[0] + self.ventana - ahora) + 1)

    def registrar(self, clave):
        """Apunta un evento (un intento, una petición)."""
        ahora = time.monotonic()
        with self._cerrojo:
            cola = self._eventos[clave]
            self._limpiar(cola, ahora)
            cola.append(ahora)
            # Evita que el diccionario crezca sin fin con claves antiguas
            if len(self._eventos) > 10_000:
                for k in [k for k, c in self._eventos.items() if not c or c[-1] <= ahora - self.ventana]:
                    del self._eventos[k]

    def olvidar(self, clave):
        with self._cerrojo:
            self._eventos.pop(clave, None)

    def reiniciar(self):
        with self._cerrojo:
            self._eventos.clear()


# Intentos de login FALLIDOS: 5 cada 5 minutos por IP y 5 por usuario.
# (Por usuario: así tampoco sirve atacar una cuenta desde muchas IPs.)
LOGIN_IP = Limitador(10, 300, "login-ip")
LOGIN_USUARIO = Limitador(5, 300, "login-usuario")
# Altas de cuenta: 5 por hora y por IP (frena crear cuentas en masa).
REGISTRO_IP = Limitador(5, 3600, "registro-ip")
# Jugadas del bot: 30 por minuto y por usuario (una partida normal pide 1 cada pocos segundos).
BOT_USUARIO = Limitador(30, 60, "bot")

TODOS = (LOGIN_IP, LOGIN_USUARIO, REGISTRO_IP, BOT_USUARIO)


def respuesta_429(espera):
    """Respuesta JSON estándar 'demasiadas peticiones' con Retry-After."""
    r = jsonify(error="Demasiadas peticiones. Espera un momento.")
    r.status_code = 429
    r.headers["Retry-After"] = str(espera)
    return r


def init_app(app):
    # Tope de cuerpo de petición: 64 KB. El PGN máximo son 20.000 caracteres.
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024
    app.after_request(_anadir_cabeceras)
