/* ==========================================================================
   ChessLab · pago simulado (/premium)

   Solo ayuda a rellenar el formulario: da formato al número, comprueba que
   los datos tienen sentido y los copia en la tarjeta de muestra.
   Los campos de la tarjeta no tienen "name": el navegador NO los envía al
   servidor. Aquí tampoco se guardan ni se mandan a ningún sitio.
   ========================================================================== */

const formulario = document.querySelector("[data-pago]");
if (formulario) {
  const campo = (nombre) => formulario.querySelector('[data-campo="' + nombre + '"]');
  const titular = campo("titular");
  const numero = campo("numero");
  const caducidad = campo("caducidad");
  const cvc = campo("cvc");
  const acepto = formulario.querySelector('input[name="acepto"]');
  const error = formulario.querySelector("[data-error]");
  const boton = formulario.querySelector("[data-pagar]");
  const vista = (nombre) => formulario.querySelector("[data-vista-" + nombre + "]");

  const soloDigitos = (texto) => texto.replace(/\D/g, "");

  // Algoritmo de Luhn: la comprobación que llevan todas las tarjetas.
  // Detecta errores al teclear (un dígito cambiado), no si la tarjeta existe.
  function luhnValido(digitos) {
    let suma = 0;
    for (let i = 0; i < digitos.length; i++) {
      let d = Number(digitos[digitos.length - 1 - i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      suma += d;
    }
    return digitos.length >= 13 && suma % 10 === 0;
  }

  function marca(digitos) {
    if (/^4/.test(digitos)) return "VISA";
    if (/^(5[1-5]|2[2-7])/.test(digitos)) return "MASTERCARD";
    if (/^3[47]/.test(digitos)) return "AMEX";
    return "";
  }

  // ¿La fecha MM/AA es de este mes o posterior?
  function caducidadValida(texto) {
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(texto);
    if (!m) return false;
    const hoy = new Date();
    const anio = 2000 + Number(m[2]);
    const mes = Number(m[1]);
    return anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes >= hoy.getMonth() + 1);
  }

  // --- Formato mientras se escribe, y copia en la tarjeta de muestra ---
  numero.addEventListener("input", () => {
    const d = soloDigitos(numero.value).slice(0, 16);
    numero.value = d.replace(/(\d{4})(?=\d)/g, "$1 ");
    const relleno = (d + "•".repeat(16 - d.length)).replace(/(.{4})(?=.)/g, "$1 ");
    vista("numero").textContent = relleno;
    vista("marca").textContent = marca(d);
  });

  caducidad.addEventListener("input", (evento) => {
    let d = soloDigitos(caducidad.value).slice(0, 4);
    // Al borrar no volvemos a poner la barra
    if (d.length >= 3 || (d.length === 2 && evento.inputType !== "deleteContentBackward")) {
      d = d.slice(0, 2) + "/" + d.slice(2);
    }
    caducidad.value = d;
    vista("caducidad").textContent = caducidad.value || "MM/AA";
  });

  titular.addEventListener("input", () => {
    vista("titular").textContent = titular.value.trim().toUpperCase() || "NOMBRE APELLIDO";
  });

  cvc.addEventListener("input", () => { cvc.value = soloDigitos(cvc.value).slice(0, 4); });

  // --- Comprobación al enviar ---
  function problema() {
    if (titular.value.trim().length < 3) return [titular, "Escribe el nombre del titular."];
    if (!luhnValido(soloDigitos(numero.value))) return [numero, "El número de tarjeta no es válido. Prueba con 4242 4242 4242 4242."];
    if (!caducidadValida(caducidad.value)) return [caducidad, "La fecha de caducidad no es válida o ya ha pasado."];
    if (!/^\d{3,4}$/.test(cvc.value)) return [cvc, "El CVC son 3 o 4 cifras."];
    if (!acepto.checked) return [acepto, "Marca la casilla para confirmar que es un pago simulado."];
    return null;
  }

  [titular, numero, caducidad, cvc, acepto].forEach((el) => el.addEventListener(el === acepto ? "change" : "input", () => {
    el.removeAttribute("aria-invalid");
    error.hidden = true;
  }));

  let enviando = false;
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (enviando) return;
    const fallo = problema();
    if (fallo) {
      const [el, texto] = fallo;
      el.setAttribute("aria-invalid", "true");
      error.textContent = texto;
      error.hidden = false;
      el.focus();
      return;
    }
    // Simula que la pasarela de pago "piensa" un momento
    enviando = true;
    boton.disabled = true;
    boton.classList.add("is-loading");
    boton.textContent = "Procesando pago…";
    await new Promise((resolver) => setTimeout(resolver, 1200));
    // Por si acaso, se vacían los campos de la tarjeta antes de enviar.
    // (No tienen "name", así que de todas formas no se enviarían.)
    [titular, numero, caducidad, cvc].forEach((el) => { el.value = ""; });
    formulario.submit();
  });
}
