/**
 * JOART DIGITAL — Conector (Apps Script)  ·  versión "Joart Core"
 * ----------------------------------------------------------------
 * Lo que hace:
 *  1) REGISTRA pedidos nuevos (panel.html → Nuevo): fila en "Base de datos",
 *     logos a Drive, tarjeta en ClickUp (sin asignar) y código de seguimiento JD-XXXXX.
 *  2) COTIZACIÓN (panel.html → Proyectos): lee el pedido por su CÓDIGO y guarda
 *     precios / cambios de cantidad en la MISMA fila (nunca crea otra).
 *  3) LISTA de proyectos leída directo del Sheets (la usa el Asistente sin IA).
 *  4) Portal del cliente (mi-pedido.html) y aprobación de render.
 *  5) LÁMINAS: estima % DE LÁMINA de cada pedido y la pestaña "Láminas" dice si alcanzan.
 *
 * LA FILA YA NO SE GUARDA COMO NÚMERO FIJO: cada pedido se busca por su código
 * (que vive en la nota de la columna A). Puedes mover, ordenar o insertar filas
 * en el Sheets sin que la plataforma se confunda.
 *
 * CÓMO ACTUALIZARLO (la URL del Web App NO cambia):
 *  1. Extensiones → Apps Script → borra TODO el código y pega este archivo.
 *  2. Engrane ⚙ "Configuración del proyecto" → "Propiedades de la secuencia de
 *     comandos" (Script properties) → agrega estas 4 (copia los valores de tu
 *     script anterior; NO los pegues en el código):
 *        CLICKUP_API_TOKEN       (pk_...)
 *        CLICKUP_LIST_ID         (los números de la lista)
 *        CONTRASENA              (la clave NUEVA de la plataforma)
 *  3. Implementar → Administrar implementaciones → lápiz ✏️ → Versión:
 *     "Nueva versión" → Implementar.
 *  4. (Una sola vez) elige la función "diagnostico" y dale ▶ Ejecutar:
 *     te dice si todo quedó bien conectado.
 */

// ============ CONFIGURACIÓN ============
// Lo normal es dejar esto VACÍO y usar "Propiedades de la secuencia de comandos".
// (Si prefieres pegarlos aquí también funciona, pero no los subas a ningún lado.)
const CONFIG_LOCAL = {
  CLICKUP_API_TOKEN: "",
  CLICKUP_LIST_ID: "901420243231",
  CLICKUP_USER_ID_SERGIO: "118288039",
  CONTRASENA: "",
};

const SHEET_NAME = "Base de datos";
const SHEET_LAMINAS = "Láminas";   // pestaña Tengo / Necesito / ¿Alcanza?
const FILA_TENGO = 5;              // fila de las casillas amarillas
const CELDA_ULTIMO_CONTEO = "B9";
const DRIVE_FOLDER_NAME = "Joart Digital - Logos de clientes";
const URL_BASE_WEB = "https://jormdzg-png.github.io/joart-digital-web/";
const MAX_CORRECCIONES = 3;

const COL = { NEGOCIO: 0, TIPO: 1, CANTIDAD: 2, PRECIO: 3, GROSOR: 4,
  FACTURA: 5, ESTATUS: 6, FECHA_LIMITE: 7, PAGADO: 8, PORC_HOJA: 9, ZONA: 10 };

const ESTATUS_INICIAL = "Hacer render";   // estatus con el que nace un pedido nuevo
const ESTATUS_ANCLA = /^imprimir/i;       // los pedidos nuevos se insertan DEBAJO de la última fila "Imprimir" (naranja)


const ESTATUS_PUBLICO = {
  "1. solicitudes / brief": "📝 Recibimos tu pedido",
  "2. en renders": "🎨 Diseñando tu render",
  "3. revisión interna": "🎨 Diseñando tu render",
  "4. en revisión cliente": "👀 Tu render está listo — revísalo",
  "5. corrección requerida": "✏️ Ajustando tu diseño",
  "6. pre-prensa / suajes": "🖨️ Preparando producción",
  "7. en producción": "🏭 Fabricando tu exhibidor",
  "entregado": "✅ Entregado",
};

// ============ UTILIDADES BÁSICAS ============

function cfg(nombre) {
  const p = PropertiesService.getScriptProperties().getProperty(nombre);
  return (p && String(p).trim()) || String(CONFIG_LOCAL[nombre] || "").trim();
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecuta fn con candado, para que dos acciones simultáneas no se pisen ni dupliquen filas. */
function conCandado(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function validarClave(pw) {
  const cache = CacheService.getScriptCache();
  const fallos = parseInt(cache.get("FALLOS_CLAVE") || "0", 10);
  if (fallos >= 30) return jsonOutput({ ok: false, error: "Demasiados intentos. Espera 10 minutos." });
  const clave = cfg("CONTRASENA");
  if (!clave) return jsonOutput({ ok: false, error: "Falta configurar CONTRASENA en las propiedades del script." });
  if (String(pw || "") !== clave) {
    cache.put("FALLOS_CLAVE", String(fallos + 1), 600);
    return jsonOutput({ ok: false, error: "Contraseña incorrecta" });
  }
  return null;
}

function hojaProyectos() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('No se encontró la pestaña "' + SHEET_NAME + '"');
  return sh;
}

function normTxt(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ============ ENTRADAS (doPost / doGet) ============

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonOutput({ ok: false, error: "sin datos" });
    const body = JSON.parse(e.postData.contents);

    // PRODUCCIÓN (supervisora): módulo aparte, con su propio PIN (no usa la contraseña principal).
    if (body.modulo === "produccion") return prodDoPost(e);

    // Aviso (webhook) de ClickUp: trae "event" y "task_id". Solo relee la tarea en ClickUp, no confía en lo que llega.
    if (body.event && body.task_id) return manejarWebhookClickUp(body);

    // PÚBLICO con token propio por pedido: el cliente aprueba o corrige su render.
    if (body.accion === "respuestaRender") return responderRender(body);

    // Todo lo demás es INTERNO y exige la contraseña.
    const rechazo = validarClave(body.password);
    if (rechazo) return rechazo;

    switch (body.accion) {
      case "verificarConexion": return jsonOutput({ ok: true });
      case "crearPedido":       return crearPedido(body);
      case "buscarPedido":      return buscarPedidoPorCodigo(body.codigo);
      case "guardarCobro":      return guardarCobroEnFila(body.codigo, body.items, body.requiereFactura, body.notaNueva, body.promo);
      case "listarProyectos":   return listarProyectos();
      case "inventario":        return leerPestanaLaminas();
      case "ajustarInventario":
      case "usarHojas":
        return jsonOutput({ ok: false, error: "El conteo se cambia en la pestaña \"Láminas\" del Sheets." });
      case "enviarRender":      return enviarRender(body.codigo, body.linkRender);
      case "fotosProduccion":   return jsonOutput(prodFotosPanel_(body.codigo));
      case "produccionResumen": return jsonOutput(prodResumenPanel_());
    }
    // Compatibilidad: el panel antiguo mandaba el pedido sin "accion".
    if (!body.accion && body.order) return crearPedido(body);
    return jsonOutput({ ok: false, error: "Acción no reconocida: " + body.accion });
  } catch (err) {
    Logger.log("ERROR doPost: " + String(err));
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// Mensaje que ve el cliente según el ESTATUS de Sheets (clave = estatus sin acentos, en minúsculas)
const ESTATUS_PUBLICO_SHEETS = {
  "hacer render": "🎨 Diseñando tu render",
  "en revision": "👀 Tu render está listo — revísalo",
  "corregir render": "✏️ Ajustando tu diseño",
  "imprimir": "🏭 Fabricando tu exhibidor",
  "repetir": "🏭 Fabricando tu exhibidor",
  "enviar": "📦 Tu pedido está listo",
  "enviado": "🚚 Tu pedido va en camino",
  "entregado": "✅ Entregado",
};

/** GET público: portal del cliente (?codigo=) y página de aprobación de render (?render=&t=). */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.render) return obtenerRenderPublico(p.render, p.t || "");

    const codigo = String(p.codigo || "").trim().toUpperCase();
    if (!codigo) return jsonOutput({ ok: false, error: "Falta el código de seguimiento" });

    const datos = leerSeguimiento(codigo);
    if (!datos) return jsonOutput({ ok: false, error: "No encontramos un pedido con ese código" });

    // El estatus se lee del Sheets (columna ESTATUS de la fila del pedido).
    const sh = hojaProyectos();
    const loc = localizarFila(sh, codigo, datos);
    if (!loc.fila) return jsonOutput({ ok: true, cliente: datos.cliente, estatus: "📦 En proceso", fechaEstimada: null });

    const estSheet = String(sh.getRange(loc.fila, COL.ESTATUS + 1).getDisplayValue() || "").trim();
    const clave = normTxt(estSheet);
    const estatusPublico = ESTATUS_PUBLICO_SHEETS[clave] || "📦 En proceso";

    // Fecha estimada: columna FECHA LÍMITE (si está vacía o dice N/A, no se muestra).
    let fecha = String(sh.getRange(loc.fila, COL.FECHA_LIMITE + 1).getDisplayValue() || "").trim();
    if (!fecha || /^n\/?a$/i.test(fecha)) fecha = null;

    // "extras" (botón de aprobar render, recompra) usan el mismo criterio de antes.
    const estInterno = clave === "en revision" ? "en revisión cliente" : clave;
    return jsonOutput(Object.assign({
      ok: true, cliente: datos.cliente, estatus: estatusPublico, fechaEstimada: fecha,
    }, extrasSeguimientoPublico(codigo, datos, estInterno)));
  } catch (err) {
    Logger.log("ERROR doGet: " + String(err));
    return jsonOutput({ ok: false, error: String(err) });
  }
}

/** Ejecutar una vez, justo después de renombrar los estatus en ClickUp. */
function limpiarCacheEstatus() {
  CacheService.getScriptCache().remove("ESTATUS_CLICKUP");
}

// ============ SEGUIMIENTO (Script Properties) ============

function leerSeguimiento(codigo) {
  const reg = PropertiesService.getScriptProperties().getProperty("SEGUIMIENTO_" + codigo);
  return reg ? JSON.parse(reg) : null;
}

function guardarSeguimientoDatos(codigo, datos) {
  PropertiesService.getScriptProperties().setProperty("SEGUIMIENTO_" + codigo, JSON.stringify(datos));
}

/** Código corto para compartir por WhatsApp, ej. "JD-4X7K2". Nunca repite uno existente. */
function crearCodigoSeguimiento() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I
  const props = PropertiesService.getScriptProperties();
  let codigo;
  do {
    codigo = "JD-";
    for (let i = 0; i < 5; i++) codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  } while (props.getProperty("SEGUIMIENTO_" + codigo));
  return codigo;
}

// ============ LOCALIZAR FILAS POR CÓDIGO (el corazón de la corrección) ============

function notaTieneCodigo(nota, codigo) {
  return new RegExp("Código de seguimiento:\\s*" + codigo + "(?![A-Za-z0-9])").test(String(nota || ""));
}

/**
 * Devuelve { fila, repetidos } con la fila ACTUAL del pedido, buscándolo por el
 * código guardado en la nota de la columna A. "datos.filaSheets" solo se usa como
 * pista rápida y se corrige solo si la fila cambió de lugar.
 */
function localizarFila(sheet, codigo, datos) {
  const ult = sheet.getLastRow();
  if (ult < 1) return { fila: 0, repetidos: 0 };
  const pista = datos && datos.filaSheets ? parseInt(datos.filaSheets, 10) : 0;
  if (pista > 0 && pista <= ult && notaTieneCodigo(sheet.getRange(pista, 1).getNote(), codigo)) {
    return { fila: pista, repetidos: 1 };
  }
  const notas = sheet.getRange(1, 1, ult, 1).getNotes();
  const hallados = [];
  for (let i = 0; i < notas.length; i++) if (notaTieneCodigo(notas[i][0], codigo)) hallados.push(i + 1);
  if (hallados.length === 0) return { fila: 0, repetidos: 0 };

  let fila = hallados[0];
  if (hallados.length > 1 && datos && datos.cliente) {
    // Si el código quedó repetido (por copiar y pegar filas), gana la que tiene el nombre del cliente.
    for (let k = 0; k < hallados.length; k++) {
      if (normTxt(sheet.getRange(hallados[k], 1).getValue()) === normTxt(datos.cliente)) { fila = hallados[k]; break; }
    }
  }
  if (datos && datos.filaSheets !== fila) {          // autocorrección de la pista
    datos.filaSheets = fila;
    try { guardarSeguimientoDatos(codigo, datos); } catch (e) { /* no es crítico */ }
  }
  return { fila: fila, repetidos: hallados.length };
}

function codigoDeNota(nota) {
  const m = String(nota || "").match(/Código de seguimiento:\s*(JD-[A-Za-z0-9]+)/);
  return m ? m[1].toUpperCase() : "";
}

function lineaDeNota(nota, prefijo) {
  const lineas = String(nota || "").split("\n");
  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i].indexOf(prefijo) === 0) return lineas[i].substring(prefijo.length).trim();
  }
  return "";
}

// ============ TEXTOS DE LA FILA (Tipo, Cantidad, Grosor) ============

const esEnvio = (it) => /^env[ií]o/i.test(String((it && it.modelo) || ""));

function normalizarItems(order) {
  let crudos = Array.isArray(order.items) ? order.items : [];
  if (crudos.length === 0 && order.modelo) {
    crudos = [{ modelo: order.modelo, medidas: order.medidas, cantidad: order.cantidad,
      grosor: order.grosor, precioUnitario: order.precioUnitario }];
  }
  return crudos.map(it => ({
    modelo: String(it.modelo || "").trim() || "Diseño personalizado",
    medidas: String(it.medidas || "").trim(),
    cantidad: Math.max(1, parseInt(it.cantidad, 10) || 1),
    grosor: String(it.grosor || "4 mm").trim(),
    precioUnitario: parseFloat(it.precioUnitario) || 0,
    personalizado: !!it.personalizado,
    hpPorPieza: it.hpPorPieza ? parseFloat(it.hpPorPieza) : null,
  }));
}

const soloProductos = (items) => items.filter(it => !esEnvio(it));

function totalPedido(items) {
  return items.reduce((sum, it) => sum + it.precioUnitario * it.cantidad, 0);
}

/** Nombre para ClickUp (conserva la descripción del personalizado, p. ej. "Exhibidor botanas personalizado"). */
function nombreDeItem(it) {
  if (it.personalizado) return /personalizad/i.test(it.modelo) ? it.modelo : it.modelo + " personalizado";
  return nombreSheet(it.modelo);
}

/** Nombre de un modelo de catálogo tal como se escribe en la columna TIPO (guion simple, sin "1 nivel" en Display box). */
function nombreSheet(modelo) {
  let n = String(modelo || "").replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();
  if (/^display box - 1 nivel$/i.test(n)) n = "Display box";
  if (/^pegboard display con ganchos$/i.test(n)) n = "Pegboard display";
  return n;
}

/**
 * Cómo se escribe UN producto en la columna TIPO:
 *  - catálogo:     "Floor stand - 3 niveles", "Display box"   (sin medidas)
 *  - personalizado: "Personalizado (120 x 50 x 30 cm, 3 niveles)"  (nunca "Floor stand personalizado")
 */
function textoItem(it) {
  if (it.personalizado || /personalizad/i.test(it.modelo)) {
    const med = it.medidas && it.medidas !== "a definir" ? " (" + it.medidas + ")" : "";
    return "Personalizado" + med;
  }
  return nombreSheet(it.modelo);
}

/**
 * Columna TIPO, igual que lo escribes a mano: "Floor stand - 3 niveles + POP display chico - 2 niveles"
 * (las cantidades van en la columna CANTIDAD, en el mismo orden). El envío se anota como "Envío".
 */
function textoTipo(items) {
  const partes = soloProductos(items).map(textoItem);
  if (items.some(esEnvio)) partes.push("Envío");
  return partes.join(" + ");
}

/** Columna CANTIDAD: "5 pzs", "1 pz", "3 y 2 pzs". */
function textoCantidad(items) {
  const nums = soloProductos(items).map(it => it.cantidad);
  if (nums.length === 0) return "";
  const ultimo = nums[nums.length - 1];
  const lista = nums.length === 1 ? String(ultimo) : nums.slice(0, -1).join(", ") + " y " + ultimo;
  return lista + (ultimo === 1 ? " pz" : " pzs");
}

/** Columna GROSOR: "4 mm" o, si se mezclan, "5 y 4 mm". */
function textoGrosor(items) {
  const vistos = [];
  soloProductos(items).forEach(it => {
    const n = String(it.grosor).replace(/\s*mm\s*$/i, "").trim();
    if (vistos.indexOf(n) === -1) vistos.push(n);
  });
  return (vistos.join(" y ") || "4") + " mm";
}

const normGrosor = (g) => {
  const m = String(g || "").match(/\d+(?:[.,]\d+)?/);
  return (m ? m[0].replace(",", ".") : "4") + " mm";
};

/** Firma de lo que importa de los productos (para saber si de verdad cambiaron). */
function firmaItems(items) {
  return soloProductos(items).map(it => [textoItem(it), it.cantidad, normGrosor(it.grosor)].join("|")).join("¦");
}

// ============ LÁMINAS: ESTIMACIÓN POR PEDIDO ============
// La columna % DE LÁMINA dice cuántas láminas usará cada pedido (1.5 = lámina y media).
//  - El sistema la llena en GRIS cuando está vacía (al registrar, cotizar o editar Tipo/Cantidad/Grosor).
//  - Si tú escribes otro número, se pone en NEGRO y el sistema ya no lo vuelve a tocar.
//  - Si la borras, el sistema la vuelve a calcular.
//  - Pedido con dos grosores: se escribe así  "4 mm: 1.5 · 5 mm: 2".
// La pestaña "Láminas" suma solo los pedidos en "Imprimir" (es una fórmula: nunca cuenta doble).

const COLOR_AUTO = "#999999";

// Cuántas piezas de cada modelo caben en UNA lámina (dato de taller, de la antigua pestaña Catálogo_Muebles).
const RENDIMIENTO_POR_LAMINA = {
  "Mini Display": 40,
  "Counter display compacto con organizador": 12,
  "Display con separadores": 8,
  "Pegboard display": 5,
  "Display box": 5,
  "Display escalonado - 2 escalones": 3,
  "Display escalonado - 3 escalones": 3.5,
  "POP display chico - 2 niveles": 2.5,
  "POP display - 2 niveles": 2.5,
  "POP display - 3 niveles": 1.5,
  "Display con repisas": 1.5,
  "Floor stand - 3 niveles": 1,
  "Floor stand chico - 3 niveles": 1,
  "Floor stand con ganchos": 1,
  "Floor stand - 4 niveles": 0.75,
  "Floor stand - 5 niveles": 0.5,
  // Navidad (nov 2026)
  "Display box árbol": 5,
  "Floor stand árbol - 3 niveles": 1,
  "Isla árbol - 4 niveles": 1,
};

const claveModelo = (s) => String(s || "").toLowerCase().replace(/[—–-]/g, " ").replace(/\s+/g, " ").trim();

function buscarRendimiento(modelo) {
  const nombre = String(modelo || "").trim();
  if (!nombre || /personalizad/i.test(nombre)) return undefined;
  const n = claveModelo(nombre.replace(/\([^)]*\)/g, ""));
  for (const llave in RENDIMIENTO_POR_LAMINA) if (claveModelo(llave) === n) return RENDIMIENTO_POR_LAMINA[llave];
  if (n.length < 8) return undefined;
  for (const llave in RENDIMIENTO_POR_LAMINA) {
    const l = claveModelo(llave);
    if (l.indexOf(n) === 0 || n.indexOf(l) === 0) return RENDIMIENTO_POR_LAMINA[llave];
  }
  return undefined;
}

/**
 * Láminas por pieza de un personalizado a partir de sus medidas. MISMA lógica que la hoja "Cotización Personalizada"
 * (y que calcPersonalizado de joart-core.js; si cambian las fórmulas o parámetros de la hoja, cambiarlos en los dos).
 * Textos que entiende: "120 x 50 x 30 cm, 3 niveles" · "..., 3 niveles, 2 rejillas" · "..., 3 escalones[, 6 soportes]" ·
 * "..., 2 separadores" · "120 x 10 cm, tira".
 */
const PARAMS_PERS = { areaUtil: 26000, hojaLargo: 243, hojaAncho: 121, grosor: 0.4, letrero: 5, frenteLateral: 6.5, holguraRejilla: 0.8, copete: 21, alturaEscalones: 20, soportesDesde: 3, pesoSoportes: 0.5 };
function hpDesdeMedidas(med) {
  const P = PARAMS_PERS, txt = String(med || "").replace(/,(\d)/g, ".$1");
  const num = "(\\d+(?:\\.\\d+)?)";
  const m3 = txt.match(new RegExp(num + "\\s*[x×]\\s*" + num + "\\s*[x×]\\s*" + num, "i"));
  const m2 = txt.match(new RegExp(num + "\\s*[x×]\\s*" + num + "\\s*(?:cm)?\\s*,?\\s*tira", "i"));
  const low = txt.toLowerCase();
  let tipo = "niveles", N = 1, opc = null;
  const mn = low.match(/(\d+)\s*(nivel|charola|escal|separador|division)/);
  if (mn) { N = Math.max(1, parseInt(mn[1], 10) || 1); tipo = /escal/.test(mn[2]) ? "escalonado" : /separador|division/.test(mn[2]) ? "separadores" : "niveles"; }
  const rj = low.match(/(\d+)\s*rejilla/), so = low.match(/(\d+)\s*soporte/);
  if (rj) { tipo = "rejilla"; opc = parseInt(rj[1], 10); } else if (so && tipo === "escalonado") opc = parseInt(so[1], 10);
  if (/con rejilla/.test(low) && tipo === "niveles") tipo = "rejilla";
  let HPbase;
  if (m2 && !m3) {
    const A = parseFloat(m2[1]), W = parseFloat(m2[2]);
    const k = Math.max(Math.floor(P.hojaLargo / A) * Math.floor(P.hojaAncho / W), Math.floor(P.hojaLargo / W) * Math.floor(P.hojaAncho / A));
    if (!(A > 0 && W > 0) || k === 0) return null;
    HPbase = 1 / k;
  } else {
    if (!m3) return null;
    const A = parseFloat(m3[1]), W = parseFloat(m3[2]), D = parseFloat(m3[3]);
    let area = A * W, lat, bas, let_, sop;
    if (tipo === "separadores") {
      const ns = opc === null ? N : opc;   // en "N separadores" el número ES la cantidad de separadores
      lat = D * (A + P.frenteLateral); bas = W * D; let_ = W * P.letrero;
      sop = ns * (D - P.grosor) * (A - P.grosor + P.frenteLateral) / 2;
    } else if (tipo === "escalonado") {
      const ns = opc === null ? (N >= P.soportesDesde ? N * (N + 1) / 2 : 0) : opc;
      lat = 2 * D * Math.max(A - P.copete, 0); bas = W * D * (N + 2) / 2;
      let_ = W * (P.alturaEscalones - P.grosor * N) + W * P.letrero;
      sop = ns * W * (P.alturaEscalones / N - P.grosor) * P.pesoSoportes;
    } else {
      const rej = tipo === "rejilla" ? (opc === null ? 1 : opc) : 0;
      lat = 2 * A * D; bas = N * W * D + (rej ? rej * (W - P.holguraRejilla) * (D - P.holguraRejilla) : 0);
      let_ = N * W * 5; sop = N < 2 ? 0 : (N - 1) * 2 * W * 3;
    }
    HPbase = (area + lat + bas + let_ + sop) / P.areaUtil;
  }
  return (HPbase >= 0.8 && HPbase < 1) ? 1 : HPbase;
}

/** Láminas por grosor de una lista de productos: { "4 mm": 1.5, "5 mm": 2 }. */
function laminasPorGrosor(items) {
  const porGrosor = {};
  soloProductos(items).forEach(it => {
    let hojas = null;
    const rend = buscarRendimiento(it.modelo);
    if (rend) hojas = it.cantidad / rend;
    else {
      const hp = it.hpPorPieza || hpDesdeMedidas(it.medidas || it.modelo);
      if (hp) hojas = hp * it.cantidad;
    }
    if (hojas !== null) {
      const g = normGrosor(it.grosor);
      porGrosor[g] = (porGrosor[g] || 0) + hojas;
    }
  });
  return porGrosor;
}

/** Lo que va en la celda: un número si es un solo grosor; "4 mm: 1.5 · 5 mm: 2" si son varios. "" si no se pudo. */
function valorLaminas(porGrosor) {
  const gs = Object.keys(porGrosor);
  const r = (x) => Math.round(x * 100) / 100;
  if (gs.length === 0) return "";
  if (gs.length === 1) return r(porGrosor[gs[0]]);
  return gs.map(g => g + ": " + r(porGrosor[g])).join(" · ");
}

/** Productos a partir del TEXTO de una fila (Tipo / Cantidad / Grosor). */
function itemsDesdeTexto(tipoTexto, cantidadTexto, grosorTexto) {
  const partes = String(tipoTexto || "").split(/\s\+\s/).map(p => p.trim()).filter(Boolean)
    .filter(p => !/^env[ií]o/i.test(p));
  const nums = (String(cantidadTexto || "").match(/\d+/g) || []).map(n => parseInt(n, 10));
  const grosores = (String(grosorTexto || "4 mm").match(/\d+(?:[.,]\d+)?/g) || ["4"]).map(g => g.replace(",", ".") + " mm");
  return partes.map((linea, idx) => {
    const medM = linea.match(/\(([^)]+)\)\s*$/);
    const sinMed = medM ? linea.substring(0, medM.index).trim() : linea;
    const pref = sinMed.match(/^(\d+)\s*x\s+(.+)$/i);
    let cantidad;
    if (pref) cantidad = parseInt(pref[1], 10);
    else if (partes.length === 1) cantidad = nums.length ? nums[0] : 1;
    else if (nums.length === partes.length) cantidad = nums[idx];
    else cantidad = 1;
    const esPers = /personalizad/i.test(sinMed);
    return { modelo: pref ? pref[2].trim() : (esPers ? "Personalizado" : sinMed), medidas: medM ? medM[1] : "", cantidad: cantidad,
      grosor: grosores.length === partes.length ? grosores[idx] : grosores[0],
      personalizado: esPers, hpPorPieza: null, precioUnitario: 0 };
  });
}

/** ¿La celda la escribió el sistema (gris) o está vacía? Entonces se puede recalcular. */
function laminasEsAuto(sheet, fila) {
  const c = sheet.getRange(fila, COL.PORC_HOJA + 1);
  if (String(c.getDisplayValue()).trim() === "") return true;
  return String(c.getFontColor() || "").toLowerCase() === COLOR_AUTO;
}

/** Escribe la estimación en GRIS (solo si la celda está vacía o ya era automática). */
function escribirLaminasAuto(sheet, fila, items) {
  if (!laminasEsAuto(sheet, fila)) return;
  const c = sheet.getRange(fila, COL.PORC_HOJA + 1);
  c.setValue(valorLaminas(laminasPorGrosor(items)));
  c.setFontColor(COLOR_AUTO);
}

/** Recalcula desde el texto de la fila (cuando editas Tipo / Cantidad / Grosor a mano). */
function recalcularLaminasFila(sheet, fila) {
  const r = sheet.getRange(fila, 1, 1, COL.ZONA + 1).getValues()[0];
  if (!String(r[COL.TIPO] || "").trim()) return;
  escribirLaminasAuto(sheet, fila, itemsDesdeTexto(r[COL.TIPO], r[COL.CANTIDAD], r[COL.GROSOR]));
}

// ============ CREAR PEDIDO (panel → Nuevo) ============

function guardarLogoEnDrive(logo, clienteNombre) {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
  const base64 = logo.contenido.split(",")[1];
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), logo.tipo, clienteNombre + " - " + logo.nombre);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function formatearFechaES(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return parseInt(m[3], 10) + " de " + MESES_ES[parseInt(m[2], 10) - 1];
}

function crearPedido(body) {
  const order = body.order;
  if (!order || !order.cliente) return jsonOutput({ ok: false, error: "pedido incompleto" });
  const items = normalizarItems(order);
  if (soloProductos(items).length === 0) return jsonOutput({ ok: false, error: "El pedido no tiene productos" });

  const idem = String(order.idem || body.idem || "").substring(0, 64);

  return conCandado(function () {
    const cache = CacheService.getScriptCache();
    // Anti-duplicado: si el mismo envío llega dos veces (doble toque), devuelve el primero.
    if (idem) {
      const previo = cache.get("IDEM_" + idem);
      if (previo) { const r = JSON.parse(previo); r.repetido = true; return jsonOutput(r); }
    }

    const logos = body.logos || (body.logo ? [body.logo] : []);
    const logoUrls = [];
    logos.slice(0, 5).forEach(function (logo) {
      if (logo && logo.contenido) {
        try { const url = guardarLogoEnDrive(logo, order.cliente); if (url) logoUrls.push(url); }
        catch (err) { Logger.log("Logo no guardado: " + String(err)); }
      }
    });

    const codigo = crearCodigoSeguimiento();
    const fila = escribirEnSheets(order, items, logoUrls, codigo);
    const clickup = crearTarjetaClickUp(order, items, logoUrls, codigo);

    guardarSeguimientoDatos(codigo, {
      taskId: clickup.taskId || null, cliente: order.cliente, filaSheets: fila, items: items,
      requiereFactura: !!order.requiereFactura, contacto: order.contacto || "", zona: order.zona || "",
      creado: new Date().toISOString(),
    });

    Logger.log("Pedido " + codigo + " para " + order.cliente + " en fila " + fila + " (ClickUp " + (clickup.ok ? "ok" : "falló") + ")");
    const salida = { ok: true, fila: fila, clickup: clickup, codigoSeguimiento: codigo, total: totalPedido(items) };
    if (idem) cache.put("IDEM_" + idem, JSON.stringify(salida), 600);
    return jsonOutput(salida);
  });
}

/**
 * Inserta una fila nueva JUSTO DEBAJO de la última fila "Imprimir" (naranja), para que el
 * pedido no quede enterrado al final entre los "En revisión". Si no hay filas "Imprimir",
 * va debajo de la última fila con datos. Siempre INSERTA (nunca pisa nada).
 */
function insertarFilaNueva(sheet) {
  const ult = sheet.getLastRow();
  const nCols = Math.max(sheet.getLastColumn(), 11);
  if (ult < 1) return 1;
  let ancla = 0, ultimaConDatos = 1;
  let plantilla = 0;
  if (ult >= 2) {
    const datos = sheet.getRange(1, 1, ult, COL.ESTATUS + 1).getValues();
    for (let i = 1; i < datos.length; i++) {
      const neg = String(datos[i][COL.NEGOCIO] || "").trim();
      if (!neg || /^(negocio|cliente)$/i.test(neg)) continue;
      ultimaConDatos = i + 1;
      if (ESTATUS_ANCLA.test(String(datos[i][COL.ESTATUS] || "").trim())) ancla = i + 1;
    }
    const pos0 = ancla || ultimaConDatos;
    // Plantilla de formato: la primera fila "Hacer render" debajo del ancla.
    for (let i = pos0; i < datos.length; i++) {
      if (/^hacer render/i.test(String(datos[i][COL.ESTATUS] || "").trim()) && String(datos[i][COL.NEGOCIO] || "").trim()) { plantilla = i + 1; break; }
    }
  }
  const pos = ancla || ultimaConDatos;
  sheet.insertRowAfter(pos);
  const nueva = pos + 1;
  try {
    const destino = sheet.getRange(nueva, 1, 1, nCols);
    const origen = plantilla ? sheet.getRange(plantilla + 1, 1, 1, nCols) : sheet.getRange(pos, 1, 1, nCols); // +1 porque la inserción movió las filas de abajo
    origen.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    origen.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    if (!plantilla) { destino.setBackground(null); destino.setFontColor(null); }   // que no herede el naranja
  } catch (err) { Logger.log("Formato de fila nueva: " + String(err)); }
  return nueva;
}

function escribirEnSheets(order, items, logoUrls, codigo) {
  const sheet = hojaProyectos();
  const filaNum = insertarFilaNueva(sheet);
  const total = totalPedido(items);

  sheet.getRange(filaNum, 1, 1, 11).setValues([[
    order.cliente,
    textoTipo(items),
    textoCantidad(items),
    total > 0 ? total : "",
    textoGrosor(items),
    order.requiereFactura ? "Sí" : "No",
    ESTATUS_INICIAL,
    formatearFechaES(order.fechaLimite),
    "0%",
    "",
    order.zona || "",
  ]]);

  const nota = ["Código de seguimiento: " + codigo];
  if (order.contacto) nota.push("Contacto: " + order.contacto);
  (logoUrls || []).forEach((url, i) => nota.push("Logo " + (i + 1) + ": " + url));
  if (order.notas && order.notas !== "sin notas") nota.push("Notas: " + order.notas);
  sheet.getRange(filaNum, 1).setNote(nota.join("\n"));
  escribirLaminasAuto(sheet, filaNum, items);

  return filaNum;
}

function crearTarjetaClickUp(order, items, logoUrls, codigo) {
  const token = cfg("CLICKUP_API_TOKEN"), lista = cfg("CLICKUP_LIST_ID");
  if (!token || !lista) return { ok: false, motivo: "omitido: falta configurar ClickUp" };

  const desc = [];
  soloProductos(items).forEach(it => {
    const pers = it.personalizado || /personalizad/i.test(it.modelo);
    const med = pers && it.medidas && it.medidas !== "a definir" ? " — " + it.medidas : "";
    desc.push("• " + it.cantidad + " pz · " + nombreDeItem(it) + med + " · " + it.grosor);
  });
  if (order.notas && order.notas !== "sin notas") desc.push("", "Notas: " + order.notas);
  if (logoUrls && logoUrls.length > 0) logoUrls.forEach((url, i) => desc.push("Logo " + (i + 1) + ": " + url));
  else desc.push("", "Logo: el cliente lo mandará por WhatsApp.");

  const payload = { name: order.cliente, description: desc.join("\n") };
  const m = String(order.fechaLimite || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    payload.due_date = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0).getTime();
    payload.due_date_time = false;
  }

  const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/list/" + lista + "/task", {
    method: "post", contentType: "application/json", headers: { Authorization: token },
    payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) return { ok: false, motivo: "código " + r.getResponseCode() + ": " + r.getContentText().substring(0, 200) };
  return { ok: true, taskId: JSON.parse(r.getContentText()).id };
}

// ============ ABRIR / ACTUALIZAR UN PEDIDO (panel → Proyectos) ============

/** Reconstruye productos desde el texto de la fila (pedidos viejos sin registro). */
function itemsDesdeFila(fila) {
  const tipoTexto = String(fila[COL.TIPO] || "");
  const precioTotal = parseFloat(fila[COL.PRECIO]) || 0;
  const nums = (String(fila[COL.CANTIDAD] || "").match(/\d+/g) || []).map(n => parseInt(n, 10));
  const partes = tipoTexto.split(/\s\+\s/).map(p => p.trim()).filter(Boolean).filter(p => !/^env[ií]o/i.test(p));
  const grosores = (String(fila[COL.GROSOR] || "4 mm").match(/\d+(?:[.,]\d+)?/g) || ["4"]).map(g => g.replace(",", ".") + " mm");
  return partes.map((linea, idx) => {
    const medM = linea.match(/\(([^)]+)\)\s*$/);
    const sinMed = medM ? linea.substring(0, medM.index).trim() : linea;
    const pref = sinMed.match(/^(\d+)\s*x\s+(.+)$/i);
    const cantidad = pref ? parseInt(pref[1], 10) : (partes.length === 1 ? (nums[0] || 1) : (nums.length === partes.length ? nums[idx] : 1));
    return {
      modelo: pref ? pref[2].trim() : sinMed, medidas: medM ? medM[1] : "", cantidad: cantidad,
      grosor: grosores.length === partes.length ? grosores[idx] : grosores[0],
      precioUnitario: partes.length === 1 && precioTotal > 0 ? Math.round(precioTotal / cantidad) : 0,
      personalizado: /personalizad/i.test(sinMed), hpPorPieza: null,
    };
  });
}

function buscarPedidoPorCodigo(codigoCrudo) {
  try {
    const codigo = String(codigoCrudo || "").trim().toUpperCase();
    if (!codigo) return jsonOutput({ ok: false, error: "Falta el código" });
    const datos = leerSeguimiento(codigo) || {};
    const sheet = hojaProyectos();
    const loc = localizarFila(sheet, codigo, datos.cliente ? datos : null);
    if (!loc.fila) return jsonOutput({ ok: false, error: "No encontré " + codigo + " en la hoja \"" + SHEET_NAME + "\". ¿Se borró la fila o su nota de la columna A?" });

    const fila = sheet.getRange(loc.fila, 1, 1, 11).getValues()[0];
    const nota = sheet.getRange(loc.fila, 1).getNote();
    const precioTotal = parseFloat(fila[COL.PRECIO]) || 0;

    let items = datos.items && datos.items.length ? datos.items : itemsDesdeFila(fila);
    const envios = items.filter(esEnvio);

    // ¿Alguien cambió la cantidad directo en el Sheets después de registrar?
    let desfase = "";
    const cantSheet = (String(fila[COL.CANTIDAD] || "").match(/\d+/g) || []).reduce((s, n) => s + parseInt(n, 10), 0);
    const cantReg = soloProductos(items).reduce((s, it) => s + it.cantidad, 0);
    if (datos.items && cantSheet && cantSheet !== cantReg) {
      desfase = "La hoja dice " + String(fila[COL.CANTIDAD]).trim() + " pero lo registrado suma " + cantReg + " pz. Revisa cuál es el correcto al cotizar.";
    }

    return jsonOutput({
      ok: true, codigo: codigo, fila: loc.fila,
      cliente: String(fila[COL.NEGOCIO] || datos.cliente || ""),
      items: items, requiereFactura: String(fila[COL.FACTURA] || "").trim() === "Sí" || (!fila[COL.FACTURA] && !!datos.requiereFactura),
      precioTotal: precioTotal, contacto: datos.contacto || lineaDeNota(nota, "Contacto:"),
      notas: lineaDeNota(nota, "Notas:"), estatus: String(fila[COL.ESTATUS] || ""),
      pagado: String(fila[COL.PAGADO] || ""), zona: String(fila[COL.ZONA] || datos.zona || ""),
      desfase: desfase, repetido: loc.repetidos > 1,
      tieneEnvio: envios.length > 0,
      promo: datos.promo || null,
    });
  } catch (err) {
    Logger.log("ERROR buscarPedidoPorCodigo: " + String(err));
    return jsonOutput({ ok: false, error: String(err) });
  }
}

/**
 * Guarda precios y factura en la MISMA fila (la encuentra por código). Si cambiaron los
 * productos (cantidad, modelo, medidas, grosor) también actualiza Tipo / Cantidad / Grosor.
 * Nunca toca Estatus, Pagado, Fecha límite ni Zona. Nunca agrega filas.
 */
function guardarCobroEnFila(codigoCrudo, itemsNuevos, requiereFactura, notaNueva, promoCruda) {
  try {
    const codigo = String(codigoCrudo || "").trim().toUpperCase();
    const items = normalizarItems({ items: itemsNuevos });
    if (soloProductos(items).length === 0) return jsonOutput({ ok: false, error: "No llegaron productos para cobrar" });

    return conCandado(function () {
      const props = leerSeguimiento(codigo);
      const sheet = hojaProyectos();
      const loc = localizarFila(sheet, codigo, props);
      if (!loc.fila) return jsonOutput({ ok: false, error: "No encontré " + codigo + " en la hoja; no guardé nada." });

      const promo = normalizarPromo(promoCruda);
      let total = Math.round(totalPedido(items) * 100) / 100;
      // Con descuento, el total que calculó el panel es en pesos exactos; los precios por pieza (a centavos) pueden desviarse unos centavos.
      if (promo && promo.total > 0 && Math.abs(total - promo.total) < 1) total = promo.total;
      const filaActual = sheet.getRange(loc.fila, 1, 1, 11).getValues()[0];
      sheet.getRange(loc.fila, COL.PRECIO + 1).setValue(total > 0 ? total : "");
      sheet.getRange(loc.fila, COL.FACTURA + 1).setValue(requiereFactura ? "Sí" : "No");

      const anteriores = props && props.items ? props.items : itemsDesdeFila(filaActual);
      const cambioProductos = firmaItems(anteriores) !== firmaItems(items);
      let actualizoProductos = false;
      if (cambioProductos) {
        sheet.getRange(loc.fila, COL.TIPO + 1).setValue(textoTipo(items));
        sheet.getRange(loc.fila, COL.CANTIDAD + 1).setValue(textoCantidad(items));
        sheet.getRange(loc.fila, COL.GROSOR + 1).setValue(textoGrosor(items));
        actualizoProductos = true;
      } else if (!props || !props.items) {
        // primera vez que se guarda un pedido viejo: solo para tener el respaldo de productos
      }

      escribirLaminasAuto(sheet, loc.fila, items);   // solo si está vacía o era automática (gris)

      const nuevo = Object.assign({}, props || { cliente: String(filaActual[COL.NEGOCIO] || "") });
      nuevo.items = items;
      nuevo.requiereFactura = !!requiereFactura;
      nuevo.filaSheets = loc.fila;
      if (promo) nuevo.promo = promo; else delete nuevo.promo;
      guardarSeguimientoDatos(codigo, nuevo);

      // Días de Descuento: renglón "Promo:" en la nota de la celda A y en la descripción de la tarjeta de ClickUp
      // (se reemplaza si cambia y se quita si ya no hay promoción). Sheets manda; ClickUp es informativo.
      const textoPromo = textoPromoLinea(promo);
      fijarLineaEnCelda(sheet, loc.fila, "Promo:", textoPromo);
      const promoClickUp = fijarLineaClickUp(nuevo.taskId, "Promo:", textoPromo);

      const nota = String(notaNueva || "").replace(/\s*\n\s*/g, " ").trim().substring(0, 1000);
      let notaGuardada = false, notaClickUp = false;
      if (nota) {
        agregarNotaEnCelda(sheet, loc.fila, nota); notaGuardada = true;
        notaClickUp = agregarNotaClickUp(nuevo.taskId, nota);
      }

      return jsonOutput({ ok: true, total: total, fila: loc.fila, actualizoProductos: actualizoProductos, notaGuardada: notaGuardada, notaClickUp: notaClickUp, promo: promo ? promo.opcion : "", promoClickUp: promoClickUp });
    });
  } catch (err) {
    Logger.log("ERROR guardarCobroEnFila: " + String(err));
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// ============ DÍAS DE DESCUENTO (promoción del buen fin 2026) ============
// Las reglas (fechas, mínimo $1,500, 15% o 3 MSI) y el cálculo viven en joart-core.js (aplicarPromo). Aquí solo se guarda
// lo que decidió el panel: opción elegida, descuento y totales, para que el equipo lo vea en Sheets y ClickUp y Mi pedido no se afecte.

/** Valida lo que manda el panel. Devuelve null si no hay promoción. */
function normalizarPromo(p) {
  if (!p || ["15", "msi"].indexOf(String(p.opcion)) < 0) return null;
  const num = (v) => Math.max(0, Math.round((parseFloat(v) || 0) * 100) / 100);
  return {
    opcion: String(p.opcion), texto: String(p.texto || "").substring(0, 80),
    descuento: p.opcion === "15" ? num(p.descuento) : 0,
    totalLista: num(p.totalLista), total: num(p.total),
    limite: String(p.limite || "").substring(0, 20),
  };
}

/** Texto del renglón "Promo:" ("" si no hay promoción). */
function textoPromoLinea(p) {
  if (!p) return "";
  const m = (n) => "$" + Math.round(n).toLocaleString("es-MX");
  const lim = p.limite ? " · anticipo y render aprobado antes del " + p.limite : "";
  if (p.opcion === "15") return "Días de Descuento: 15% (-" + m(p.descuento) + ") · lista " + m(p.totalLista) + " → total " + m(p.total) + lim;
  if (p.opcion === "msi") return "Días de Descuento: 3 meses sin intereses (sin descuento) · total " + m(p.total) + lim;
}

/** Pone, reemplaza o quita (texto "") el renglón que empieza con `prefijo` en la nota de la celda A. */
function fijarLineaEnCelda(sheet, fila, prefijo, texto) {
  const celda = sheet.getRange(fila, 1), lineas = String(celda.getNote() || "").split("\n");
  const i = lineas.findIndex(l => l.indexOf(prefijo) === 0);
  if (texto) { if (i >= 0) lineas[i] = prefijo + " " + texto; else lineas.push(prefijo + " " + texto); }
  else if (i >= 0) lineas.splice(i, 1);
  celda.setNote(lineas.join("\n"));
}

/** Igual, en la descripción de la tarjeta de ClickUp (antes de "Notas:" o de los logos). Devuelve true si quedó bien o no hacía falta. */
function fijarLineaClickUp(taskId, prefijo, texto) {
  try {
    if (!taskId || !cfg("CLICKUP_API_TOKEN")) return !texto;
    const tarea = obtenerTareaClickUp(taskId);
    if (!tarea) return false;
    const lineas = String(tarea.text_content || tarea.description || "").split("\n");
    const i = lineas.findIndex(l => l.indexOf(prefijo) === 0);
    if (i < 0 && !texto) return true;                       // nada que quitar
    if (i >= 0 && lineas[i] === prefijo + " " + texto) return true;   // ya está igual
    if (i >= 0) { if (texto) lineas[i] = prefijo + " " + texto; else lineas.splice(i, 1); }
    else {
      let j = lineas.findIndex(l => /^(Notas:|Logo)/.test(l));
      if (j < 0) j = lineas.length;
      const nuevas = [prefijo + " " + texto];
      if (j > 0 && String(lineas[j - 1]).trim() !== "") nuevas.unshift("");
      lineas.splice.apply(lineas, [j, 0].concat(nuevas));
    }
    const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/task/" + taskId, {
      method: "put", contentType: "application/json", headers: { Authorization: cfg("CLICKUP_API_TOKEN") },
      payload: JSON.stringify({ description: lineas.join("\n") }), muteHttpExceptions: true,
    });
    return r.getResponseCode() === 200;
  } catch (err) { Logger.log("Promo no actualizada en ClickUp: " + String(err)); return false; }
}

/** Agrega una nota al renglón "Notas:" de la nota de la celda A (o lo crea). */
function agregarNotaEnCelda(sheet, fila, nota) {
  const celda = sheet.getRange(fila, 1), lineas = String(celda.getNote() || "").split("\n");
  let i = -1;
  for (let k = 0; k < lineas.length; k++) if (lineas[k].indexOf("Notas:") === 0) { i = k; break; }
  if (i >= 0) lineas[i] = lineas[i] + " | " + nota; else lineas.push("Notas: " + nota);
  celda.setNote(lineas.join("\n"));
}

/** Agrega la nota a la descripción de la tarjeta (junto a "Notas:", o antes de los logos). */
function agregarNotaClickUp(taskId, nota) {
  try {
    if (!taskId || !cfg("CLICKUP_API_TOKEN")) return false;
    const tarea = obtenerTareaClickUp(taskId);
    if (!tarea) return false;
    const lineas = String(tarea.text_content || tarea.description || "").split("\n");
    let i = -1;
    for (let k = 0; k < lineas.length; k++) if (lineas[k].indexOf("Notas:") === 0) { i = k; break; }
    if (i >= 0) lineas[i] = lineas[i] + " | " + nota;
    else {
      let j = lineas.findIndex(l => /^Logo/.test(l));
      if (j < 0) j = lineas.length;
      const nuevas = ["Notas: " + nota];
      if (j > 0 && String(lineas[j - 1]).trim() !== "") nuevas.unshift("");
      lineas.splice.apply(lineas, [j, 0].concat(nuevas));
    }
    const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/task/" + taskId, {
      method: "put", contentType: "application/json", headers: { Authorization: cfg("CLICKUP_API_TOKEN") },
      payload: JSON.stringify({ description: lineas.join("\n") }), muteHttpExceptions: true,
    });
    return r.getResponseCode() === 200;
  } catch (err) { Logger.log("Nota no agregada en ClickUp: " + String(err)); return false; }
}

// ============ LISTA DE PROYECTOS (la usan el panel y el Asistente sin IA) ============

function listarProyectos() {
  try {
    const sheet = hojaProyectos();
    const ult = sheet.getLastRow();
    if (ult < 2) return jsonOutput({ ok: true, proyectos: [], generado: new Date().toISOString() });
    const vals = sheet.getRange(1, 1, ult, 11).getDisplayValues();
    const precios = sheet.getRange(1, COL.PRECIO + 1, ult, 1).getValues();
    const notas = sheet.getRange(1, 1, ult, 1).getNotes();

    const cuentaCodigos = {};
    notas.forEach(n => { const c = codigoDeNota(n[0]); if (c) cuentaCodigos[c] = (cuentaCodigos[c] || 0) + 1; });

    const proyectos = [];
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];
      const cliente = String(r[COL.NEGOCIO] || "").trim();
      if (!cliente || /^(negocio|cliente)$/i.test(cliente)) continue;
      const codigo = codigoDeNota(notas[i][0]);
      proyectos.push({
        fila: i + 1, codigo: codigo, repetido: codigo ? cuentaCodigos[codigo] > 1 : false,
        cliente: cliente, tipo: r[COL.TIPO], cantidad: r[COL.CANTIDAD],
        precio: parseFloat(precios[i][0]) || 0, grosor: r[COL.GROSOR], factura: r[COL.FACTURA],
        estatus: r[COL.ESTATUS], fechaLimite: r[COL.FECHA_LIMITE], pagado: r[COL.PAGADO],
        zona: r[COL.ZONA],
        contacto: lineaDeNota(notas[i][0], "Contacto:"), notas: lineaDeNota(notas[i][0], "Notas:"),
      });
    }
    return jsonOutput({ ok: true, proyectos: proyectos, generado: new Date().toISOString() });
  } catch (err) {
    Logger.log("ERROR listarProyectos: " + String(err));
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// ============ LÁMINAS: AL EDITAR ============
const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * Se ejecuta solo cada vez que alguien edita el Sheets (no hay que instalar nada):
 *  - Escribes en % DE LÁMINA       → se pone en negro y el sistema ya no lo toca. Si la borras, se recalcula.
 *  - Editas Tipo / Cantidad / Grosor → se recalcula % DE LÁMINA (solo si está en gris).
 *  - Escribes en "Tengo" (pestaña Láminas) → se anota la fecha del último conteo.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const rango = e.range, sheet = rango.getSheet(), nombre = sheet.getName();
    if (nombre === SHEET_LAMINAS) {
      if (rango.getRow() <= FILA_TENGO && rango.getLastRow() >= FILA_TENGO) {
        const d = new Date(), tz = Session.getScriptTimeZone();
        sheet.getRange(CELDA_ULTIMO_CONTEO).setValue(DIAS_ES[d.getDay()] + " " + d.getDate() + " de " + MESES_ES[d.getMonth()] +
          ", " + Utilities.formatDate(d, tz, "h:mm a").toLowerCase());
      }
      return;
    }
    if (nombre !== SHEET_NAME) return;
    const c1 = rango.getColumn() - 1, c2 = c1 + rango.getNumColumns() - 1;
    const f1 = Math.max(rango.getRow(), 2), f2 = rango.getLastRow();
    if (f2 < f1 || f2 - f1 > 60) return;
    const toca = (c) => c >= c1 && c <= c2;
    for (let f = f1; f <= f2; f++) {
      if (toca(COL.PORC_HOJA)) {
        const celda = sheet.getRange(f, COL.PORC_HOJA + 1);
        if (String(celda.getDisplayValue()).trim()) celda.setFontColor("#000000");
        else recalcularLaminasFila(sheet, f);
      } else if (toca(COL.TIPO) || toca(COL.CANTIDAD) || toca(COL.GROSOR)) {
        recalcularLaminasFila(sheet, f);
      }
    }
  } catch (err) {
    Logger.log("ERROR onEdit: " + String(err));
  }
}

/** Lo que dice la pestaña "Láminas" (Tengo / Necesito por grosor) para el panel y el asistente. */
function leerPestanaLaminas() {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LAMINAS);
    if (!sh) return jsonOutput({ ok: false, error: 'No encontré la pestaña "' + SHEET_LAMINAS + '".' });
    const filas = sh.getRange(FILA_TENGO - 1, 2, 3, 4).getValues();   // encabezado, Tengo, Necesito (columnas B:E)
    const inventario = [];
    for (let c = 0; c < filas[0].length; c++) {
      const grosor = String(filas[0][c] || "").trim();
      if (!grosor) continue;
      inventario.push({ grosor: grosor, laminas: parseFloat(filas[1][c]) || 0,
        enCola: Math.round((parseFloat(filas[2][c]) || 0) * 10) / 10 });
    }
    return jsonOutput({ ok: true, inventario: inventario, movimientos: [],
      ultimoConteo: String(sh.getRange(CELDA_ULTIMO_CONTEO).getDisplayValue() || "") });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// Se deja vacía a propósito: si todavía tienes el disparador "Al editar" apuntando aquí, no hace nada
// (el trabajo lo hace onEdit). Puedes borrar ese disparador en Apps Script → Activadores.
function onEditReservarLaminas(e) { /* ya no se usa */ }

/** Ejecútala UNA vez a mano: llena en gris % DE LÁMINA de los pedidos vivos que estén vacíos. */
function estimarLaminasPendientes() {
  const sheet = hojaProyectos();
  const ult = sheet.getLastRow();
  const vals = sheet.getRange(1, 1, ult, COL.ZONA + 1).getValues();
  let n = 0;
  for (let i = 1; i < vals.length; i++) {
    const est = normTxt(vals[i][COL.ESTATUS]);
    if (!est || ["enviar", "enviado", "entregado"].indexOf(est) > -1) continue;
    if (String(vals[i][COL.PORC_HOJA]).trim() !== "") continue;
    recalcularLaminasFila(sheet, i + 1); n++;
  }
  Logger.log("Filas estimadas: " + n);
}

// ============ CLICKUP ============

function obtenerTareaClickUp(taskId) {
  const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/task/" + taskId, {
    method: "get", headers: { Authorization: cfg("CLICKUP_API_TOKEN") }, muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) { Logger.log("ClickUp tarea: " + r.getContentText()); return null; }
  return JSON.parse(r.getContentText());
}

function estatusClickUpPorPatron(regex) {
  const cache = CacheService.getScriptCache();
  let lista = cache.get("ESTATUS_CLICKUP");
  if (!lista) {
    const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/list/" + cfg("CLICKUP_LIST_ID"), {
      method: "get", headers: { Authorization: cfg("CLICKUP_API_TOKEN") }, muteHttpExceptions: true,
    });
    lista = JSON.stringify((JSON.parse(r.getContentText()).statuses || []).map(s => s.status));
    cache.put("ESTATUS_CLICKUP", lista, 3600);
  }
  const nombres = JSON.parse(lista);
  for (let i = 0; i < nombres.length; i++) if (regex.test(nombres[i].toLowerCase())) return nombres[i];
  return null;
}

function cambiarEstatusClickUp(taskId, regex) {
  if (!taskId) return false;
  const nombre = estatusClickUpPorPatron(regex);
  if (!nombre) return false;
  const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/task/" + taskId, {
    method: "put", contentType: "application/json", headers: { Authorization: cfg("CLICKUP_API_TOKEN") },
    payload: JSON.stringify({ status: nombre }), muteHttpExceptions: true,
  });
  return r.getResponseCode() === 200;
}

function comentarClickUp(taskId, texto) {
  if (!taskId) return false;
  const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/task/" + taskId + "/comment", {
    method: "post", contentType: "application/json", headers: { Authorization: cfg("CLICKUP_API_TOKEN") },
    payload: JSON.stringify({ comment_text: texto }), muteHttpExceptions: true,
  });
  return r.getResponseCode() === 200;
}

/** Código del pedido a partir del id de su tarjeta de ClickUp (el registro guarda el taskId de cada pedido). */
function codigoPorTarea(taskId) {
  if (!taskId) return "";
  const cache = CacheService.getScriptCache(), clave = "TAREA_" + taskId;
  const previo = cache.get(clave);
  if (previo) return previo;
  const todo = PropertiesService.getScriptProperties().getProperties();
  for (const k in todo) {
    if (k.indexOf("SEGUIMIENTO_") !== 0) continue;
    try {
      const d = JSON.parse(todo[k]);
      if (d && d.taskId && String(d.taskId) === String(taskId)) { const c = k.substring(12); cache.put(clave, c, 21600); return c; }
    } catch (e) { /* registro ilegible: se salta */ }
  }
  return "";
}

/** ClickUp avisa cuando mueven una tarjeta → se actualiza el ESTATUS de SU fila (buscada por código). */
function manejarWebhookClickUp(body) {
  try {
    if (body.event !== "taskStatusUpdated") return jsonOutput({ ok: true, ignorado: true });
    const tarea = obtenerTareaClickUp(body.task_id);
    if (!tarea) return jsonOutput({ ok: false, error: "No se pudo leer la tarea desde ClickUp" });

    const desc = tarea.description || tarea.text_content || "";
    const m = desc.match(/Código de seguimiento:\s*(JD-\w+)/);   // tarjetas anteriores
    const codigo = m ? m[1].toUpperCase() : codigoPorTarea(body.task_id);
    if (!codigo) return jsonOutput({ ok: true, ignorado: true, motivo: "tarjeta sin pedido registrado" });
    const datos = leerSeguimiento(codigo);
    if (!datos) return jsonOutput({ ok: false, error: "Código no encontrado en el registro" });

    const estatusInterno = tarea.status ? tarea.status.status : "";
    const limpio = estatusInterno.replace(/^\d+\.\s*/, "");
    const sheet = hojaProyectos();
    const loc = localizarFila(sheet, codigo, datos);
    if (!loc.fila) return jsonOutput({ ok: true, ignorado: true, motivo: "sin fila en Sheets" });
    sheet.getRange(loc.fila, COL.ESTATUS + 1).setValue(limpio);
    return jsonOutput({ ok: true, codigo: codigo, estatus: limpio });
  } catch (err) {
    Logger.log("ERROR webhook: " + String(err));
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// ============ APROBACIÓN DE RENDER (público con token) ============

function enviarRender(codigo, linkRender) {
  try {
    codigo = String(codigo || "").trim().toUpperCase();
    const datos = leerSeguimiento(codigo);
    if (!datos) return jsonOutput({ ok: false, error: "No encontramos un pedido con ese código" });
    if (!/^https?:\/\//i.test(String(linkRender || ""))) return jsonOutput({ ok: false, error: "El link del render debe empezar con http" });
    const r = datos.render || { correcciones: 0, version: 0 };
    if (!r.token) r.token = Utilities.getUuid().replace(/-/g, "").substring(0, 16);
    r.url = String(linkRender).trim();
    r.version = (r.version || 0) + 1;
    r.enviadoEn = new Date().toISOString();
    r.aprobado = false;
    datos.render = r;
    guardarSeguimientoDatos(codigo, datos);

    comentarClickUp(datos.taskId, "🎨 Render v" + r.version + " enviado al cliente: " + r.url);
    cambiarEstatusClickUp(datos.taskId, /^\s*4\b|revisi[oó]n cliente/);

    const aprobarUrl = URL_BASE_WEB + "aprobar-render.html?c=" + encodeURIComponent(codigo) + "&t=" + r.token;
    const mensaje = "Hola " + String(datos.cliente || "").trim() + ", tu render 3D del pedido " + codigo +
      " está listo. Revísalo y apruébalo o pide ajustes aquí: " + aprobarUrl + "\nIncluye hasta " + MAX_CORRECCIONES + " correcciones sin costo.";
    let tel = String(datos.contacto || "").replace(/\D/g, "");
    if (tel.length === 10) tel = "52" + tel;
    return jsonOutput({ ok: true, aprobarUrl: aprobarUrl, mensaje: mensaje, version: r.version,
      waLink: "https://wa.me/" + (tel.length === 12 ? tel : "") + "?text=" + encodeURIComponent(mensaje) });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function obtenerRenderPublico(codigo, token) {
  const datos = leerSeguimiento(String(codigo || "").toUpperCase());
  if (!datos || !datos.render || !datos.render.token || datos.render.token !== token) {
    return jsonOutput({ ok: false, error: "Este link no es válido o ya venció." });
  }
  const r = datos.render;
  if (!r.url) return jsonOutput({ ok: false, error: "Tu render aún no está listo." });
  return jsonOutput({ ok: true, cliente: datos.cliente, renderUrl: r.url, version: r.version || 1,
    correcciones: r.correcciones || 0, max: MAX_CORRECCIONES, aprobado: !!r.aprobado });
}

function responderRender(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const codigo = String(body.codigo || "").toUpperCase();
    const datos = leerSeguimiento(codigo);
    if (!datos || !datos.render || datos.render.token !== body.token) return jsonOutput({ ok: false, error: "Este link no es válido o ya venció." });
    const r = datos.render;
    if (r.aprobado) return jsonOutput({ ok: true, yaAprobado: true });

    if (body.decision === "aprobar") {
      r.aprobado = true;
      r.aprobadoEn = new Date().toISOString();
      guardarSeguimientoDatos(codigo, datos);
      comentarClickUp(datos.taskId, "✅ El cliente APROBÓ el render v" + r.version + " (" +
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "d/MM/yyyy HH:mm") + "). Correcciones usadas: " + (r.correcciones || 0) + ".");
      cambiarEstatusClickUp(datos.taskId, /^\s*6\b|pre-?prensa/);
      copiarRenderAprobado(codigo, r.url);
      return jsonOutput({ ok: true, aprobado: true });
    }
    if (body.decision === "corregir") {
      const texto = String(body.comentario || "").trim().substring(0, 1000);
      if (!texto) return jsonOutput({ ok: false, error: "Cuéntanos qué quieres ajustar." });
      r.correcciones = (r.correcciones || 0) + 1;
      guardarSeguimientoDatos(codigo, datos);
      const extra = r.correcciones > MAX_CORRECCIONES;
      comentarClickUp(datos.taskId, "✏️ CORRECCIÓN #" + r.correcciones + (extra ? " (EXTRA, pasa de " + MAX_CORRECCIONES + ")" : "") + ": " + texto);
      cambiarEstatusClickUp(datos.taskId, /^\s*5\b|correcci[oó]n/);
      return jsonOutput({ ok: true, correcciones: r.correcciones, max: MAX_CORRECCIONES, extra: extra });
    }
    return jsonOutput({ ok: false, error: "Acción no válida" });
  } finally {
    lock.releaseLock();
  }
}

/** Guarda el render aprobado como JD-XXXXX.png en la carpeta "Joart - Renders aprobados" (la que lee Producción). */
function copiarRenderAprobado(codigo, url) {
  try {
    const carpeta = prodRendersCarpeta_(true);
    if (!carpeta || !url) return false;
    let blob = null;
    const m = String(url).match(/\/file\/d\/([\w-]+)|[?&]id=([\w-]+)/);
    if (m) blob = DriveApp.getFileById(m[1] || m[2]).getBlob();
    else {
      const r = UrlFetchApp.fetch(String(url), { muteHttpExceptions: true, followRedirects: true });
      if (r.getResponseCode() === 200) blob = r.getBlob();
    }
    if (!blob) return false;
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[blob.getContentType()];
    if (!ext) return false;
    carpeta.createFile(blob.setName(codigo + "." + ext));
    CacheService.getScriptCache().remove("PROD_RENDERS_IDX");
    return true;
  } catch (err) { Logger.log("Render aprobado no copiado (" + codigo + "): " + String(err)); return false; }
}

function extrasSeguimientoPublico(codigo, datos, estatusInterno) {
  const extra = {};
  const r = datos.render;
  if (r && r.url && r.token && !r.aprobado && /^\s*4\b|revisi[oó]n cliente/.test(String(estatusInterno).toLowerCase())) {
    extra.aprobarUrl = URL_BASE_WEB + "aprobar-render.html?c=" + encodeURIComponent(codigo) + "&t=" + r.token;
  }
  if (String(estatusInterno).toLowerCase().trim() === "entregado") extra.recompra = true;
  return extra;
}

// ============ HERRAMIENTAS PARA EJECUTAR A MANO DESDE EL EDITOR ============

/** Revisa que todo esté bien conectado. Ejecútala una vez después de actualizar. */
function diagnostico() {
  const lineas = [];
  lineas.push((cfg("CONTRASENA") ? "✓" : "✗") + " Contraseña (CONTRASENA) configurada");
  lineas.push((cfg("CLICKUP_API_TOKEN") ? "✓" : "✗") + " Token de ClickUp");
  lineas.push((cfg("CLICKUP_LIST_ID") ? "✓" : "✗") + " Lista de ClickUp");
  try {
    const sh = hojaProyectos();
    const ult = sh.getLastRow();
    const notas = ult > 0 ? sh.getRange(1, 1, ult, 1).getNotes() : [];
    const cuenta = {};
    notas.forEach(n => { const c = codigoDeNota(n[0]); if (c) cuenta[c] = (cuenta[c] || 0) + 1; });
    const codigos = Object.keys(cuenta), repetidos = codigos.filter(c => cuenta[c] > 1);
    lineas.push("✓ Pestaña \"" + SHEET_NAME + "\": " + Math.max(0, ult - 1) + " filas, " + codigos.length + " con código");
    lineas.push(repetidos.length ? "⚠ Códigos repetidos (filas copiadas): " + repetidos.join(", ") : "✓ Sin códigos repetidos");
    let filasMovidas = 0;
    codigos.forEach(c => { const d = leerSeguimiento(c); if (d && d.filaSheets && notas[d.filaSheets - 1] && !notaTieneCodigo(notas[d.filaSheets - 1][0], c)) filasMovidas++; });
    lineas.push("ℹ Pedidos que se movieron de fila (ya se encuentran solos por código): " + filasMovidas);
  } catch (err) { lineas.push("✗ " + String(err)); }
  Logger.log(lineas.join("\n"));
  try { SpreadsheetApp.getUi().alert("Diagnóstico Joart", lineas.join("\n"), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* sin interfaz */ }
}


function listarMiembrosDeClickUp() {
  const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/team", { method: "get", headers: { Authorization: cfg("CLICKUP_API_TOKEN") }, muteHttpExceptions: true });
  let resumen = "";
  (JSON.parse(r.getContentText()).teams || []).forEach(t => {
    resumen += "Workspace: " + t.name + "\n";
    (t.members || []).forEach(m => { resumen += "  - " + (m.user.username || m.user.email) + " → ID: " + m.user.id + "\n"; });
  });
  Logger.log(resumen);
  SpreadsheetApp.getUi().alert("Miembros de ClickUp", resumen, SpreadsheetApp.getUi().ButtonSet.OK);
}

function listarEstatusDeClickUp() {
  const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/list/" + cfg("CLICKUP_LIST_ID"), { method: "get", headers: { Authorization: cfg("CLICKUP_API_TOKEN") }, muteHttpExceptions: true });
  let resumen = "Estatus configurados en esta lista:\n\n";
  (JSON.parse(r.getContentText()).statuses || []).forEach(s => { resumen += '"' + s.status + '"\n'; });
  Logger.log(resumen);
  SpreadsheetApp.getUi().alert("Estatus de ClickUp", resumen, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Una sola vez (después de implementar): ClickUp avisará aquí cuando muevan una tarjeta. */
function activarWebhookClickUp() {
  const scriptUrl = ScriptApp.getService().getUrl();
  if (!scriptUrl) { SpreadsheetApp.getUi().alert("No encontré la URL del Web App. Implementa primero."); return; }
  const token = cfg("CLICKUP_API_TOKEN");
  const teams = JSON.parse(UrlFetchApp.fetch("https://api.clickup.com/api/v2/team", { method: "get", headers: { Authorization: token }, muteHttpExceptions: true }).getContentText());
  const teamId = teams.teams && teams.teams[0] ? teams.teams[0].id : null;
  if (!teamId) { SpreadsheetApp.getUi().alert("No pude obtener tu Workspace de ClickUp."); return; }
  const r = UrlFetchApp.fetch("https://api.clickup.com/api/v2/team/" + teamId + "/webhook", {
    method: "post", contentType: "application/json", headers: { Authorization: token },
    payload: JSON.stringify({ endpoint: scriptUrl, events: ["taskStatusUpdated"], list_id: cfg("CLICKUP_LIST_ID") }), muteHttpExceptions: true,
  });
  SpreadsheetApp.getUi().alert(r.getResponseCode() === 200 ? "Webhook activado ✓" : "Hubo un problema (" + r.getResponseCode() + ")", r.getContentText().substring(0, 300), SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ════════════════════════════════════════════════════════════════════════════
 * MÓDULO PRODUCCIÓN  (plataforma de la supervisora · produccion.html)
 * Lista semanal SIN precios ni pagos, con campos obligatorios. "Completar" solo
 * funciona si todo está lleno. Flujo de ESTATUS:
 *     Imprimir  →(Completar)→  Enviar  →(Entregado a paquetería)→  Enviado
 * Usa su propio PIN (propiedad PROD_PIN), distinto de CONTRASENA.
 * También: Daniela cuenta las láminas los viernes desde su página (escribe en la pestaña "Láminas") y te manda avisos
 * (falta pago, falta factura, etc.) que llegan por correo y quedan en la pestaña "Avisos producción".
 * Una sola vez: pon el PIN en prodFijarPin(), ejecútala y borra el PIN del código.
 * Crea sola la pestaña "Producción" y la carpeta de fotos en Drive.
 * ════════════════════════════════════════════════════════════════════════════ */

const PROD = {
  HOJA_PEDIDOS: 'Base de datos',
  HOJA: 'Producción',
  CARPETA: 'Joart - Fotos de producción',
  EST_PRODUCIR: 'imprimir',
  EST_LISTO: 'Enviar',
  EST_ENVIADO: 'Enviado',
  COLS: ['FOLIO', 'NEGOCIO', 'TIPO', 'PIEZAS CONTADAS', 'NOTA CONTEO', 'IMPRESIÓN', 'CORTE', 'ARMADO',
         'FOTO FINAL', 'ALTO CM', 'ANCHO CM', 'LARGO CM', 'PESO KG', 'GUÍA', 'FOTO ENTREGA',
         'INCIDENCIAS', 'ALERTA', 'LISTO EL', 'ENTREGADO EL', 'PAQUETES EXTRA'],
  CAMPOS: {
    contadas: 'PIEZAS CONTADAS', notaConteo: 'NOTA CONTEO', impresion: 'IMPRESIÓN', corte: 'CORTE',
    armado: 'ARMADO', alto: 'ALTO CM', ancho: 'ANCHO CM', largo: 'LARGO CM'
  },
  NUMERICOS: ['contadas', 'alto', 'ancho', 'largo'],
  RESULTADOS: ['OK', 'FALLA'],
  NOMBRE: 'Daniela',
  HOJA_AVISOS: 'Avisos producción', CARPETA_RENDERS: 'Joart - Renders aprobados',
  HOJA_LAMINAS: 'Láminas', FILA_TENGO: 5, CELDA_CONTEO: 'B9',   // igual que SHEET_LAMINAS / FILA_TENGO / CELDA_ULTIMO_CONTEO de arriba
  TIPOS_AVISO: { pago: 'Falta pago', factura: 'Falta factura', laminas: 'Faltan láminas o material',
                 cliente: 'Un cliente preguntó', otro: 'Otro aviso' }
};

/* ───────────── Entrada ───────────── */

function prodDoPost(e) {
  let out;
  try {
    const d = JSON.parse(e.postData.contents);
    prodAuth_(d.pin);
    out = prodRuta_(d);
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function prodRuta_(d) {
  switch (d.accion) {
    case 'lista': return prodLista_();
    case 'guardar': return prodConLock_(() => prodGuardar_(d));
    case 'foto': return prodConLock_(() => prodFoto_(d));
    case 'foto_quitar': return prodConLock_(() => prodFotoQuitar_(d));
    case 'completar': return prodConLock_(() => prodCompletar_(d));
    case 'incidencia': return prodConLock_(() => prodIncidencia_(d));
    case 'aviso': return prodConLock_(() => prodAviso_(d));
    case 'render': return prodRender_(d);
    case 'laminas_guardar': return prodConLock_(() => prodLaminasGuardar_(d));
    default: throw new Error('Acción desconocida');
  }
}

function prodAuth_(pin) {
  const real = PropertiesService.getScriptProperties().getProperty('PROD_PIN');
  if (!real || real === 'CAMBIA-ESTE-PIN') throw new Error('Falta configurar el PIN en el servidor');
  const cache = CacheService.getScriptCache();
  if (Number(cache.get('PROD_FALLOS') || 0) >= 6) throw new Error('Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');
  if (String(pin || '') !== real) {
    cache.put('PROD_FALLOS', String(Number(cache.get('PROD_FALLOS') || 0) + 1), 900);
    Utilities.sleep(800); throw new Error('PIN incorrecto');
  }
  if (cache.get('PROD_FALLOS')) cache.remove('PROD_FALLOS');
}

// Solo se puede tocar lo que está en producción (Imprimir / Enviar)
function prodActivo_(p) {
  const e = p.estatus.toLowerCase();
  if (e !== PROD.EST_PRODUCIR && e !== PROD.EST_LISTO.toLowerCase()) throw new Error('Ese pedido ya no está en producción');
  return p;
}

function prodConLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ───────────── Utilidades de datos ───────────── */

function prodSS_() {
  const a = SpreadsheetApp.getActiveSpreadsheet();
  if (a) return a;
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Falta la propiedad SHEET_ID');
  return SpreadsheetApp.openById(id);
}

function prodNum_(x) { return parseFloat(String(x == null ? '' : x).replace(/[^\d.]/g, '')) || 0; }

// "50 pzs" → 50 · "10 y 10 pzs" → 20 · "1, 10 y 15 pzs" → 26
function prodSuma_(txt) {
  return (String(txt == null ? '' : txt).match(/\d+/g) || []).reduce((a, b) => a + Number(b), 0);
}

// "26 de octubre" → Date (sin hora). Si la fecha cae >180 días atrás, asume el año siguiente.
function prodFecha_(txt, hoy) {
  const m = String(txt == null ? '' : txt).toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)/);
  if (!m) return null;
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mes = meses.indexOf(m[2].slice(0, 3));
  if (mes < 0) return null;
  let f = new Date(hoy.getFullYear(), mes, Number(m[1]));
  if (f - hoy < -180 * 864e5) f = new Date(hoy.getFullYear() + 1, mes, Number(m[1]));
  return f;
}

function prodPedidos_() {
  const sh = prodSS_().getSheetByName(PROD.HOJA_PEDIDOS);
  if (!sh) throw new Error('No existe la hoja ' + PROD.HOJA_PEDIDOS);
  const last = sh.getLastRow(), lastC = sh.getLastColumn();
  const vals = sh.getRange(1, 1, last, lastC).getDisplayValues();
  const notas = sh.getRange(1, 1, last, 1).getNotes();
  const h = vals.findIndex(r => String(r[0]).trim().toUpperCase() === 'NEGOCIO');
  if (h < 0) throw new Error('No encontré los encabezados en ' + PROD.HOJA_PEDIDOS);
  const idx = {};
  vals[h].forEach((t, i) => { idx[String(t).trim().toUpperCase()] = i; });
  const g = (r, n) => (idx[n] == null ? '' : String(r[idx[n]]).trim());
  const out = [];
  for (let r = h + 1; r < last; r++) {
    const row = vals[r];
    const estatus = g(row, 'ESTATUS');
    if (!estatus) continue; // encabezados de mes/semana y filas vacías
    const mm = String(notas[r][0] || '').match(/JD-[A-Z0-9]{5}/);
    out.push({
      fila: r + 1, folio: mm ? mm[0] : '', negocio: g(row, 'NEGOCIO'), tipo: g(row, 'TIPO'),
      cantidad: g(row, 'CANTIDAD'), grosor: g(row, 'GROSOR'), estatus: estatus,
      fecha: g(row, 'FECHA LÍMITE'), pagado: g(row, 'PAGADO'), factura: g(row, 'FACTURA'), colEstatus: idx['ESTATUS'] + 1
    });
  }
  return out;
}

/**
 * Pedido capturado a mano (sin Joart Core): le pone código de seguimiento en la nota de la celda del
 * cliente, que es lo que Producción usa para identificarlo. Solo toca filas SIN código, que no estén
 * Enviado/Entregado y cuyo nombre contenga `nombre`. Si el nombre coincide con más de una, no toca nada.
 */
function asignarCodigoInkBalm() { return asignarCodigoSinRegistro('Ink Balm'); }

function asignarCodigoSinRegistro(nombre) {
  if (!nombre) throw new Error('Indica el nombre del cliente');
  const buscado = normTxt(nombre);
  const sh = prodSS_().getSheetByName(PROD.HOJA_PEDIDOS), asignados = [];
  const candidatos = prodPedidos_().filter(p => {
    const est = p.estatus.toLowerCase();
    return !p.folio && est !== 'enviado' && est !== 'entregado' && normTxt(p.negocio).indexOf(buscado) >= 0;
  });
  if (candidatos.length !== 1) {
    Logger.log(candidatos.length ? 'Hay ' + candidatos.length + ' coincidencias, no se tocó nada: ' + candidatos.map(p => p.negocio + ' (fila ' + p.fila + ')').join(', ')
                                 : 'No encontré un pedido activo sin código que coincida con "' + nombre + '".');
    return [];
  }
  candidatos.forEach(p => {
    const codigo = crearCodigoSeguimiento(), celda = sh.getRange(p.fila, 1);
    const previa = String(celda.getNote() || '').trim();
    celda.setNote((previa ? previa + '\n' : '') + 'Código de seguimiento: ' + codigo);
    guardarSeguimientoDatos(codigo, { cliente: p.negocio, filaSheets: p.fila, manual: true });
    asignados.push(p.negocio + ' (fila ' + p.fila + ') → ' + codigo);
  });
  Logger.log(asignados.length ? 'Códigos asignados:\n' + asignados.join('\n') : 'Todos los pedidos activos ya tienen código.');
  return asignados;
}

function prodPedido_(folio) {
  const f = String(folio || '').trim();
  if (!/^JD-[A-Z0-9]{5}$/.test(f)) throw new Error('Folio inválido');
  const p = prodPedidos_().find(x => x.folio === f);
  if (!p) throw new Error('No encontré el pedido ' + f);
  return p;
}

function prodSetEstatus_(p, valor) {
  prodSS_().getSheetByName(PROD.HOJA_PEDIDOS).getRange(p.fila, p.colEstatus).setValue(valor);
}

/* ───────────── Hoja "Producción" ───────────── */

function prodHoja_() {
  const ss = prodSS_();
  let sh = ss.getSheetByName(PROD.HOJA);
  if (!sh) {
    sh = ss.insertSheet(PROD.HOJA);
    sh.getRange(1, 1, 1, PROD.COLS.length).setValues([PROD.COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < PROD.COLS.length) {
    const ini = sh.getLastColumn();
    sh.getRange(1, ini + 1, 1, PROD.COLS.length - ini).setValues([PROD.COLS.slice(ini)]).setFontWeight('bold');
  }
  return sh;
}

// Paquetes 2 a 5 de un proyecto (el 1 vive en ALTO/ANCHO/LARGO). Se guardan como JSON en una sola celda.
const PROD_MAX_PAQUETES = 5;
const PROD_MAX_FINAL = 4;   // fotos de la pieza terminada por pedido
function prodUrls_(v) { return String(v || '').split(/\s+/).filter(u => /^https?:\/\//.test(u)); }
function prodExtras_(raw) {
  try {
    const a = JSON.parse(String(raw || '[]'));
    return Array.isArray(a) ? a.slice(0, PROD_MAX_PAQUETES - 1).map(e => ({
      alto: Number(e && e.alto) || 0, ancho: Number(e && e.ancho) || 0, largo: Number(e && e.largo) || 0
    })) : [];
  } catch (_) { return []; }
}
function prodMedidasOk_(e) { return Number(e.alto) > 0 && Number(e.ancho) > 0 && Number(e.largo) > 0; }
// "30 × 20 × 10 cm" o, con varios, "Paquete 1: … · Paquete 2: …"
function prodPaquetesTxt_(r) {
  const uno = (a, b, c) => a + ' × ' + b + ' × ' + c + ' cm';
  const ex = prodExtras_(r['PAQUETES EXTRA']);
  const p1 = uno(r['ALTO CM'], r['ANCHO CM'], r['LARGO CM']);
  if (!ex.length) return p1;
  return ['Paquete 1: ' + p1].concat(ex.map((e, i) => 'Paquete ' + (i + 2) + ': ' + uno(e.alto, e.ancho, e.largo))).join(' · ');
}

// Devuelve los avances por folio. Las fotos se exponen solo como true/false (ella no ve links de Drive).
function prodProgreso_() {
  const sh = prodHoja_(), last = sh.getLastRow(), out = {};
  if (last < 2) return out;
  const vals = sh.getRange(2, 1, last - 1, PROD.COLS.length).getValues();
  const c = n => PROD.COLS.indexOf(n);
  vals.forEach(r => {
    const f = String(r[0]).trim();
    if (!f) return;
    const o = {};
    Object.keys(PROD.CAMPOS).forEach(k => { o[k] = r[c(PROD.CAMPOS[k])]; });
    o.fotoFinal = !!r[c('FOTO FINAL')];
    o.nFinal = prodUrls_(r[c('FOTO FINAL')]).length;
    o.extras = prodExtras_(r[c('PAQUETES EXTRA')]).map(e => ({ alto: e.alto || '', ancho: e.ancho || '', largo: e.largo || '' }));
    o.incidencias = String(r[c('INCIDENCIAS')] || '');
    o.alerta = String(r[c('ALERTA')] || '');
    o.listoEl = r[c('LISTO EL')];   // solo para calcular días; no se manda a la página
    out[f] = o;
  });
  return out;
}

function prodEscribir_(p, campos) {
  const sh = prodHoja_(), last = sh.getLastRow();
  let row = -1;
  if (last >= 2) {
    const fol = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < fol.length; i++) if (String(fol[i][0]).trim() === p.folio) { row = i + 2; break; }
  }
  if (row < 0) {
    row = last + 1;
    sh.getRange(row, 1, 1, 3).setValues([[p.folio, p.negocio, p.tipo]]);
  }
  Object.keys(campos).forEach(n => {
    const ci = PROD.COLS.indexOf(n);
    if (ci >= 0) sh.getRange(row, ci + 1).setValue(campos[n]);
  });
  return row;
}

// Lectura de una fila completa (con links) para validar en servidor
function prodProgresoCrudo_(folio) {
  const sh = prodHoja_(), last = sh.getLastRow();
  if (last < 2) return {};
  const vals = sh.getRange(2, 1, last - 1, PROD.COLS.length).getValues();
  const r = vals.find(v => String(v[0]).trim() === folio);
  const o = {};
  if (r) PROD.COLS.forEach((n, i) => { o[n] = r[i]; });
  return o;
}

// Pasos que Daniela debe cumplir para cerrar un pedido (misma regla que "Completar")
function prodPasos_(p, r) {
  const vacio = x => x === '' || x === null || x === undefined;
  const esperado = prodSuma_(p.cantidad);
  const nuevo = /personaliz|\(\s*\d/i.test(p.tipo);
  const pasos = [];
  pasos.push({ n: 'Conteo', ok: !vacio(r['PIEZAS CONTADAS']) && (Number(r['PIEZAS CONTADAS']) === esperado || !!String(r['NOTA CONTEO'] || '').trim()) });
  pasos.push({ n: 'Impresión', ok: r['IMPRESIÓN'] === 'OK' });
  pasos.push({ n: 'Corte', ok: r['CORTE'] === 'OK' });
  if (nuevo) pasos.push({ n: 'Armado', ok: r['ARMADO'] === 'OK' });
  pasos.push({ n: 'Foto final', ok: !!r['FOTO FINAL'] });
  pasos.push({ n: 'Medidas', ok: ['ALTO CM', 'ANCHO CM', 'LARGO CM'].every(c => Number(r[c]) > 0) && prodExtras_(r['PAQUETES EXTRA']).every(prodMedidasOk_) });
  return { total: pasos.length, hechos: pasos.filter(x => x.ok).length, pasos: pasos, nuevo: nuevo };
}

// Pone en la celda ESTATUS del pedido (Base de datos) una nota con el avance: se ve al pasar el cursor
function prodNota_(p) {
  try {
    const r = prodProgresoCrudo_(p.folio), tz = Session.getScriptTimeZone();
    const ps = prodPasos_(p, r);
    const fecha = d => d instanceof Date ? Utilities.formatDate(d, tz, 'dd/MM h:mm a') : '—';
    const v = x => (x === '' || x === null || x === undefined) ? '—' : x;
    const falta = ps.pasos.filter(x => !x.ok).map(x => x.n.toLowerCase());
    const medidas = ps.pasos.find(x => x.n === 'Medidas').ok ? prodPaquetesTxt_(r) : '—';
    const t = ['📦 PRODUCCIÓN · ' + PROD.NOMBRE,
      'Avance: ' + ps.hechos + '/' + ps.total + (falta.length ? ' · falta: ' + falta.join(', ') : ' ✓ completo'),
      'Contadas: ' + v(r['PIEZAS CONTADAS']) + ' de ' + prodSuma_(p.cantidad) + (String(r['NOTA CONTEO'] || '').trim() ? ' (' + r['NOTA CONTEO'] + ')' : ''),
      'Impresión: ' + v(r['IMPRESIÓN']) + ' · Corte: ' + v(r['CORTE']) + (ps.nuevo ? ' · Armado: ' + v(r['ARMADO']) : ''),
      (prodExtras_(r['PAQUETES EXTRA']).length ? 'Paquetes: ' : 'Paquete: ') + medidas,
      'Listo: ' + fecha(r['LISTO EL']) + ' · Enviado: ' + fecha(r['ENTREGADO EL'])];
    if (r['ALERTA'] === 'SÍ') t.push('⚠ ' + String(r['INCIDENCIAS'] || '').split('\n').pop());
    prodSS_().getSheetByName(PROD.HOJA_PEDIDOS).getRange(p.fila, p.colEstatus).setNote(t.join('\n'));
  } catch (e) { Logger.log('prodNota_: ' + e); }
}

// Para la pestaña "Producción" del panel de Jorge: todo el avance de lo que está en producción
function prodResumenPanel_() {
  const tz = Session.getScriptTimeZone();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const sh = prodHoja_(), last = sh.getLastRow(), crudo = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, PROD.COLS.length).getValues().forEach(v => {
      const f = String(v[0]).trim(); if (!f) return;
      const o = {}; PROD.COLS.forEach((n, i) => { o[n] = v[i]; }); crudo[f] = o;
    });
  }
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, tz, 'dd/MM h:mm a') : '';
  const items = [];
  prodPedidos_().forEach(p => {
    if (!p.folio) return;
    const est = p.estatus.toLowerCase(), r = crudo[p.folio] || {};
    const enviado = est === PROD.EST_ENVIADO.toLowerCase();
    if (est !== PROD.EST_PRODUCIR && est !== PROD.EST_LISTO.toLowerCase() && !enviado) return;
    if (enviado && !(r['ENTREGADO EL'] instanceof Date && (hoy - r['ENTREGADO EL']) < 14 * 864e5)) return;
    const ps = prodPasos_(p, r), listoEl = r['LISTO EL'] instanceof Date ? r['LISTO EL'] : null;
    const f = prodFecha_(p.fecha, hoy);
    items.push({
      folio: p.folio, negocio: p.negocio, tipo: p.tipo, cantidad: p.cantidad, estatus: p.estatus, pagado: p.pagado,
      fechaTxt: p.fecha, dias: f ? Math.round((f - hoy) / 864e5) : null,
      estado: enviado ? 'enviado' : (listoEl ? 'listo' : (ps.hechos > 0 ? 'proceso' : 'nuevo')),
      adelantado: est === PROD.EST_LISTO.toLowerCase() && !listoEl,
      hechos: ps.hechos, total: ps.total, pasos: ps.pasos,
      alerta: r['ALERTA'] === 'SÍ', incidencias: String(r['INCIDENCIAS'] || ''),
      listoEl: fmt(listoEl), entregadoEl: fmt(r['ENTREGADO EL'])
    });
  });
  items.sort((a, b) => (a.dias === null ? 999 : a.dias) - (b.dias === null ? 999 : b.dias));
  let avisos = [];
  try {
    const sa = prodSS_().getSheetByName(PROD.HOJA_AVISOS);
    if (sa && sa.getLastRow() >= 2) {
      const n = Math.min(10, sa.getLastRow() - 1);
      avisos = sa.getRange(sa.getLastRow() - n + 1, 1, n, 6).getDisplayValues().reverse()
        .map(x => ({ fecha: x[0], aviso: x[1], folio: x[2], negocio: x[3], nota: x[4] }));
    }
  } catch (_) {}
  const lam = prodLaminasEstado_(hoy);
  return { ok: true, items: items, avisos: avisos, laminas: lam ? { ultimo: lam.ultimo, dias: lam.dias } : null };
}

function prodMail_(asunto, cuerpo) {
  try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), asunto, cuerpo); } catch (e) { /* el aviso nunca debe romper el flujo */ }
}

/* ───────────── Acciones ───────────── */

function prodLista_() {
  let rIdx = {};
  try { rIdx = prodRendersIndice_(); } catch (_) { rIdx = {}; }
  const tz = Session.getScriptTimeZone();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const prog = prodProgreso_();
  const items = [];
  prodPedidos_().forEach(p => {
    const est = p.estatus.toLowerCase();
    if (est !== PROD.EST_PRODUCIR && est !== PROD.EST_LISTO.toLowerCase()) return;
    if (!p.folio) return;
    if (est !== PROD.EST_PRODUCIR && prog[p.folio] && prog[p.folio].listoEl instanceof Date) return;   // ya lo cerró ella: lo demás es de Jorge
    const f = prodFecha_(p.fecha, hoy);
    const d = prog[p.folio] || {};
    const listoEl = d.listoEl instanceof Date ? d.listoEl : null;
    delete d.listoEl;
    items.push({
      folio: p.folio, negocio: p.negocio, tipo: p.tipo, cantidad: p.cantidad,
      esperado: prodSuma_(p.cantidad), grosor: p.grosor,
      etapa: (est === PROD.EST_PRODUCIR || !listoEl) ? 'producir' : 'entregar',
      adelantado: est !== PROD.EST_PRODUCIR && !listoEl,   // Jorge ya lo marcó Enviar, pero ella aún no cierra su revisión
      fecha: f ? Utilities.formatDate(f, tz, 'yyyy-MM-dd') : '', fechaTxt: p.fecha,
      dias: f ? Math.round((f - hoy) / 864e5) : null,
      nuevo: /personaliz|\(\s*\d/i.test(p.tipo),
      tieneRender: !!rIdx[p.folio],
      liberado: prodNum_(p.pagado) >= 100, // solo un sí/no: nunca el monto
      datos: d
    });
  });
  items.sort((a, b) => (a.dias === null ? 999 : a.dias) - (b.dias === null ? 999 : b.dias));
  return { ok: true, items: items, laminas: prodLaminasPublico_(hoy) };
}

function prodGuardar_(d) {
  const p = prodPedido_(d.folio);
  prodActivo_(p);
  const campos = {};
  Object.keys(d.campos || {}).forEach(k => {
    const col = PROD.CAMPOS[k];
    if (!col) return;
    let v = d.campos[k];
    if (v === null || v === undefined) v = '';
    if (PROD.NUMERICOS.indexOf(k) >= 0) {
      v = String(v).trim() === '' ? '' : Number(v);
      if (v !== '' && (isNaN(v) || v < 0 || v > 100000)) throw new Error('Número inválido en ' + k);
    } else if (k === 'impresion' || k === 'corte' || k === 'armado') {
      v = String(v).toUpperCase();
      if (v !== '' && PROD.RESULTADOS.indexOf(v) < 0) throw new Error('Valor inválido en ' + k);
    } else {
      v = String(v).slice(0, 200);
    }
    campos[col] = v;
  });
  if (Array.isArray((d.campos || {}).extras)) {
    const num = x => { const n = String(x === null || x === undefined ? '' : x).trim() === '' ? 0 : Number(x); if (isNaN(n) || n < 0 || n > 100000) throw new Error('Número inválido en el paquete'); return n; };
    const nuevos = d.campos.extras.slice(0, PROD_MAX_PAQUETES - 1).map((e, i) => ({
      alto: num(e.alto), ancho: num(e.ancho), largo: num(e.largo)
    }));
    campos['PAQUETES EXTRA'] = nuevos.length ? JSON.stringify(nuevos) : '';
  }
  prodEscribir_(p, campos);
  prodNota_(p);
  return { ok: true };
}

/* ───── Renders aprobados: Jorge sube la imagen a la carpeta de Drive y se llama con el folio (ej. JD-ZXKVT.png) ───── */
function prodRendersCarpeta_(crear) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PROD_RENDERS_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (_) {} }
  const it = DriveApp.getFoldersByName(PROD.CARPETA_RENDERS);
  let f = it.hasNext() ? it.next() : (crear ? DriveApp.createFolder(PROD.CARPETA_RENDERS) : null);
  if (f) props.setProperty('PROD_RENDERS_ID', f.getId());
  return f;
}

// {folio: idDeArchivo}; se guarda 60 s en caché para no recorrer Drive en cada actualización
function prodRendersIndice_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('PROD_RENDERS_IDX');
  if (c) { try { return JSON.parse(c); } catch (_) {} }
  const root = prodRendersCarpeta_(false);
  const out = {}, fechas = {};
  if (root) {
    const it = root.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (!/^image\//.test(f.getMimeType())) continue;
      const m = String(f.getName()).toUpperCase().match(/JD-[A-Z0-9]{5}/);
      if (!m) continue;
      const t = f.getLastUpdated().getTime();
      if (!fechas[m[0]] || t > fechas[m[0]]) { fechas[m[0]] = t; out[m[0]] = f.getId(); }
    }
  }
  cache.put('PROD_RENDERS_IDX', JSON.stringify(out), 60);
  return out;
}

function prodRender_(d) {
  const p = prodActivo_(prodPedido_(d.folio));
  const id = prodRendersIndice_()[p.folio];
  if (!id) throw new Error('Todavía no hay un render aprobado para este pedido');
  const f = DriveApp.getFileById(id);
  if (f.getSize() > 8 * 1024 * 1024) throw new Error('El render pesa más de 8 MB; pídele a Jorge uno más ligero');
  const b = f.getBlob();
  return { ok: true, mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes()) };
}

// Para el panel de Jorge (Joart Core): lo que Daniela capturó de un pedido, con sus fotos
function prodFotosPanel_(codigo) {
  const folio = String(codigo || '').trim().toUpperCase();
  if (!/^JD-[A-Z0-9]{5}$/.test(folio)) return { ok: false, error: 'Código inválido' };
  const r = prodProgresoCrudo_(folio);
  const tieneAlgo = Object.keys(r).length > 0;
  const foto = (url, etiqueta) => {
    const m = String(url || '').match(/[-\w]{25,}/);
    if (!m) return null;
    try {
      const f = DriveApp.getFileById(m[0]);
      if (f.getSize() > 4 * 1024 * 1024) return { etiqueta: etiqueta, grande: true, url: String(url) };
      const b = f.getBlob();
      return { etiqueta: etiqueta, mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes()), url: String(url) };
    } catch (_) { return { etiqueta: etiqueta, error: true, url: String(url) }; }
  };
  const extras = prodExtras_(r['PAQUETES EXTRA']);
  const finales = prodUrls_(r['FOTO FINAL']);
  const fotos = finales.map((u, i) => foto(u, finales.length > 1 ? 'Pieza terminada ' + (i + 1) + '/' + finales.length : 'Pieza terminada')).filter(Boolean);
  const v = k => (r[k] === undefined || r[k] === null) ? '' : r[k];
  return {
    ok: true, codigo: folio, capturado: tieneAlgo, fotos: fotos,
    datos: {
      contadas: v('PIEZAS CONTADAS'), notaConteo: v('NOTA CONTEO'), impresion: v('IMPRESIÓN'), corte: v('CORTE'), armado: v('ARMADO'),
      alto: v('ALTO CM'), ancho: v('ANCHO CM'), largo: v('LARGO CM'),
      extras: extras.map(e => ({ alto: e.alto || '', ancho: e.ancho || '', largo: e.largo || '' }))
    }
  };
}

function prodCarpeta_(folio) {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const id = props.getProperty('PROD_CARPETA_ID');
  if (id) { try { root = DriveApp.getFolderById(id); } catch (_) { root = null; } }
  if (!root) {
    const it = DriveApp.getFoldersByName(PROD.CARPETA);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(PROD.CARPETA);
    props.setProperty('PROD_CARPETA_ID', root.getId());
  }
  const sub = root.getFoldersByName(folio);
  return sub.hasNext() ? sub.next() : root.createFolder(folio);
}

function prodFoto_(d) {
  const p = prodActivo_(prodPedido_(d.folio));
  const tipo = d.tipo === 'final' ? 'final' : '';
  if (!tipo) throw new Error('Tipo de foto inválido');
  const b64 = String(d.b64 || '');
  if (!b64 || b64.length > 4000000) throw new Error('Foto vacía o demasiado pesada');
  const previas = prodUrls_(prodProgresoCrudo_(p.folio)['FOTO FINAL']);
  if (previas.length >= PROD_MAX_FINAL) throw new Error('Ya hay ' + PROD_MAX_FINAL + ' fotos de la pieza. Quita una si quieres cambiarla.');
  const tz = Session.getScriptTimeZone();
  const nombre = p.folio + '_' + tipo + '_' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss') + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', nombre);
  const url = prodCarpeta_(p.folio).createFile(blob).getUrl();
  prodEscribir_(p, { 'FOTO FINAL': previas.concat(url).join('\n') });
  prodNota_(p);
  return { ok: true, n: previas.length + 1 };
}

function prodFotoQuitar_(d) {
  const p = prodActivo_(prodPedido_(d.folio));
  const urls = prodUrls_(prodProgresoCrudo_(p.folio)['FOTO FINAL']);
  if (!urls.length) return { ok: true, n: 0 };
  const ultima = urls.pop();
  try { const m = ultima.match(/[-\w]{25,}/); if (m) DriveApp.getFileById(m[0]).setTrashed(true); } catch (_) {}
  prodEscribir_(p, { 'FOTO FINAL': urls.join('\n') });
  prodNota_(p);
  return { ok: true, n: urls.length };
}

function prodCompletar_(d) {
  const p = prodPedido_(d.folio);
  prodActivo_(p);
  const r = prodProgresoCrudo_(p.folio);
  const falta = [];
  const vacio = x => x === '' || x === null || x === undefined;
  const esperado = prodSuma_(p.cantidad);
  if (vacio(r['PIEZAS CONTADAS'])) falta.push('conteo');
  else if (Number(r['PIEZAS CONTADAS']) !== esperado && !String(r['NOTA CONTEO'] || '').trim()) falta.push('nota del conteo');
  if (r['IMPRESIÓN'] !== 'OK') falta.push('impresión OK');
  if (r['CORTE'] !== 'OK') falta.push('corte OK');
  if (/personaliz|\(\s*\d/i.test(p.tipo) && r['ARMADO'] !== 'OK') falta.push('armado OK');
  if (!r['FOTO FINAL']) falta.push('foto final');
  ['ALTO CM', 'ANCHO CM', 'LARGO CM'].forEach(c => { if (!(Number(r[c]) > 0)) falta.push(c.toLowerCase()); });
  prodExtras_(r['PAQUETES EXTRA']).forEach((e, i) => { if (!prodMedidasOk_(e)) falta.push('medidas del paquete ' + (i + 2)); });
  if (falta.length) throw new Error('Falta: ' + falta.join(', '));

  prodEscribir_(p, { 'LISTO EL': new Date() });
  prodSetEstatus_(p, PROD.EST_LISTO);
  prodNota_(p);
  const desc = Number(r['PIEZAS CONTADAS']) !== esperado
    ? '\n⚠ Conteo distinto: pedido ' + esperado + ', contadas ' + r['PIEZAS CONTADAS'] + ' (' + r['NOTA CONTEO'] + ')' : '';
  prodMail_('✅ Pieza lista: ' + p.negocio + ' ' + p.folio,
    p.negocio + ' (' + p.folio + ') terminó producción.' + desc +
    '\n' + (prodExtras_(r['PAQUETES EXTRA']).length ? 'Paquetes: ' : 'Paquete: ') + prodPaquetesTxt_(r) + '.' +
    '\nFoto final: ' + r['FOTO FINAL'] +
    '\n\nEl estatus ya cambió a Enviar. Siguiente paso: cobrar el resto si falta y generar la guía.');
  return { ok: true };
}

function prodIncidencia_(d) {
  const p = prodActivo_(prodPedido_(d.folio));
  const texto = String(d.texto || '').trim().slice(0, 300);
  if (!texto) throw new Error('Describe el problema');
  const tz = Session.getScriptTimeZone();
  const r = prodProgresoCrudo_(p.folio);
  const linea = '[' + Utilities.formatDate(new Date(), tz, 'dd/MM HH:mm') + '] ' + texto;
  const previo = String(r['INCIDENCIAS'] || '');
  prodEscribir_(p, { 'INCIDENCIAS': previo ? previo + '\n' + linea : linea, 'ALERTA': 'SÍ' });
  prodNota_(p);
  prodMail_('⚠ Incidencia en producción: ' + p.negocio + ' ' + p.folio, p.negocio + ' (' + p.folio + ')\n\n' + texto);
  return { ok: true };
}

/* ───────────── Láminas y avisos ───────────── */

// Lee la pestaña "Láminas": por grosor, lo que hay (Tengo) y lo que piden los pedidos (Necesito), y la fecha del último conteo.
function prodLaminasEstado_(hoy) {
  try {
    const sh = prodSS_().getSheetByName(PROD.HOJA_LAMINAS);
    if (!sh) return null;
    const f = sh.getRange(PROD.FILA_TENGO - 1, 2, 3, 4).getValues();   // encabezado, Tengo, Necesito (columnas B:E)
    const cols = [];
    for (let i = 0; i < f[0].length; i++) {
      const g = String(f[0][i] || '').trim();
      if (!g) continue;
      cols.push({ i: i, grosor: g, tengo: f[1][i] === '' ? '' : Number(f[1][i]), necesito: Math.round((parseFloat(f[2][i]) || 0) * 10) / 10 });
    }
    const ultimo = String(sh.getRange(PROD.CELDA_CONTEO).getDisplayValue() || '').trim();
    const fu = prodFecha_(ultimo, hoy);
    return { cols: cols, ultimo: ultimo, dias: fu ? Math.round((hoy - fu) / 864e5) : null };
  } catch (e) { return null; }
}

// Daniela cuenta las láminas y las escribe en "Tengo". Igual que cuando lo haces tú: se anota la fecha del conteo.
// Lo que ve Daniela: solo los grosores y cuándo fue el último conteo (sin existencias ni lo que piden los pedidos)
function prodLaminasPublico_(hoy) {
  const e = prodLaminasEstado_(hoy);
  if (!e) return null;
  return { cols: e.cols.map(c => ({ i: c.i, grosor: c.grosor })), ultimo: e.ultimo, dias: e.dias };
}

function prodLaminasGuardar_(d) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const est = prodLaminasEstado_(hoy);
  if (!est || !est.cols.length) throw new Error('No encontré la pestaña ' + PROD.HOJA_LAMINAS);
  const vals = d.valores || {};
  const nuevos = est.cols.map(c => {
    const v = vals[c.i];
    if (v === undefined || v === null || String(v).trim() === '') throw new Error('Falta contar ' + c.grosor);
    const n = Number(v);
    if (!isFinite(n) || n < 0 || n > 9999) throw new Error('Número inválido en ' + c.grosor);
    return Math.round(n * 10) / 10;
  });
  const sh = prodSS_().getSheetByName(PROD.HOJA_LAMINAS);
  est.cols.forEach((c, k) => sh.getRange(PROD.FILA_TENGO, 2 + c.i).setValue(nuevos[k]));
  const ahora = new Date(), tz = Session.getScriptTimeZone();
  sh.getRange(PROD.CELDA_CONTEO).setValue(DIAS_ES[ahora.getDay()] + ' ' + ahora.getDate() + ' de ' + MESES_ES[ahora.getMonth()] +
    ', ' + Utilities.formatDate(ahora, tz, 'h:mm a').toLowerCase());

  const faltan = [], lineas = [];
  est.cols.forEach((c, k) => {
    lineas.push(c.grosor + ': hay ' + nuevos[k] + ' · los pedidos piden ' + c.necesito);
    if (c.necesito > nuevos[k] + 1e-9) faltan.push(c.grosor + ' (faltan ' + (Math.round((c.necesito - nuevos[k]) * 10) / 10) + ')');
  });
  prodMail_('🧱 Conteo de láminas — ' + PROD.NOMBRE + (faltan.length ? ' · FALTAN' : ''),
    'Conteo hecho por ' + PROD.NOMBRE + ':\n\n' + lineas.join('\n') +
    (faltan.length ? '\n\n⚠ No alcanzan: ' + faltan.join(', ') + '. Hay que pedir láminas.' : '\n\nCon esto alcanzan los pedidos en Imprimir y Repetir.'));
  return { ok: true, laminas: prodLaminasPublico_(hoy), faltan: faltan.length ? ['faltan'] : [] };
}

function prodAvisosHoja_() {
  const ss = prodSS_();
  let sh = ss.getSheetByName(PROD.HOJA_AVISOS);
  if (!sh) {
    sh = ss.insertSheet(PROD.HOJA_AVISOS);
    sh.getRange(1, 1, 1, 6).setValues([['FECHA', 'AVISO', 'FOLIO', 'NEGOCIO', 'NOTA', 'DE']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Daniela le avisa a Jorge (falta pago, falta factura, faltan láminas...). Queda registrado y llega por correo.
function prodAviso_(d) {
  const tipo = String(d.tipo || '');
  const etiqueta = PROD.TIPOS_AVISO[tipo];
  if (!etiqueta) throw new Error('Tipo de aviso inválido');
  const nota = String(d.nota || '').trim().slice(0, 300);
  if (tipo === 'otro' && !nota) throw new Error('Escribe el aviso');
  const p = d.folio ? prodPedido_(d.folio) : null;
  const sh = prodAvisosHoja_();
  const ahora = new Date();
  // si le dio dos veces al botón, no se manda doble
  if (p) {
    const last = sh.getLastRow();
    if (last >= 2) {
      const desde = Math.max(2, last - 19);
      const rows = sh.getRange(desde, 1, last - desde + 1, 6).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][1] === etiqueta && String(rows[i][2]) === p.folio && rows[i][0] instanceof Date && (ahora - rows[i][0]) < 3600000) return { ok: true, repetido: true };
      }
    }
  }
  sh.appendRow([ahora, etiqueta, p ? p.folio : '', p ? p.negocio : '', nota, PROD.NOMBRE]);
  const quien = p ? ' · ' + p.negocio + ' (' + p.folio + ')' : '';
  prodMail_('💬 Aviso de ' + PROD.NOMBRE + ': ' + etiqueta + quien,
    PROD.NOMBRE + ' te avisa: ' + etiqueta + '.' +
    (p ? '\n\nPedido: ' + p.negocio + ' (' + p.folio + ')\nEstatus: ' + p.estatus + ' · Pagado: ' + p.pagado + ' · Factura: ' + (p.factura || '—') : '') +
    (nota ? '\n\nNota: ' + nota : ''));
  return { ok: true };
}

/* ───────────── Utilidades para ti ───────────── */

// Ejecútala UNA vez con el PIN que quieras y luego bórrala.
function prodFijarPin() {
  PropertiesService.getScriptProperties().setProperty('PROD_PIN', 'CAMBIA-ESTE-PIN');
}

function prodDiagnostico() {
  const ped = prodPedidos_();
  const enProd = ped.filter(p => p.estatus.toLowerCase() === PROD.EST_PRODUCIR);
  const sinFolio = enProd.filter(p => !p.folio).length;
  Logger.log('✓ Hoja ' + PROD.HOJA_PEDIDOS + ': ' + ped.length + ' pedidos con estatus');
  Logger.log('✓ En Imprimir: ' + enProd.length + (sinFolio ? '  ⚠ sin folio en la nota de la columna A: ' + sinFolio : ''));
  Logger.log(PropertiesService.getScriptProperties().getProperty('PROD_PIN') ? '✓ PIN configurado' : '✗ Falta el PIN (prodFijarPin)');
  prodHoja_();
  Logger.log('✓ Hoja ' + PROD.HOJA + ' lista');
  const hoyD = new Date(); hoyD.setHours(0, 0, 0, 0);
  const lam = prodLaminasEstado_(hoyD);
  Logger.log(lam && lam.cols.length ? '✓ Láminas: ' + lam.cols.map(c => c.grosor + '=' + c.tengo).join(' · ') + ' · último conteo: ' + (lam.ultimo || '—') + ' (hace ' + lam.dias + ' días)' : '✗ No pude leer la pestaña ' + PROD.HOJA_LAMINAS);
  const it = DriveApp.getFoldersByName(PROD.CARPETA);
  Logger.log(it.hasNext() ? '✓ Carpeta de fotos: ' + it.next().getUrl() : '✓ Drive accesible (la carpeta de fotos se crea con la primera foto)');
  const cr = prodRendersCarpeta_(true);
  Logger.log('✓ Carpeta de renders aprobados (sube aquí las imágenes con el folio en el nombre, ej. JD-ZXKVT.png): ' + cr.getUrl());
  Logger.log('Fecha de prueba "26 de octubre" → ' + prodFecha_('26 de octubre', new Date()));
}