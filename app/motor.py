"""Motor de ajedrez local: Stockfish instalado DENTRO del contenedor.

El servidor habla con Stockfish por el protocolo UCI (texto por stdin/stdout):

    uci                      -> el motor se presenta y responde "uciok"
    setoption name ...       -> ajustes (fuerza, memoria, hilos)
    isready                  -> espera a que esté listo ("readyok")
    position fen <FEN>       -> la posición a analizar
    go depth N movetime T    -> piensa hasta N jugadas de profundidad o T ms
    ...                      -> responde "bestmove e7e5"

Decisiones de seguridad:
  - Nada sale a internet: el motor es un programa local.
  - Se ejecuta SIN shell (lista de argumentos), así que nada de lo que llega
    puede convertirse en un comando del sistema.
  - El FEN ya viene validado con una expresión regular (play.py) que no
    admite saltos de línea: nadie puede colar órdenes UCI extra ("\\nquit").
  - Tiempo máximo por consulta y el proceso se mata siempre al terminar.
  - Memoria e hilos limitados (Hash 16 MB, 1 hilo).
  - Si algo falla, devuelve None y el navegador juega su plan B.
"""

import os
import re
import selectors
import subprocess
import time

from flask import current_app

# Ruta del ejecutable. En Debian (imagen python:3.12-slim) el paquete
# "stockfish" lo instala en /usr/games/stockfish.
RUTA_POR_DEFECTO = "/usr/games/stockfish"

# Dificultad -> (Skill Level 0-20, profundidad máxima, tiempo máximo en ms)
AJUSTES = {
    "facil":   (0, 2, 150),
    "media":   (5, 6, 300),
    "dificil": (12, 10, 700),
    "maestro": (20, 14, 1200),
}

LIMITE_SEGUNDOS = 3           # margen total por consulta (arranque + pensar)
MAX_SALIDA = 200_000          # bytes; el motor no debería escribir tanto
UCI_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")


def ruta_motor():
    return os.environ.get("STOCKFISH_PATH", RUTA_POR_DEFECTO)


def disponible():
    """¿Está instalado el motor y se puede ejecutar?"""
    ruta = ruta_motor()
    return os.path.isfile(ruta) and os.access(ruta, os.X_OK)


class _Conversacion:
    """Envía órdenes al motor y lee sus respuestas con un tiempo límite."""

    def __init__(self, proceso, fin):
        self.proceso = proceso
        self.fin = fin                # instante (time.monotonic) en que se acaba el tiempo
        self.pendiente = b""
        self.leidos = 0
        self.selector = selectors.DefaultSelector()
        self.selector.register(proceso.stdout, selectors.EVENT_READ)

    def enviar(self, orden):
        self.proceso.stdin.write((orden + "\n").encode("ascii"))
        self.proceso.stdin.flush()

    def esperar(self, prefijo):
        """Lee líneas hasta encontrar una que empiece por `prefijo` y la devuelve."""
        while True:
            while b"\n" in self.pendiente:
                linea, self.pendiente = self.pendiente.split(b"\n", 1)
                texto = linea.decode("ascii", "replace").strip()
                if texto.startswith(prefijo):
                    return texto
            restante = self.fin - time.monotonic()
            if restante <= 0:
                raise TimeoutError("el motor tarda demasiado")
            if not self.selector.select(restante):
                raise TimeoutError("el motor tarda demasiado")
            trozo = os.read(self.proceso.stdout.fileno(), 4096)
            if not trozo:
                raise EOFError("el motor se ha cerrado")
            self.leidos += len(trozo)
            if self.leidos > MAX_SALIDA:
                raise ValueError("el motor ha escrito demasiado")
            self.pendiente += trozo


def mejor_jugada(fen, nivel):
    """Devuelve la mejor jugada en formato UCI (p. ej. "e7e5") o None.

    Nunca lanza una excepción: si el motor no está, tarda o responde algo
    raro, se registra en el log y se devuelve None.
    """
    habilidad, profundidad, milisegundos = AJUSTES[nivel]
    proceso = None
    try:
        proceso = subprocess.Popen(
            [ruta_motor()],                 # lista de argumentos: sin shell
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        charla = _Conversacion(proceso, time.monotonic() + LIMITE_SEGUNDOS)
        charla.enviar("uci")
        charla.esperar("uciok")
        charla.enviar("setoption name Threads value 1")
        charla.enviar("setoption name Hash value 16")
        charla.enviar(f"setoption name Skill Level value {habilidad}")
        charla.enviar("isready")
        charla.esperar("readyok")
        charla.enviar(f"position fen {fen}")
        charla.enviar(f"go depth {profundidad} movetime {milisegundos}")
        respuesta = charla.esperar("bestmove")    # "bestmove e7e5 ponder g1f3"
        charla.enviar("quit")
    except (OSError, TimeoutError, EOFError, ValueError) as error:
        current_app.logger.warning("BOT: motor local no disponible (%s: %s)",
                                   type(error).__name__, error)
        return None
    finally:
        if proceso is not None:
            # Pase lo que pase, el proceso del motor no se queda vivo
            try:
                proceso.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                proceso.kill()
                proceso.wait()
            for tuberia in (proceso.stdin, proceso.stdout):
                try:
                    tuberia.close()
                except OSError:
                    pass

    partes = respuesta.split()
    # "bestmove (none)" = no hay jugadas (mate o ahogado): no es un error
    if len(partes) >= 2 and UCI_RE.match(partes[1]):
        return partes[1]
    return None
