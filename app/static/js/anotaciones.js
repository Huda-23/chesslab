/* ==========================================================================
   ChessLab · flechas y casillas marcadas con el clic derecho (como en chess.com)
   --------------------------------------------------------------------------
   - Clic derecho en una casilla            -> la marca (otra vez: la desmarca)
   - Clic derecho, arrastrar y soltar       -> flecha de una casilla a otra
                                               (la misma flecha otra vez: se borra)
   - Mantén Shift o Ctrl mientras lo haces  -> otro color (verde o azul)
   - Clic izquierdo en el tablero o una jugada nueva -> se borra todo

   Es solo dibujo en TU pantalla: no cambia la partida, no se envía al
   servidor ni se guarda. Las flechas van en un SVG encima del tablero, creado
   con createElementNS (nunca innerHTML) y coloreado con clases de CSS, sin
   style="...": así sigue funcionando con la CSP estricta.
   ========================================================================== */

const SVG = "http://www.w3.org/2000/svg";
const COLUMNAS = "abcdefgh";

// Medidas de la flecha, en "casillas" (el SVG mide 8 x 8)
const PUNTA_LARGO = 0.45;     // lo que mide la cabeza de la flecha
const PUNTA_ANCHO = 0.27;     // media anchura de la cabeza
const PUNTA_EXTRA = 0.2;      // la punta entra un poco más allá del centro del destino

// Color según la tecla que mantienes pulsada. Sin tecla: rojo (casilla) o naranja (flecha)
function colorPorTeclas(evento) {
  if (evento.shiftKey) return "verde";
  if (evento.ctrlKey || evento.metaKey) return "azul";
  return null;
}

function crear(etiqueta, atributos) {
  const el = document.createElementNS(SVG, etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) el.setAttribute(nombre, valor);
  return el;
}

// Centro de una casilla en el SVG. Juegas con blancas: a8 arriba a la izquierda.
function centro(nombre) {
  return { x: COLUMNAS.indexOf(nombre[0]) + 0.5, y: 8 - Number(nombre[1]) + 0.5 };
}

// Recorrido de la flecha. Si el salto es de caballo (1 x 2), la flecha va en "L":
// primero el tramo largo y luego el corto, igual que en chess.com.
function recorrido(desde, hasta) {
  const a = centro(desde);
  const b = centro(hasta);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx * dy) === 2) {
    const esquina = Math.abs(dx) > Math.abs(dy) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return [a, esquina, b];
  }
  return [a, b];
}

const texto = (p) => p.x.toFixed(3) + "," + p.y.toFixed(3);

function dibujarFlecha(desde, hasta, color, previa = false) {
  const puntos = recorrido(desde, hasta);
  const ultimo = puntos[puntos.length - 1];
  const penultimo = puntos[puntos.length - 2];

  // Dirección del último tramo (vector de longitud 1) y su perpendicular
  const largo = Math.hypot(ultimo.x - penultimo.x, ultimo.y - penultimo.y);
  const ux = (ultimo.x - penultimo.x) / largo;
  const uy = (ultimo.y - penultimo.y) / largo;
  const px = -uy;
  const py = ux;

  const punta = { x: ultimo.x + ux * PUNTA_EXTRA, y: ultimo.y + uy * PUNTA_EXTRA };
  const base = { x: punta.x - ux * PUNTA_LARGO, y: punta.y - uy * PUNTA_LARGO };
  // El cuerpo acaba un pelín dentro de la cabeza para que no quede una raya entre ambos
  const finCuerpo = { x: base.x + ux * 0.02, y: base.y + uy * 0.02 };

  const grupo = crear("g", { class: "arrow arrow--" + color + (previa ? " arrow--preview" : "") });
  grupo.append(
    crear("polyline", {
      class: "arrow-body",
      points: [...puntos.slice(0, -1), finCuerpo].map(texto).join(" "),
    }),
    crear("polygon", {
      class: "arrow-head",
      points: [
        punta,
        { x: base.x + px * PUNTA_ANCHO, y: base.y + py * PUNTA_ANCHO },
        { x: base.x - px * PUNTA_ANCHO, y: base.y - py * PUNTA_ANCHO },
      ].map(texto).join(" "),
    })
  );
  return grupo;
}


/**
 * Activa las anotaciones en un tablero (.board con casillas [data-sq]).
 * Devuelve { borrar } para que quien lo use pueda limpiarlas (p. ej. tras una jugada).
 */
export function activarAnotaciones(tablero) {
  const marcas = new Map();     // "e4" -> "rojo"
  const flechas = new Map();    // "g1f3" -> "naranja"
  let trazo = null;             // clic derecho en curso: { id, desde, hasta, color }

  const lienzo = crear("svg", { class: "board-arrows", viewBox: "0 0 8 8", "aria-hidden": "true" });
  const capaFlechas = crear("g", {});
  const capaPrevia = crear("g", {});
  lienzo.append(capaFlechas, capaPrevia);
  tablero.appendChild(lienzo);

  function pintar() {
    tablero.querySelectorAll(".sq--mark").forEach((sq) => {
      sq.classList.remove("sq--mark", "sq--mark-rojo", "sq--mark-verde", "sq--mark-azul");
    });
    for (const [nombre, color] of marcas) {
      tablero.querySelector('[data-sq="' + nombre + '"]').classList.add("sq--mark", "sq--mark-" + color);
    }
    capaFlechas.replaceChildren(
      ...[...flechas].map(([clave, color]) => dibujarFlecha(clave.slice(0, 2), clave.slice(2), color))
    );
  }

  // Añade la anotación, o la quita si ya estaba igual (como un interruptor).
  // Si estaba con otro color, le cambia el color.
  function alternar(mapa, clave, color) {
    if (mapa.get(clave) === color) mapa.delete(clave);
    else mapa.set(clave, color);
    pintar();
  }

  function borrar() {
    if (!marcas.size && !flechas.size) return;
    marcas.clear();
    flechas.clear();
    pintar();
  }

  // Casilla bajo el puntero, calculada con la posición dentro del tablero
  function casillaEn(evento) {
    const caja = tablero.getBoundingClientRect();
    const col = Math.floor(((evento.clientX - caja.left) / caja.width) * 8);
    const fila = Math.floor(((evento.clientY - caja.top) / caja.height) * 8);
    if (col < 0 || col > 7 || fila < 0 || fila > 7) return null;   // fuera del tablero
    return COLUMNAS[col] + (8 - fila);
  }

  function cancelar() {
    trazo = null;
    capaPrevia.replaceChildren();
  }

  // Sin el menú del navegador al hacer clic derecho sobre el tablero
  tablero.addEventListener("contextmenu", (evento) => evento.preventDefault());

  tablero.addEventListener("pointerdown", (evento) => {
    if (evento.button === 0) {          // clic izquierdo: se borra todo, como en chess.com
      borrar();
      return;
    }
    if (evento.button !== 2 || evento.pointerType !== "mouse") return;
    const desde = casillaEn(evento);
    if (!desde) return;
    evento.preventDefault();
    trazo = { id: evento.pointerId, desde, hasta: desde, color: colorPorTeclas(evento) };
    tablero.setPointerCapture(evento.pointerId);   // seguimos el ratón aunque salga del tablero
  });

  tablero.addEventListener("pointermove", (evento) => {
    if (!trazo || evento.pointerId !== trazo.id) return;
    const hasta = casillaEn(evento);
    if (hasta === trazo.hasta) return;
    trazo.hasta = hasta;
    // Vista previa de la flecha mientras arrastras
    capaPrevia.replaceChildren();
    if (hasta && hasta !== trazo.desde) {
      capaPrevia.appendChild(dibujarFlecha(trazo.desde, hasta, trazo.color || "naranja", true));
    }
  });

  tablero.addEventListener("pointerup", (evento) => {
    if (!trazo || evento.pointerId !== trazo.id || evento.button !== 2) return;
    const { desde, color } = trazo;
    const hasta = casillaEn(evento);
    cancelar();
    if (!hasta) return;                                  // soltado fuera: no se dibuja nada
    if (hasta === desde) alternar(marcas, desde, color || "rojo");
    else alternar(flechas, desde + hasta, color || "naranja");
  });

  tablero.addEventListener("pointercancel", cancelar);

  return { borrar };
}
