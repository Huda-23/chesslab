# ChessLab

Web de ajedrez para la práctica de Puesta en Producción Segura.

## Arranque
1. `cp .env.example .env` y poner un `SESSION_SECRET` propio.
2. `docker compose up --build -d`
3. Abrir http://localhost:8000 (comprobación: /health)
