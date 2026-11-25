/* ==========================================================================
   ChessLab · academia (/learn)
   Cada sección usa el tablero interactivo de tablero.js. Las posiciones y
   soluciones vienen de la plantilla en atributos data-* (las escribe el
   servidor; Jinja las escapa). Nunca se usa innerHTML.
   Sin JavaScript la página sigue siendo legible: tableros estáticos y textos.
   ========================================================================== */

import { TableroInteractivo } from "./tablero.js";

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Cambia el texto de una línea de estado y su color (ok / error)
function ponerEstado(el, texto, tipo = "") {
  el.textContent = texto;
  el.classList.remove("is-ok", "is-error");
  if (tipo) el.classList.add("is-" + tipo);
}


/* ---------- 1. Piezas: elige una y muévela libremente ---------- */
const seccionPiezas = document.querySelector("[data-piezas]");
if (seccionPiezas) {
  const botones = [...seccionPiezas.querySelectorAll("[data-pieza]")];
  let actual = botones.find((b) => b.getAttribute("aria-pressed") === "true") || botones[0];

  const tablero = new TableroInteractivo(seccionPiezas.querySelector(".board"), {
    libre: true,   // lecciones con pocas piezas: no hace falta una posición "de partida"
    alMover: async (jugada) => {
      // Tras mover, vuelve a ser turno de las blancas para poder seguir probando
      const partes = tablero.juego.fen().split(" ");
      partes[1] = "w"; partes[3] = "-";
      tablero.juego.load(partes.join(" "), { skipValidation: true });
      tablero.seleccionar(jugada.to);
    },
  });

  function colocar(boton) {
    actual = boton;
    botones.forEach((b) => b.setAttribute("aria-pressed", String(b === boton)));
    seccionPiezas.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== boton.dataset.pieza;
    });
    tablero.cargar(boton.dataset.fen);
    tablero.activar(true);
    tablero.seleccionar(boton.dataset.casilla);   // muestra ya sus casillas
  }

  botones.forEach((b) => b.addEventListener("click", () => colocar(b)));
  seccionPiezas.querySelector('[data-accion="reiniciar-pieza"]').addEventListener("click", () => colocar(actual));
  colocar(actual);
}


/* ---------- 2. Enroque: hay que enrocar para completarlo ---------- */
const tarjetaEnroque = document.querySelector("[data-enroque]");
if (tarjetaEnroque) {
  const estado = tarjetaEnroque.querySelector("[data-estado]");
  const repetir = tarjetaEnroque.querySelector('[data-accion="reiniciar"]');

  const tablero = new TableroInteractivo(tarjetaEnroque.querySelector(".board"), {
    fen: tarjetaEnroque.dataset.fen,
    alMover: async (jugada) => {
      tablero.activar(false);
      // chess.js marca los enroques con la bandera "k" (corto) o "q" (largo)
      if (jugada.flags.includes("k")) {
        ponerEstado(estado, "¡Bien! Enroque corto (O-O): el rey a g1 y la torre a f1.", "ok");
      } else if (jugada.flags.includes("q")) {
        ponerEstado(estado, "¡Bien! Enroque largo (O-O-O): el rey a c1 y la torre a d1.", "ok");
      } else {
        ponerEstado(estado, "Eso es una jugada normal, no un enroque. Mueve el REY dos casillas.", "error");
        await esperar(900);
        await tablero.deshacer();
        tablero.activar(true);
        return;
      }
      repetir.hidden = false;
    },
  });

  repetir.addEventListener("click", () => {
    tablero.cargar(tarjetaEnroque.dataset.fen);
    tablero.activar(true);
    repetir.hidden = true;
    ponerEstado(estado, "Arrastra el rey dos casillas hacia una torre.");
  });
  tablero.activar(true);
}


/* ---------- 3. Aperturas: avanzar y retroceder jugada a jugada ---------- */
const seccionAperturas = document.querySelector("[data-aperturas]");
if (seccionAperturas) {
  const INICIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const tablero = new TableroInteractivo(seccionAperturas.querySelector(".board"), { fen: INICIAL });
  const pestanas = [...seccionAperturas.querySelectorAll("[data-apertura]")];
  const controles = [...seccionAperturas.querySelectorAll("[data-ir]")];
  let panel = null;
  let jugadas = [];     // botones de jugada de la apertura elegida
  let indice = 0;       // cuántas jugadas se ven ahora en el tablero
  let trabajando = false;

  function actualizarVista() {
    jugadas.forEach((b, i) => b.classList.toggle("is-current", i === indice - 1));
    const nota = panel ? panel.querySelector("[data-comentario]") : null;
    if (nota) {
      nota.textContent = indice === 0
        ? "Pulsa ▶︎ para ver la primera jugada."
        : jugadas[indice - 1].dataset.nota;
    }
    const sinJugadas = jugadas.length === 0;
    controles.forEach((b) => {
      const ir = b.dataset.ir;
      b.disabled = sinJugadas
        || ((ir === "inicio" || ir === "atras") && indice === 0)
        || ((ir === "adelante" || ir === "final") && indice === jugadas.length);
    });
  }

  // Lleva el tablero hasta la jugada número "destino"
  async function irA(destino) {
    if (trabajando) return;
    destino = Math.max(0, Math.min(destino, jugadas.length));
    trabajando = true;
    if (destino === indice + 1) {
      await tablero.jugar(jugadas[indice].dataset.san);       // una hacia delante: animada
    } else if (destino === indice - 1) {
      await tablero.deshacer();                               // una hacia atrás: animada
    } else {
      tablero.cargar(INICIAL);                                // salto: se recoloca de golpe
      for (const b of jugadas.slice(0, destino)) tablero.juego.move(b.dataset.san);
      tablero.pintar(true);
      tablero.marcarJaque();
      const ultima = tablero.juego.history({ verbose: true }).pop();
      if (ultima) {
        tablero.casilla(ultima.from).classList.add("sq--last");
        tablero.casilla(ultima.to).classList.add("sq--last");
      }
    }
    indice = destino;
    trabajando = false;
    actualizarVista();
  }

  function elegir(pestana) {
    pestanas.forEach((p) => p.setAttribute("aria-pressed", String(p === pestana)));
    seccionAperturas.querySelectorAll("[data-panel-apertura]").forEach((p) => {
      p.hidden = p.dataset.panelApertura !== pestana.dataset.apertura;
      if (!p.hidden) panel = p;
    });
    jugadas = [...panel.querySelectorAll("[data-san]")];   // vacío si está bloqueada
    indice = 0;
    tablero.cargar(INICIAL);
    actualizarVista();
  }

  pestanas.forEach((p) => p.addEventListener("click", () => elegir(p)));
  controles.forEach((b) => b.addEventListener("click", () => {
    const ir = b.dataset.ir;
    if (ir === "inicio") irA(0);
    if (ir === "atras") irA(indice - 1);
    if (ir === "adelante") irA(indice + 1);
    if (ir === "final") irA(jugadas.length);
  }));
  // Pulsar una jugada de la lista salta a esa posición
  seccionAperturas.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-indice]");
    if (boton) irA(Number(boton.dataset.indice));
  });
  // Flechas del teclado cuando el foco está en la sección
  seccionAperturas.addEventListener("keydown", (evento) => {
    if (evento.key === "ArrowRight") { evento.preventDefault(); irA(indice + 1); }
    if (evento.key === "ArrowLeft") { evento.preventDefault(); irA(indice - 1); }
  });

  elegir(pestanas.find((p) => p.getAttribute("aria-pressed") === "true") || pestanas[0]);
}


/* ---------- 4. Problemas tácticos ---------- */
document.querySelectorAll("[data-tactica]").forEach((tarjeta) => {
  const estado = tarjeta.querySelector("[data-estado]");
  const { fen, tipo, solucion } = tarjeta.dataset;

  const tablero = new TableroInteractivo(tarjeta.querySelector(".board"), {
    fen,
    alMover: async (jugada) => {
      tablero.activar(false);
      const acierto = tipo === "mate"
        ? tablero.juego.isCheckmate()                 // vale cualquier mate
        : jugada.from + jugada.to === solucion;       // vale solo esa jugada
      if (acierto) {
        ponerEstado(estado, "¡Correcto! " + (tipo === "mate" ? "Jaque mate." : "Has encontrado la jugada."), "ok");
        tarjeta.classList.add("is-solved");
        return;
      }
      ponerEstado(estado, "No es esa. Fíjate bien y prueba otra.", "error");
      await esperar(900);
      await tablero.deshacer();
      ponerEstado(estado, "Mueven blancas. Arrastra o pulsa una pieza.");
      tablero.activar(true);
    },
  });

  tarjeta.querySelector('[data-accion="reiniciar"]').addEventListener("click", () => {
    tablero.cargar(fen);
    tablero.activar(true);
    tarjeta.classList.remove("is-solved");
    ponerEstado(estado, "Mueven blancas. Arrastra o pulsa una pieza.");
  });
  tablero.activar(true);
});


/* ---------- 5. Contador de caracteres del formulario de opinión ---------- */
const areaOpinion = document.querySelector("[data-contador-max]");
if (areaOpinion) {
  const contador = document.querySelector("[data-contador]");
  const maximo = Number(areaOpinion.dataset.contadorMax);
  const actualizar = () => {
    const quedan = maximo - areaOpinion.value.length;
    contador.textContent = "Te quedan " + quedan + " caracteres.";
    contador.classList.toggle("is-low", quedan < 50);
  };
  areaOpinion.addEventListener("input", actualizar);
  actualizar();
}
