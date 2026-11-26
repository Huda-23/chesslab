/* ==========================================================================
   ChessLab · partida contra el bot (/play)
   --------------------------------------------------------------------------
   - Las REGLAS del ajedrez las aplica chess.js (librería de terceros, guardada
     en /static/vendor y verificada con su hash). Este archivo solo dibuja el
     tablero y gestiona los clics.
   - La jugada del bot se pide a NUESTRO servidor (/api/jugada-bot), que a su
     vez consulta a Stockfish, instalado DENTRO del contenedor. Nada sale a internet.
   - Si el servidor no da jugada (motor caído, tiempo agotado, respuesta rara),
     el bot juega una jugada legal al azar: es el "plan B".
   - Igual que en home.js: nunca se usa innerHTML; solo textContent y nodos
     creados con createElement. Así ningún dato puede inyectar HTML.
   ========================================================================== */
import { Chess } from "../vendor/chessjs/chess.js";
import { activarAnotaciones } from "./anotaciones.js";

const raiz = document.querySelector("[data-play]");
const tablero = raiz.querySelector(".board");
const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Datos que pone la plantilla en atributos data-*
const CSRF = raiz.dataset.csrf;
const URL_BOT = raiz.dataset.urlBot;
const URL_GUARDAR = raiz.dataset.urlGuardar;

// Elementos de la página
const $ = (selector) => raiz.querySelector(selector);
const estado = $("[data-estado]");
const estadoTexto = $("[data-estado-texto]");
const listaJugadas = $("[data-jugadas]");
const listaVacia = $("[data-jugadas-vacio]");
const selectorNivel = $("[data-nivel]");           // solo existe para cuentas PRO
const textoNivel = $("[data-nivel-texto]");
const textoMotor = $("[data-motor]");
const botonRendirse = $('.side-actions [data-accion="rendirse"]');
const botonNueva = $('.side-actions [data-accion="nueva"]');
const panelResultado = $("[data-resultado]");
const marco = raiz.querySelector(".board-frame");
const botonesNav = {
  inicio: $('[data-ir="inicio"]'),
  anterior: $('[data-ir="anterior"]'),
  siguiente: $('[data-ir="siguiente"]'),
  final: $('[data-ir="final"]'),
};
const avisoRevision = $("[data-revision]");
const textoRevision = $("[data-revision-texto]");
const anuncio = $("[data-anuncio]");        // solo para lectores de pantalla

const SIMBOLOS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
// Notación en español: Caballo, Alfil, Torre, Dama, Rey (la "O" del enroque no cambia)
const LETRAS_ES = { N: "C", B: "A", R: "T", Q: "D", K: "R" };
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const juego = new Chess();
let seleccion = null;          // casilla de la pieza elegida, p. ej. "e2"
let destinos = new Map();      // casillas a las que puede ir esa pieza
let botPensando = false;
let terminada = false;
let guardando = false;

// Historial para revisar la partida: cada jugada con la posición que deja (FEN).
// "vista" = cuántas jugadas se están mostrando en el tablero (0 = posición inicial).
// Si vista === historial.length estás "en vivo"; si no, estás mirando el pasado.
const POSICION_INICIAL = juego.fen();
let historial = [];
let vista = 0;
let mostrando = false;         // true mientras se anima una jugada nueva
let navegacion = 0;            // contador para descartar animaciones de revisión antiguas
const enVivo = () => vista === historial.length;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const casilla = (nombre) => tablero.querySelector('[data-sq="' + nombre + '"]');

// Flechas y casillas marcadas con el clic derecho (ver anotaciones.js)
const anotaciones = activarAnotaciones(tablero);


/* ---------- 1. Dibujar el tablero a partir del estado de chess.js ---------- */

function crearPieza(color, tipo) {
  const pieza = document.createElement("span");
  pieza.className = "piece piece--" + color;
  pieza.dataset.p = color + tipo;
  pieza.textContent = SIMBOLOS[tipo] + "︎";   // textContent: siempre texto
  return pieza;
}

// Pone en cada casilla la pieza que dice chess.js. Solo toca las casillas
// que han cambiado; así arregla enroques, capturas al paso y coronaciones.
function pintarPosicion(forzar = false, filas = juego.board()) {
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const el = casilla("abcdefgh"[j] + (8 - i));
      const datos = filas[i][j];
      const esperado = datos ? datos.color + datos.type : "";
      const actual = el.querySelector(".piece");
      if (forzar || (actual ? actual.dataset.p : "") !== esperado) {
        el.querySelectorAll(".piece").forEach((p) => p.remove());
        if (datos) el.appendChild(crearPieza(datos.color, datos.type));
      }
    }
  }
}

function quitarClases(...clases) {
  tablero.querySelectorAll("." + clases.join(", .")).forEach((sq) => sq.classList.remove(...clases));
}

function marcarJaque(partida = juego) {
  quitarClases("sq--check");
  if (!partida.inCheck()) return;
  const turno = partida.turn();
  partida.board().flat().forEach((p) => {
    if (p && p.type === "k" && p.color === turno) casilla(p.square).classList.add("sq--check");
  });
}

// Desliza una pieza de una casilla a otra (técnica FLIP, como en la portada)
async function deslizar(desde, hasta) {
  const origen = casilla(desde);
  const destino = casilla(hasta);
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
    { duration: 240, easing: "cubic-bezier(.2, .8, .2, 1)" }
  ).finished;
  pieza.classList.remove("is-moving");
}

// Pone la pieza en su nueva casilla sin animación (tras soltarla arrastrando)
async function colocar(desde, hasta) {
  const pieza = casilla(desde).querySelector(".piece");
  if (!pieza) return;
  const capturada = casilla(hasta).querySelector(".piece");
  if (capturada) capturada.remove();
  casilla(hasta).appendChild(pieza);
}

// Muestra en el tablero una jugada que chess.js YA ha aplicado
// arrastrada = true: la pieza ya está donde la soltaste, así que no se desliza
async function mostrarJugada(jugada, arrastrada = false) {
  mostrando = true;
  navegacion++;                  // anula cualquier animación de revisión a medias
  anotaciones.borrar();          // como en chess.com: cada jugada limpia las flechas
  marcarUltima(jugada);

  await Promise.all(arrastrada ? [colocar(jugada.from, jugada.to)] : animarJugada(jugada));

  pintarPosicion(true);
  marcarJaque();
  historial.push({ from: jugada.from, to: jugada.to, san: jugada.san, color: jugada.color,
                   flags: jugada.flags, fen: juego.fen() });
  vista = historial.length;
  apuntarJugada(jugada);
  mostrando = false;
  actualizarNavegacion();
}

function marcarUltima(jugada) {
  quitarClases("sq--last");
  if (!jugada) return;
  casilla(jugada.from).classList.add("sq--last");
  casilla(jugada.to).classList.add("sq--last");
}

// Animaciones de una jugada (con la torre si es enroque).
// atras = true: la deshace (la pieza vuelve de "to" a "from").
function animarJugada(jugada, atras = false) {
  const fila = jugada.from[1];
  const pares = [[jugada.from, jugada.to]];
  if (jugada.flags.includes("k")) pares.push(["h" + fila, "f" + fila]);   // enroque corto
  if (jugada.flags.includes("q")) pares.push(["a" + fila, "d" + fila]);   // enroque largo
  return pares.map(([a, b]) => (atras ? deslizar(b, a) : deslizar(a, b)));
}


/* ---------- 2. Lista de jugadas ---------- */

function traducir(san) {
  return san.replace(/[NBRQK]/g, (letra) => LETRAS_ES[letra]);
}

function apuntarJugada(jugada) {
  listaVacia.hidden = true;

  // Cada jugada es un BOTÓN: se puede pulsar con el ratón o con el teclado (Tab + Intro)
  const texto = document.createElement("button");
  texto.type = "button";
  texto.className = "move";
  texto.dataset.ply = historial.length;     // número de jugada (1, 2, 3...)
  texto.textContent = traducir(jugada.san);

  if (jugada.color === "w") {
    const fila = document.createElement("li");
    const numero = document.createElement("span");
    numero.className = "move-num";
    numero.textContent = listaJugadas.children.length + 1 + ".";
    fila.append(numero, texto);
    listaJugadas.appendChild(fila);
  } else {
    listaJugadas.lastElementChild.appendChild(texto);
  }
}

// Clic en una jugada de la lista: el tablero salta a esa posición
listaJugadas.addEventListener("click", (evento) => {
  const boton = evento.target.closest("button[data-ply]");
  if (boton) irA(Number(boton.dataset.ply));
});


/* ---------- 2b. Revisar la partida: botones, teclado y lista ---------- */

function describir(n) {
  if (n === 0) return "Posición inicial";
  const j = historial[n - 1];
  const numero = Math.ceil(n / 2);
  return numero + (j.color === "w" ? ". " : "... ") + traducir(j.san);
}

// Pone el tablero en la posición tras n jugadas
async function irA(n) {
  n = Math.max(0, Math.min(n, historial.length));
  if (n === vista || mostrando) return;
  const anterior = vista;
  const id = ++navegacion;
  vista = n;
  soltarPieza();
  deseleccionar();
  anotaciones.borrar();
  actualizarNavegacion();

  // Un paso adelante o atrás se anima; los saltos largos, no
  if (!reducirMovimiento && Math.abs(n - anterior) === 1) {
    const adelante = n > anterior;
    const jugada = historial[(adelante ? n : anterior) - 1];
    await Promise.all(animarJugada(jugada, !adelante));
    if (id !== navegacion) return;   // mientras se animaba se pidió otra posición
  }

  const visor = new Chess(n ? historial[n - 1].fen : POSICION_INICIAL);
  pintarPosicion(true, visor.board());
  marcarUltima(n ? historial[n - 1] : null);
  marcarJaque(visor);
  anuncio.textContent = describir(n) + (enVivo() ? ". Posición actual." : "");
}

function actualizarNavegacion() {
  const total = historial.length;
  botonesNav.inicio.disabled = botonesNav.anterior.disabled = vista === 0;
  botonesNav.siguiente.disabled = botonesNav.final.disabled = enVivo();

  marco.classList.toggle("is-reviewing", !enVivo());
  avisoRevision.hidden = enVivo();
  textoRevision.textContent = (vista ? "Viendo " + describir(vista) : "Viendo la posición inicial")
    + " (" + vista + " de " + total + ")";
  tablero.classList.toggle("is-turn", puedoMover());

  // Resalta en la lista la jugada que se ve en el tablero
  listaJugadas.querySelectorAll(".is-current").forEach((el) => {
    el.classList.remove("is-current");
    el.removeAttribute("aria-current");
  });
  const actual = listaJugadas.querySelector('[data-ply="' + vista + '"]');
  if (actual) {
    actual.classList.add("is-current");
    actual.setAttribute("aria-current", "step");
    // Desplaza la lista (solo la lista, no la página) para que se vea
    const fila = actual.closest("li");
    if (fila.offsetTop < listaJugadas.scrollTop) listaJugadas.scrollTop = fila.offsetTop;
    else if (fila.offsetTop + fila.offsetHeight > listaJugadas.scrollTop + listaJugadas.clientHeight) {
      listaJugadas.scrollTop = fila.offsetTop + fila.offsetHeight - listaJugadas.clientHeight;
    }
  }
}

botonesNav.inicio.addEventListener("click", () => irA(0));
botonesNav.anterior.addEventListener("click", () => irA(vista - 1));
botonesNav.siguiente.addEventListener("click", () => irA(vista + 1));
botonesNav.final.addEventListener("click", () => irA(historial.length));
$("[data-volver]").addEventListener("click", () => irA(historial.length));

// Teclado: ← → una jugada, ↑ al inicio, ↓ a la posición actual (como en chess.com)
document.addEventListener("keydown", (evento) => {
  if (evento.altKey || evento.ctrlKey || evento.metaKey || !historial.length) return;
  if (evento.target.closest("input, select, textarea, [contenteditable]")) return;
  const destino = { ArrowLeft: vista - 1, ArrowRight: vista + 1, ArrowUp: 0, ArrowDown: historial.length }[evento.key];
  if (destino === undefined) return;
  evento.preventDefault();       // que las flechas no muevan la página
  irA(destino);
});


/* ---------- 3. Estado, botones y nivel ---------- */

function ponerEstado(texto, tipo = "") {
  estadoTexto.textContent = texto;
  estado.classList.remove("is-thinking", "is-check", "is-over");
  if (tipo) estado.classList.add("is-" + tipo);
}

function actualizarControles() {
  const empezada = juego.history().length > 0;
  tablero.classList.toggle("is-turn", puedoMover());
  botonRendirse.disabled = !empezada || terminada || botPensando;
  botonNueva.disabled = empezada && !terminada;
  if (selectorNivel) selectorNivel.disabled = empezada && !terminada;
}

function nivelElegido() {
  return selectorNivel ? selectorNivel.value : "";
}

if (selectorNivel) {
  selectorNivel.addEventListener("change", () => {
    textoNivel.textContent = "Nivel " + selectorNivel.selectedOptions[0].textContent;
  });
}


/* ---------- 4. Tus jugadas: arrastrar la pieza, o clic en la pieza y clic en el destino ----------
   Usamos Pointer Events: el mismo código sirve para ratón, dedo y lápiz.
   - Pulsas una pieza tuya  -> se marcan sus casillas legales.
   - Mantienes y mueves     -> la pieza sigue al cursor.
   - Sueltas en casilla legal -> se juega. En otro sitio -> vuelve a su casilla.
   - Si no la mueves (un clic normal), funciona como antes: clic en la pieza
     y clic en el destino.
   La legalidad la decide SIEMPRE chess.js; arrastrar solo cambia cómo eliges. */

const UMBRAL_ARRASTRE = 4;     // px que hay que mover para que cuente como arrastre
let arrastre = null;           // datos del arrastre en curso (o null)

function deseleccionar() {
  seleccion = null;
  destinos = new Map();
  quitarClases("sq--selected", "sq--dot", "sq--capture", "sq--hover");
}

function seleccionar(nombre) {
  deseleccionar();
  seleccion = nombre;
  casilla(nombre).classList.add("sq--selected");
  // chess.js nos da solo las jugadas LEGALES de esa pieza
  for (const m of juego.moves({ square: nombre, verbose: true })) {
    destinos.set(m.to, m);
    casilla(m.to).classList.add(m.captured ? "sq--capture" : "sq--dot");
  }
}

// Solo se mueve en la posición actual: mirando una jugada antigua, el tablero es de solo lectura
const puedoMover = () => !terminada && !botPensando && !mostrando && enVivo() && juego.turn() === "w";

// Casilla del tablero que hay bajo el puntero (o null si estás fuera)
function casillaEnPunto(x, y) {
  const el = document.elementFromPoint(x, y);
  const sq = el ? el.closest(".sq") : null;
  return sq && tablero.contains(sq) ? sq : null;
}

// Devuelve la pieza arrastrada a su casilla
function soltarPieza() {
  if (!arrastre) return;
  const { pieza } = arrastre;
  pieza.classList.remove("is-dragging");
  pieza.style.transform = "";
  tablero.classList.remove("is-dragging");
  quitarClases("sq--hover");
  arrastre = null;
}

tablero.addEventListener("pointerdown", (evento) => {
  // Mirando una jugada antigua, un clic en el tablero te devuelve a la partida
  if (evento.button === 0 && !enVivo() && !terminada) {
    irA(historial.length);
    return;
  }
  if (evento.button !== 0 || !puedoMover()) return;   // solo botón principal
  const sq = evento.target.closest(".sq");
  if (!sq) return;
  const nombre = sq.dataset.sq;

  // Segundo clic de "clic-clic": ya había pieza elegida y pulsas un destino legal
  if (seleccion && destinos.has(nombre)) {
    evento.preventDefault();
    moverYo(seleccion, nombre);
    return;
  }

  const pieza = juego.get(nombre);
  if (!pieza || pieza.color !== "w") {
    deseleccionar();
    return;
  }

  evento.preventDefault();                 // evita seleccionar texto al arrastrar
  const yaElegida = nombre === seleccion;
  if (!yaElegida) seleccionar(nombre);

  const elemento = sq.querySelector(".piece");
  const caja = elemento.getBoundingClientRect();
  arrastre = {
    id: evento.pointerId,
    desde: nombre,
    pieza: elemento,
    inicioX: evento.clientX,
    inicioY: evento.clientY,
    centroX: caja.left + caja.width / 2,
    centroY: caja.top + caja.height / 2,
    moviendo: false,
    yaElegida,
  };
  // El tablero sigue recibiendo el puntero aunque salgas de él
  tablero.setPointerCapture(evento.pointerId);
});

tablero.addEventListener("pointermove", (evento) => {
  if (!arrastre || evento.pointerId !== arrastre.id) return;
  const dx = evento.clientX - arrastre.inicioX;
  const dy = evento.clientY - arrastre.inicioY;

  if (!arrastre.moviendo) {
    if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE) return;   // aún es un clic
    arrastre.moviendo = true;
    arrastre.pieza.classList.add("is-dragging");
    tablero.classList.add("is-dragging");
  }

  // La pieza se centra bajo el cursor, como en chess.com
  const x = evento.clientX - arrastre.centroX;
  const y = evento.clientY - arrastre.centroY;
  arrastre.pieza.style.transform = "translate(" + x + "px, " + y + "px)";

  // Marca la casilla sobre la que estás
  const encima = casillaEnPunto(evento.clientX, evento.clientY);
  tablero.querySelectorAll(".sq--hover").forEach((el) => { if (el !== encima) el.classList.remove("sq--hover"); });
  if (encima) encima.classList.add("sq--hover");
});

tablero.addEventListener("pointerup", (evento) => {
  if (!arrastre || evento.pointerId !== arrastre.id) return;
  const { desde, moviendo, yaElegida } = arrastre;

  if (!moviendo) {
    // Fue un clic sin arrastrar: si la pieza ya estaba elegida, se desmarca
    soltarPieza();
    if (yaElegida) deseleccionar();
    return;
  }

  const destino = casillaEnPunto(evento.clientX, evento.clientY);
  const hasta = destino ? destino.dataset.sq : null;
  soltarPieza();
  if (hasta && destinos.has(hasta)) {
    moverYo(desde, hasta, true);
  }
  // Si no es un destino legal, la pieza ya ha vuelto y sigue elegida
});

// El sistema cancela el gesto (p. ej. cambia de ventana): la pieza vuelve
tablero.addEventListener("pointercancel", soltarPieza);
tablero.addEventListener("lostpointercapture", soltarPieza);

async function moverYo(desde, hasta, arrastrada = false) {
  deseleccionar();
  let jugada;
  try {
    // chess.js comprueba que la jugada es legal; si no lo es, lanza un error.
    // Si un peón llega al final, corona siempre a dama (simplificación).
    jugada = juego.move({ from: desde, to: hasta, promotion: "q" });
  } catch {
    return;
  }
  botPensando = true;          // bloquea el tablero mientras se anima
  actualizarControles();
  await mostrarJugada(jugada, arrastrada);
  if (await comprobarFinal()) return;
  await turnoDelBot();
}


/* ---------- 5. El bot: primero el servidor (Stockfish), si falla, al azar ---------- */

async function pedirJugadaAlServidor() {
  const parametros = new URLSearchParams({ fen: juego.fen(), nivel: nivelElegido() });
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), 7000);   // como mucho 7 s
  try {
    const respuesta = await fetch(URL_BOT + "?" + parametros, {
      signal: control.signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const tipo = respuesta.headers.get("content-type") || "";
    if (!respuesta.ok || !tipo.includes("application/json")) return null;
    const datos = await respuesta.json();
    // No nos fiamos ni de nuestro servidor: comprobamos el formato
    return typeof datos.jugada === "string" && UCI_RE.test(datos.jugada) ? datos.jugada : null;
  } catch {
    return null;   // sin red, tiempo agotado, sesión caducada...
  } finally {
    clearTimeout(temporizador);
  }
}

function jugadaAlAzar() {
  const legales = juego.moves({ verbose: true });
  return legales[Math.floor(Math.random() * legales.length)];
}

async function turnoDelBot() {
  botPensando = true;
  actualizarControles();
  ponerEstado("El bot está pensando…", "thinking");
  const inicio = performance.now();

  let jugada = null;
  let fuente = "Stockfish";
  const uci = await pedirJugadaAlServidor();
  if (uci) {
    try {
      jugada = juego.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    } catch {
      jugada = null;   // jugada ilegal para esta posición: no se usa
    }
  }
  if (!jugada) {
    const azar = jugadaAlAzar();
    jugada = juego.move({ from: azar.from, to: azar.to, promotion: azar.promotion || "q" });
    fuente = "jugada al azar (Stockfish no disponible)";
  }

  // Una pausa mínima para que se note que "piensa"
  const transcurrido = performance.now() - inicio;
  if (transcurrido < 450) await esperar(450 - transcurrido);

  // Si estabas mirando jugadas antiguas, vuelves a la posición actual para ver la del bot
  if (!enVivo()) {
    navegacion++;
    vista = historial.length;
    const previa = new Chess(historial.length ? historial[historial.length - 1].fen : POSICION_INICIAL);
    pintarPosicion(true, previa.board());
    marcarJaque(previa);
  }
  await mostrarJugada(jugada);
  textoMotor.textContent = "Última jugada del bot: " + fuente + ".";
  botPensando = false;

  if (await comprobarFinal()) return;
  ponerEstado(juego.inCheck() ? "¡Jaque! Te toca mover." : "Te toca mover.", juego.inCheck() ? "check" : "");
  actualizarControles();
}


/* ---------- 6. Fin de la partida y guardado ---------- */

async function comprobarFinal() {
  if (!juego.isGameOver()) return false;
  if (juego.isCheckmate()) {
    // Si le toca mover a las negras y están en mate, has ganado tú (blancas)
    await terminar(juego.turn() === "b" ? "victoria" : "derrota", "Jaque mate");
  } else {
    let motivo = "Regla de los 50 movimientos";
    if (juego.isStalemate()) motivo = "Rey ahogado";
    else if (juego.isThreefoldRepetition()) motivo = "Triple repetición";
    else if (juego.isInsufficientMaterial()) motivo = "Material insuficiente";
    await terminar("tablas", motivo);
  }
  return true;
}

const TEXTOS = {
  victoria: { titulo: "¡Victoria!", icono: "♛", pgn: "1-0" },
  derrota:  { titulo: "Derrota",    icono: "♚", pgn: "0-1" },
  tablas:   { titulo: "Tablas",     icono: "♜", pgn: "1/2-1/2" },
};

function ponerCabecera(clave, valor) {
  // chess.js cambió el nombre de este método entre versiones
  if (typeof juego.setHeader === "function") juego.setHeader(clave, valor);
  else juego.header(clave, valor);
}

async function terminar(resultado, motivo) {
  terminada = true;
  botPensando = false;
  deseleccionar();
  actualizarControles();
  ponerEstado("Partida terminada: " + TEXTOS[resultado].titulo.replace(/[¡!]/g, "").toLowerCase() + ".", "over");

  // Panel de resultado (todo con textContent)
  panelResultado.className = "result-panel result--" + resultado;
  $("[data-resultado-icono]").textContent = TEXTOS[resultado].icono + "︎";
  $("[data-resultado-titulo]").textContent = TEXTOS[resultado].titulo;
  $("[data-resultado-motivo]").textContent = motivo;
  const textoGuardado = $("[data-resultado-guardado]");
  textoGuardado.textContent = "Guardando en tu historial…";
  panelResultado.hidden = false;

  // Cabeceras del PGN (el formato estándar de las partidas de ajedrez)
  const hoy = new Date();
  ponerCabecera("Event", "Partida en ChessLab");
  ponerCabecera("Site", "ChessLab (localhost)");
  ponerCabecera("Date", hoy.getFullYear() + "." + String(hoy.getMonth() + 1).padStart(2, "0") + "." + String(hoy.getDate()).padStart(2, "0"));
  ponerCabecera("White", "Jugador");
  ponerCabecera("Black", "Bot ChessLab");
  ponerCabecera("Result", TEXTOS[resultado].pgn);
  ponerCabecera("Termination", motivo);

  textoGuardado.textContent = (await guardar(resultado, juego.pgn()))
    ? "✓ Guardada en tu historial."
    : "No se ha podido guardar la partida.";
}

async function guardar(resultado, pgn) {
  if (guardando) return false;
  guardando = true;
  try {
    // Mismo formato que un formulario normal, con el token CSRF incluido
    const cuerpo = new URLSearchParams({ csrf_token: CSRF, resultado, pgn });
    const respuesta = await fetch(URL_GUARDAR, {
      method: "POST",
      body: cuerpo,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    return respuesta.status === 201;
  } catch {
    return false;
  } finally {
    guardando = false;
  }
}


/* ---------- 7. Rendirse y nueva partida ---------- */

let temporizadorConfirmar = null;
botonRendirse.addEventListener("click", async () => {
  // Doble clic de seguridad: el primero pide confirmación (sin ventanas emergentes)
  if (!botonRendirse.classList.contains("is-confirm")) {
    botonRendirse.classList.add("is-confirm");
    botonRendirse.textContent = "¿Seguro? Pulsa otra vez";
    temporizadorConfirmar = setTimeout(restaurarRendirse, 3000);
    return;
  }
  restaurarRendirse();
  await terminar("derrota", "Te has rendido");
});

function restaurarRendirse() {
  clearTimeout(temporizadorConfirmar);
  botonRendirse.classList.remove("is-confirm");
  botonRendirse.textContent = "Rendirse";
}

function nuevaPartida() {
  soltarPieza();
  anotaciones.borrar();
  juego.reset();
  terminada = false;
  botPensando = false;
  deseleccionar();
  restaurarRendirse();
  quitarClases("sq--last", "sq--check");
  pintarPosicion(true);
  listaJugadas.replaceChildren();
  listaVacia.hidden = false;
  historial = [];
  vista = 0;
  navegacion++;
  textoMotor.textContent = "";
  panelResultado.hidden = true;
  ponerEstado("Te toca mover. Juegas con blancas.");
  actualizarControles();
  actualizarNavegacion();
}

raiz.querySelectorAll('[data-accion="nueva"]').forEach((boton) => boton.addEventListener("click", nuevaPartida));

// Al terminar: quitar el panel del resultado para repasar la partida
$('[data-accion="revisar"]').addEventListener("click", () => {
  panelResultado.hidden = true;
  botonesNav.anterior.focus();
});


/* ---------- 8. Arranque ---------- */
pintarPosicion(true);
actualizarControles();
actualizarNavegacion();
