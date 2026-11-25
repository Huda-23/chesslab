FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Motor de ajedrez Stockfish, del repositorio oficial de Debian (paquetes
# firmados y verificados por apt). Queda en /usr/games/stockfish.
# --no-install-recommends: solo lo imprescindible. Después se borra la caché
# de apt para que la imagen pese menos.
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Usuario sin privilegios y carpeta de datos para la base de datos
RUN useradd --system --create-home appuser \
    && mkdir /data \
    && chown appuser:appuser /data

COPY app ./app

USER appuser
EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "app:create_app()"]
