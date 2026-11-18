/* ==========================================================================
   ChessLab · efectos de la portada
   --------------------------------------------------------------------------
   JavaScript propio, sin librerías externas ni CDN. Se sirve desde /static,
   así que funciona con una CSP estricta (script-src 'self').

   Regla de seguridad de este archivo: NUNCA se usa innerHTML. Para cambiar
   texto se usa textContent (el navegador lo trata siempre como texto, no
   como HTML) y para rehacer el tablero se clona un nodo que ya existía.
   Así este script no puede convertirse en una vía de XSS.

   Si el usuario tiene activado "reducir movimiento" en su sistema, no se
   anima nada: la página se queda tal cual la manda el servidor.
   ========================================================================== */
(function () {
  "use strict";

  const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Marca que JavaScript está activo. El CSS solo oculta los bloques que
  // "aparecen al hacer scroll" si existe esta clase; sin JS se ve todo.
  document.documentElement.classList.add("js");

  const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));


  /* ---------- 1. Palabra que cambia en el título ---------- */
  function iniciarRotador() {
    const el = document.querySelector("[data-rotate]");
    if (!el || reducirMovimiento) return;

    const palabras = el.dataset.rotate.split(",");
    let i = 0;

    setInterval(async () => {
      el.classList.add("is-out");                  // se desvanece hacia arriba
      await esperar(350);
      i = (i + 1) % palabras.length;
      el.textContent = palabras[i];                // textContent: solo texto
      el.classList.remove("is-out");               // vuelve a aparecer
    }, 2800);
  }


  /* ---------- 2. Bloques que aparecen al hacer scroll ---------- */
  function iniciarApariciones() {
    const elementos = document.querySelectorAll(".reveal");

    // Navegador antiguo o "reducir movimiento": se muestran todos sin animar
    if (!("IntersectionObserver" in window) || reducirMovimiento) {
      elementos.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    // IntersectionObserver avisa cuando un elemento entra en pantalla
    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
          entrada.target.classList.add("is-visible");
          observador.unobserve(entrada.target);   // solo se anima una vez
        }
      });
    }, { threshold: 0.15 });

    elementos.forEach((el) => observador.observe(el));
  }


  /* ---------- 3. Contadores que suben hasta su número ---------- */
  function animarContador(el) {
    const final = parseInt(el.dataset.count, 10);
    if (!Number.isFinite(final)) return;

    const formato = new Intl.NumberFormat("es-ES");
    const duracion = 1400;
    const inicio = performance.now();

    function paso(ahora) {
      const t = Math.min((ahora - inicio) / duracion, 1);
      const suave = 1 - Math.pow(1 - t, 3);        // empieza rápido y frena al final
      el.textContent = formato.format(Math.round(final * suave));
      if (t < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
  }

  function iniciarContadores() {
    const contadores = document.querySelectorAll("[data-count]");
    if (!contadores.length || reducirMovimiento || !("IntersectionObserver" in window)) return;

    contadores.forEach((el) => { el.textContent = "0"; });

    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
          animarContador(entrada.target);
          observador.unobserve(entrada.target);
        }
      });
    }, { threshold: 0.6 });

    contadores.forEach((el) => observador.observe(el));
  }


  /* ---------- Datos: la partida que se reproduce en la portada ---------- */

  // "Partida de la Ópera": Paul Morphy contra el duque de Brunswick y el
  // conde Isouard, París, 1858. Una de las partidas más famosas de la historia.
  // Cada entrada: [movimientos "origen+destino", notación en español].
  // El enroque largo son dos movimientos a la vez (rey y torre).
  const PARTIDA = [
    ["e2e4", "1.e4"],        ["e7e5", "1…e5"],
    ["g1f3", "2.Cf3"],       ["d7d6", "2…d6"],
    ["d2d4", "3.d4"],        ["c8g4", "3…Ag4"],
    ["d4e5", "4.dxe5"],      ["g4f3", "4…Axf3"],
    ["d1f3", "5.Dxf3"],      ["d6e5", "5…dxe5"],
    ["f1c4", "6.Ac4"],       ["g8f6", "6…Cf6"],
    ["f3b3", "7.Db3"],       ["d8e7", "7…De7"],
    ["b1c3", "8.Cc3"],       ["c7c6", "8…c6"],
    ["c1g5", "9.Ag5"],       ["b7b5", "9…b5"],
    ["c3b5", "10.Cxb5"],     ["c6b5", "10…cxb5"],
    ["c4b5", "11.Axb5+"],    ["b8d7", "11…Cbd7"],
    ["e1c1 a1d1", "12.O-O-O"], ["a8d8", "12…Td8"],
    ["d1d7", "13.Txd7"],     ["d8d7", "13…Txd7"],
    ["h1d1", "14.Td1"],      ["e7e6", "14…De6"],
    ["b5d7", "15.Axd7+"],    ["f6d7", "15…Cxd7"],
    ["b3b8", "16.Db8+"],     ["d7b8", "16…Cxb8"],
    ["d1d8", "17.Td8#"],
  ];

  /* ---------- 4. Herramientas comunes para mover piezas ----------
     Recibe un tablero (el <div class="board">) y devuelve funciones para
     mover piezas, quitar marcas y señalar jaques sobre ESE tablero. */
  function crearControl(tablero) {
    const duracion = reducirMovimiento ? 0 : 520;
    const casilla = (nombre) => tablero.querySelector('[data-sq="' + nombre + '"]');

    function quitarMarcas() {
      tablero.querySelectorAll(".sq--last, .sq--check").forEach((sq) => {
        sq.classList.remove("sq--last", "sq--check");
      });
    }

    // Mueve una pieza con una animación de deslizamiento.
    // Técnica "FLIP": se coloca la pieza en su casilla final y se anima
    // desde la posición antigua hasta la nueva.
    function mover(desde, hasta) {
      const origen = casilla(desde);
      const destino = casilla(hasta);
      const pieza = origen && origen.querySelector(".piece");
      if (!pieza || !destino) return Promise.resolve();

      const capturada = destino.querySelector(".piece");
      const dx = origen.offsetLeft - destino.offsetLeft;
      const dy = origen.offsetTop - destino.offsetTop;

      origen.classList.add("sq--last");
      destino.classList.add("sq--last");

      destino.appendChild(pieza);                   // mover el nodo, no copiar HTML
      pieza.classList.add("is-moving");

      if (capturada) {
        capturada.animate(
          [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.5)" }],
          { duration: duracion / 2, delay: duracion / 2, fill: "forwards" }
        ).finished.then(() => capturada.remove());
      }

      return pieza.animate(
        [{ transform: "translate(" + dx + "px, " + dy + "px)" }, { transform: "translate(0, 0)" }],
        { duration: duracion, easing: "cubic-bezier(.2, .8, .2, 1)" }
      ).finished.then(() => pieza.classList.remove("is-moving"));
    }

    // Resalta en rojo la casilla del rey de ese color ("w" o "b")
    function marcarJaque(color) {
      tablero.querySelectorAll(".piece--" + color).forEach((p) => {
        if (p.textContent.startsWith("♚")) p.parentElement.classList.add("sq--check");
      });
    }

    return { quitarMarcas, mover, marcarJaque };
  }


  /* ---------- 5. Partida que se juega sola en el tablero grande ---------- */
  function iniciarTablero() {
    const figura = document.querySelector("[data-autoplay]");
    if (!figura || reducirMovimiento || !Element.prototype.animate) return;

    const textoJugada = figura.querySelector("[data-board-move]");
    let tablero = figura.querySelector(".board");
    let control = crearControl(tablero);
    // Copia de la posición inicial para poder volver a empezar
    const posicionInicial = tablero.cloneNode(true);

    async function jugar([movimientos, notacion]) {
      control.quitarMarcas();
      if (textoJugada) textoJugada.textContent = notacion;

      await Promise.all(movimientos.split(" ").map((m) => control.mover(m.slice(0, 2), m.slice(2, 4))));

      if (/[+#]$/.test(notacion)) {
        // Si movieron las negras (lleva "…"), el jaque es al rey blanco
        control.marcarJaque(notacion.includes("…") ? "w" : "b");
      }
    }

    // Si la pestaña está en segundo plano, se pausa hasta que vuelva a verse
    function esperarPestanaVisible() {
      if (!document.hidden) return Promise.resolve();
      return new Promise((resolver) => {
        document.addEventListener("visibilitychange", function alVolver() {
          if (!document.hidden) {
            document.removeEventListener("visibilitychange", alVolver);
            resolver();
          }
        });
      });
    }

    async function bucle() {
      await esperar(2200);                          // deja terminar la animación de entrada
      tablero.dataset.playing = "";

      for (;;) {
        for (const jugada of PARTIDA) {
          await esperarPestanaVisible();
          await jugar(jugada);
          await esperar(900);
        }
        if (textoJugada) textoJugada.textContent = "17.Td8# · ¡Jaque mate!";
        await esperar(4500);

        // Fundido y vuelta a la posición inicial
        await tablero.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: "forwards" }).finished;
        const nuevo = posicionInicial.cloneNode(true);
        nuevo.dataset.playing = "";
        tablero.replaceWith(nuevo);
        tablero = nuevo;
        control = crearControl(tablero);
        if (textoJugada) textoJugada.textContent = "";
        tablero.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450 });
        await esperar(1800);
      }
    }

    bucle();
  }


  /* ---------- 6. Problema táctico: "Ver solución" mueve la pieza ----------
     El botón es un <details>, que el navegador abre y cierra sin JavaScript.
     Aquí solo escuchamos cuándo se abre o se cierra para animar el tablero. */
  function iniciarProblemas() {
    if (!Element.prototype.animate) return;

    document.querySelectorAll("[data-puzzle]").forEach((caja) => {
      const detalles = caja.querySelector("details");
      const solucion = caja.dataset.puzzle;               // p. ej. "a1a8"
      if (!detalles || !/^[a-h][1-8][a-h][1-8]$/.test(solucion)) return;  // formato esperado

      let tablero = caja.querySelector(".board");
      const posicionInicial = tablero.cloneNode(true);

      detalles.addEventListener("toggle", async () => {
        if (detalles.open) {
          const control = crearControl(tablero);
          await control.mover(solucion.slice(0, 2), solucion.slice(2, 4));
          control.marcarJaque(caja.dataset.mated === "w" ? "w" : "b");
        } else {
          // Al ocultar la solución, el tablero vuelve a la posición del problema
          const nuevo = posicionInicial.cloneNode(true);
          tablero.replaceWith(nuevo);
          tablero = nuevo;
        }
      });
    });
  }


  iniciarRotador();
  iniciarApariciones();
  iniciarContadores();
  iniciarTablero();
  iniciarProblemas();
})();
