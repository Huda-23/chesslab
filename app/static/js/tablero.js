/* ==========================================================================
   ChessLab · tablero interactivo reutilizable (lo usa la academia, /learn)

   Recibe un tablero ya dibujado por la plantilla (macro dibujar_tablero) y
   le da vida con chess.js:
     - pinta cualquier posición (FEN) y anima las jugadas,
     - deja mover las piezas del bando al que le toca: arrastrando
       (pulsar, mantener y soltar) o con dos clics, como en /play.

   La legalidad de cada jugada la decide SIEMPRE chess.js.
   Todo se crea con createElement/textContent: nunca innerHTML.
   ========================================================================== */

import { Chess } from "../vendor/chessjs/chess.js";

const SIMBOLOS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const UMBRAL_ARRASTRE = 4;   // px que hay que mover para que cuente como arrastre

export class TableroInteractivo {
  /**
   * @param {HTMLElement} el      el <div class="board"> de la plantilla
   * @param {object} opciones
   *   fen       posición inicial
   *   alMover   función(jugada) que se llama tras cada jugada tuya
   *   libre     true: no valida la posición (para lecciones con pocas piezas)
   */
  constructor(el, { fen, alMover = null, libre = false } = {}) {
    this.el = el;
    this.alMover = alMover;
    this.libre = libre;
    this.juego = new Chess();
    this.activo = false;
    this.ocupado = false;     // mientras se anima una jugada
    this.seleccion = null;
    this.destinos = new Map();
    this.arrastre = null;
    this.escucharPuntero();
    if (fen) this.cargar(fen);
  }

  casilla(nombre) {
    return this.el.querySelector('[data-sq="' + nombre + '"]');
  }

  /* ---------- Posición ---------- */

  cargar(fen) {
    this.juego.load(fen, { skipValidation: this.libre });
    this.deseleccionar();
    this.quitar("sq--last", "sq--check", "sq--origin");
    this.pintar(true);
  }

  // Pone en cada casilla la pieza que dice chess.js (solo cambia lo necesario)
  pintar(forzar = false) {
    const filas = this.juego.board();
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const sq = this.casilla("abcdefgh"[j] + (8 - i));
        const datos = filas[i][j];
        const esperado = datos ? datos.color + datos.type : "";
        const actual = sq.querySelector(".piece");
        if (forzar || (actual ? actual.dataset.p || "" : "") !== esperado) {
          if (actual) actual.remove();
          if (datos) sq.appendChild(this.crearPieza(datos.color, datos.type));
        }
      }
    }
  }

  crearPieza(color, tipo) {
    const pieza = document.createElement("span");
    pieza.className = "piece piece--" + color;
    pieza.dataset.p = color + tipo;
    pieza.textContent = SIMBOLOS[tipo] + "︎";   // "︎": dibujar como texto, no emoji
    return pieza;
  }

  quitar(...clases) {
    this.el.querySelectorAll("." + clases.join(", .")).forEach((sq) => sq.classList.remove(...clases));
  }

  marcarJaque() {
    this.quitar("sq--check");
    if (!this.juego.inCheck()) return;
    const turno = this.juego.turn();
    for (const fila of this.juego.board()) {
      for (const c of fila) {
        if (c && c.type === "k" && c.color === turno) this.casilla(c.square).classList.add("sq--check");
      }
    }
  }

  /* ---------- Jugadas y animación ---------- */

  async deslizar(desde, hasta) {
    const origen = this.casilla(desde);
    const destino = this.casilla(hasta);
    const pieza = origen.querySelector(".piece");
    if (!pieza) return;
    const dx = origen.offsetLeft - destino.offsetLeft;
    const dy = origen.offsetTop - destino.offsetTop;
    const capturada = destino.querySelector(".piece");
    if (capturada) capturada.remove();
    destino.appendChild(pieza);
    if (reducirMovimiento) return;
    pieza.classList.add("is-moving");
    await pieza.animate(
      [{ transform: "translate(" + dx + "px, " + dy + "px)" }, { transform: "translate(0, 0)" }],
      { duration: 260, easing: "cubic-bezier(.2, .8, .2, 1)" }
    ).finished;
    pieza.classList.remove("is-moving");
  }

  // Muestra una jugada que chess.js YA ha aplicado
  async mostrar(jugada, arrastrada = false) {
    this.quitar("sq--last");
    this.casilla(jugada.from).classList.add("sq--last");
    this.casilla(jugada.to).classList.add("sq--last");
    const animaciones = [];
    if (arrastrada) {
      const capturada = this.casilla(jugada.to).querySelector(".piece");
      if (capturada) capturada.remove();
      this.casilla(jugada.to).appendChild(this.casilla(jugada.from).querySelector(".piece"));
    } else {
      animaciones.push(this.deslizar(jugada.from, jugada.to));
    }
    const fila = jugada.from[1];
    if (jugada.flags.includes("k")) animaciones.push(this.deslizar("h" + fila, "f" + fila)); // enroque corto
    if (jugada.flags.includes("q")) animaciones.push(this.deslizar("a" + fila, "d" + fila)); // enroque largo
    await Promise.all(animaciones);
    this.pintar();      // arregla capturas al paso y coronaciones
    this.marcarJaque();
  }

  // Juega una jugada (SAN como "Nf3" u objeto {from, to}) y la anima
  async jugar(movimiento) {
    let jugada;
    try {
      jugada = this.juego.move(movimiento);
    } catch {
      return null;      // jugada ilegal: no pasa nada
    }
    this.ocupado = true;
    await this.mostrar(jugada);
    this.ocupado = false;
    return jugada;
  }

  // Deshace la última jugada (p. ej. si en un problema no era la correcta)
  async deshacer() {
    const jugada = this.juego.undo();
    if (!jugada) return;
    this.ocupado = true;
    if (!reducirMovimiento) await this.deslizar(jugada.to, jugada.from);
    this.quitar("sq--last", "sq--check");
    this.pintar(true);
    // Vuelve a marcar la jugada anterior, si la hay
    const anterior = this.juego.history({ verbose: true }).pop();
    if (anterior) {
      this.casilla(anterior.from).classList.add("sq--last");
      this.casilla(anterior.to).classList.add("sq--last");
    }
    this.marcarJaque();
    this.ocupado = false;
  }

  /* ---------- Interacción ---------- */

  activar(si = true) {
    this.activo = si;
    this.el.classList.toggle("is-turn", si);
    if (!si) this.deseleccionar();
  }

  puedeMover() {
    return this.activo && !this.ocupado;
  }

  deseleccionar() {
    this.seleccion = null;
    this.destinos = new Map();
    this.quitar("sq--selected", "sq--dot", "sq--capture", "sq--hover");
  }

  seleccionar(nombre) {
    this.deseleccionar();
    this.seleccion = nombre;
    this.casilla(nombre).classList.add("sq--selected");
    for (const m of this.juego.moves({ square: nombre, verbose: true })) {
      this.destinos.set(m.to, m);
      this.casilla(m.to).classList.add(m.captured ? "sq--capture" : "sq--dot");
    }
  }

  async moverYo(desde, hasta, arrastrada) {
    this.deseleccionar();
    let jugada;
    try {
      // Si un peón corona, siempre a dama (simplificación)
      jugada = this.juego.move({ from: desde, to: hasta, promotion: "q" });
    } catch {
      return;
    }
    this.ocupado = true;
    await this.mostrar(jugada, arrastrada);
    this.ocupado = false;
    if (this.alMover) await this.alMover(jugada);
  }

  casillaEnPunto(x, y) {
    const el = document.elementFromPoint(x, y);
    const sq = el ? el.closest(".sq") : null;
    return sq && this.el.contains(sq) ? sq : null;
  }

  soltarPieza() {
    if (!this.arrastre) return;
    this.arrastre.pieza.classList.remove("is-dragging");
    this.arrastre.pieza.style.transform = "";
    this.el.classList.remove("is-dragging");
    this.quitar("sq--hover");
    this.arrastre = null;
  }

  escucharPuntero() {
    this.el.addEventListener("pointerdown", (evento) => {
      if (evento.button !== 0 || !this.puedeMover()) return;
      const sq = evento.target.closest(".sq");
      if (!sq) return;
      const nombre = sq.dataset.sq;

      // Segundo clic: ya hay pieza elegida y pulsas un destino legal
      if (this.seleccion && this.destinos.has(nombre)) {
        evento.preventDefault();
        this.moverYo(this.seleccion, nombre, false);
        return;
      }
      const pieza = this.juego.get(nombre);
      if (!pieza || pieza.color !== this.juego.turn()) {
        this.deseleccionar();
        return;
      }
      evento.preventDefault();
      const yaElegida = nombre === this.seleccion;
      if (!yaElegida) this.seleccionar(nombre);

      const elemento = sq.querySelector(".piece");
      const caja = elemento.getBoundingClientRect();
      this.arrastre = {
        id: evento.pointerId, desde: nombre, pieza: elemento,
        inicioX: evento.clientX, inicioY: evento.clientY,
        centroX: caja.left + caja.width / 2, centroY: caja.top + caja.height / 2,
        moviendo: false, yaElegida,
      };
      this.el.setPointerCapture(evento.pointerId);
    });

    this.el.addEventListener("pointermove", (evento) => {
      const a = this.arrastre;
      if (!a || evento.pointerId !== a.id) return;
      if (!a.moviendo) {
        if (Math.hypot(evento.clientX - a.inicioX, evento.clientY - a.inicioY) < UMBRAL_ARRASTRE) return;
        a.moviendo = true;
        a.pieza.classList.add("is-dragging");
        this.el.classList.add("is-dragging");
      }
      const x = evento.clientX - a.centroX;
      const y = evento.clientY - a.centroY;
      a.pieza.style.transform = "translate(" + x + "px, " + y + "px)";
      const encima = this.casillaEnPunto(evento.clientX, evento.clientY);
      this.el.querySelectorAll(".sq--hover").forEach((el) => { if (el !== encima) el.classList.remove("sq--hover"); });
      if (encima) encima.classList.add("sq--hover");
    });

    this.el.addEventListener("pointerup", (evento) => {
      const a = this.arrastre;
      if (!a || evento.pointerId !== a.id) return;
      if (!a.moviendo) {
        this.soltarPieza();
        if (a.yaElegida) this.deseleccionar();
        return;
      }
      const destino = this.casillaEnPunto(evento.clientX, evento.clientY);
      const hasta = destino ? destino.dataset.sq : null;
      this.soltarPieza();
      if (hasta && this.destinos.has(hasta)) this.moverYo(a.desde, hasta, true);
    });

    this.el.addEventListener("pointercancel", () => this.soltarPieza());
    this.el.addEventListener("lostpointercapture", () => this.soltarPieza());
  }
}
