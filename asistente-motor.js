/* Joart — motor del Asistente SIN IA (v2).
 * Sigue sin llamar a ningún servicio: es instantáneo y gratis. Lo que cambia es CÓMO entiende:
 *   1. Corrige errores de dedo ("atrasadoz", "inprimir") y sinónimos ("los mios", "por enviar").
 *   2. Separa la pregunta en piezas: ¿de QUIÉN?, ¿QUÉ dato?, ¿con qué FILTROS?, ¿cuántos / cuánto / cuáles?
 *   3. Se acuerda de la conversación ("¿y cuánto debe?", "de esos, los atrasados").
 *   4. Dice qué entendió ("Entendí: …") para que se note de inmediato si se equivocó.
 *   5. Si no está seguro, pregunta con botones en vez de contestar cualquier cosa.
 * Uso: Motor.responder(pregunta, { proyectos, inventario, ultimoConteo }, { core, hoy }) -> { html }
 */
(function (root) {
  "use strict";

  /* ===================== utilidades ===================== */
  const MESES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
  const MESES_TXT = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DIAS_TXT = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9$%.\-]+/g, " ").replace(/\s+/g, " ").trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => "$" + Math.round(n).toLocaleString("es-MX");
  const tokens = (s) => norm(s).split(" ").filter(Boolean);
  const elige = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const plural = (n, uno, varios) => n + " " + (n === 1 ? uno : varios);
  const unico = (arr) => Array.from(new Set(arr));
  const dia0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // Distancia de edición acotada (con transposición). Devuelve max+1 si se pasa.
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const la = a.length, lb = b.length;
    let prev2 = null, prev = [], cur = [];
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      cur = [i];
      let minFila = i;
      for (let j = 1; j <= lb; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < minFila) minFila = v;
      }
      if (minFila > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }
  // ¿Dos palabras son "la misma" aunque tengan plural o un error de dedo?
  function simil(a, b) {
    if (a === b) return true;
    const mn = Math.min(a.length, b.length);
    if (mn < 4) return false;
    if (a + "s" === b || b + "s" === a || a + "es" === b || b + "es" === a) return true;
    if (mn < 5) return false;
    const m = mn >= 9 ? 2 : 1;
    return dist(a, b, m) <= m;
  }

  /* ===================== datos del Sheets ===================== */
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const precioDe = (p) => (typeof p.precio === "number" ? p.precio : num(p.precio));
  const estatusDe = (p) => norm(p.estatus);
  const esVivo = (p) => ["entregado", "enviado", "cancelado"].indexOf(estatusDe(p)) === -1;
  // % pagado: null = no hay dato ("N/A" o vacío; pasa en los pedidos viejos).
  function pagoPct(p) {
    const s = String(p.pagado == null ? "" : p.pagado).trim();
    if (!s || /^n\s*\/?\s*a$/i.test(s)) return null;
    let n = parseFloat(s.replace("%", "").replace(",", "."));
    if (isNaN(n)) return null;
    if (typeof p.pagado === "number" && n > 0 && n <= 1) n *= 100;
    return n;
  }
  // Lo que falta por cobrar. Un pedido ya entregado sin dato de pago se toma como liquidado (no inventa deudas).
  function saldoDe(p) {
    const pr = precioDe(p); if (!pr) return 0;
    const pc = pagoPct(p);
    if (pc === null) return esVivo(p) ? pr : 0;
    return Math.max(0, pr * (1 - pc / 100));
  }
  const liquidado = (p) => { const pc = pagoPct(p); return pc === null ? (!esVivo(p) && precioDe(p) > 0) : pc >= 100; };
  function piezasDe(p) { return (String(p.cantidad || "").replace(/\d+\s*\/\s*\d+/g, "").match(/\d+/g) || []).reduce((s, n) => s + parseInt(n, 10), 0); }
  function hojasDe(p) {
    if (typeof p.hojas === "number") return p.hojas;
    const s = String(p.hojas || ""); if (!s || /n\s*\/?\s*a/i.test(s)) return 0;
    let t = 0;
    const sin = s.replace(/(\d+)\s*\/\s*(\d+)/g, (m, a, b) => { t += parseInt(a, 10) / parseInt(b, 10); return " "; });
    const ints = sin.match(/\d+(?:[.,]\d+)?/g) || [];
    ints.forEach((n) => { t += parseFloat(n.replace(",", ".")); });
    return t;
  }
  const limpio = (v) => { const s = String(v == null ? "" : v).trim(); return /^(n\s*\/?\s*a|-|—)?$/i.test(s) ? "" : s; };

  // Filas separadoras del Sheets ("OCTUBRE", "Octubre - Semana 2"): no son proyectos.
  const RE_SEPARADOR = /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b|\bsemana\s*\d/;
  const esProyectoReal = (p) => !(RE_SEPARADOR.test(norm(p.cliente)) && !String(p.tipo || "").trim() && !String(p.estatus || "").trim()) && norm(p.cliente) !== "";

  function fechaDe(txt, hoy) {
    const m = norm(txt).match(/(\d{1,2}) de ([a-z]+)/);
    if (!m || MESES[m[2]] === undefined) return null;
    let d = new Date(hoy.getFullYear(), MESES[m[2]], parseInt(m[1], 10), 12, 0, 0);
    if ((d - hoy) / 86400000 < -200) d = new Date(hoy.getFullYear() + 1, MESES[m[2]], parseInt(m[1], 10), 12, 0, 0);
    return d;
  }
  const diasPara = (p, hoy) => { const f = fechaDe(p.fechaLimite, hoy); return f ? Math.round((dia0(f) - dia0(hoy)) / 86400000) : null; };

  /* ===================== vocabulario ===================== */
  const STOP = new Set(("de la el los las un una unos unas y o a e en con por para que cual cuales cuanto cuantos cuanta cuantas es son esta estan " +
    "tiene tienen hay del al me mi mis tu su sus lo le se si no como donde cuando quien dame dime muestrame muestra ver lista listame todos todas todo " +
    "proyecto proyectos pedido pedidos cliente clientes negocio negocios tengo tenemos hacer hace quiero ya ahorita " +
    "enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre semana mes meses").split(" "));
  // Palabras que son parte de la pregunta (no del nombre de un cliente).
  const RES = new Set(("pendiente pendientes atrasado atrasados retrasado retrasados vencido vencidos cobrar debe deben saldo adeudo entregado entregados enviado enviados enviar imprimir " +
    "render revision cancelado cancelados factura facturas telefono whatsapp contacto estatus status fecha entrega entregas precio costo cotiza cotizar " +
    "laminas lamina inventario stock modelos modelo piezas hojas anticipo pagado pagados pago pagaron semana hoy manana urgente resumen ventas total " +
    "floor stand pop display box escalonado repisas separadores pegboard counter personalizado ganchos compacto cenefa mega nivel niveles " +
    "cuanto cuantos cuantas cuales como cuando esos esas ellos hola gracias ayuda").split(" "));
  const MODELOS_CLAVE = ["floor stand", "pop display", "display box", "display con separadores", "escalonado", "repisas", "separadores", "pegboard", "counter", "personalizado", "ganchos", "compacto", "cosmetic", "cenefa", "mega"];
  const GENERICAS = new Set(["tienda", "tiendas", "display", "floor", "stand", "pop", "box", "super", "mini", "grupo", "casa", "dulces", "farmacia", "salsa", "salsas", "carne", "seca", "productos", "natural", "naturales", "store", "mix", "sweets", "don", "dona", "del", "mama", "papa"]);
  // Palabras que se corrigen si vienen mal escritas.
  const VOCAB = ("pendientes pendiente atrasados atrasado retrasado vencidos entregados entregado imprimir imprimiendo factura facturas telefono whatsapp proyectos proyecto pedidos " +
    "laminas inventario cotizar cotiza estatus urgente resumen modelos vendidos anticipo pagados adeudo contacto piezas cobrar enviado enviados enviar revision cancelado " +
    "proximos proximo ventas vendimos alcanzan faltan semana manana personalizado escalonado separadores floor stand display compacto").split(" ");

  function corregir(qn, clientToks) {
    return qn.split(" ").map((t) => {
      if (t.length < 6 || /\d/.test(t) || clientToks.has(t) || VOCAB.indexOf(t) > -1 || MESES[t] !== undefined) return t;
      const m = t.length >= 9 ? 2 : 1;
      let mejor = null, md = m + 1;
      for (let i = 0; i < VOCAB.length; i++) { const v = VOCAB[i]; if (v.length < 6) continue; const d = dist(t, v, m); if (d < md) { md = d; mejor = v; } }
      return mejor || t;
    }).join(" ");
  }
  const SINONIMOS = [
    [/\b(por|para|a|ya a) imprimir\b|\bimprimiendo\b/g, "imprimir"],
    [/\b(por|para|a) enviar\b|\bpara (el )?envio\b/g, "enviar"],
    [/\bya (se )?(envio|mando|enviaron|mandaron)\b|\bmandad[oa]s?\b/g, "enviado"],
    [/\bterminad[oa]s?\b|\bya entregad\w+|\bentregamos\b|\bentregue\w*\b|\bcerrad[oa]s?\b/g, "entregado"],
    [/\b(por|en) revisar\b/g, "en revision"],
    [/\b(los )?mios\b|\bme tocan\b|\ba mi cargo\b|\bmi parte\b/g, "yo"],
  ];

  /* ===================== clientes ===================== */
  function indexarClientes(proyectos) {
    const mapa = new Map();
    proyectos.forEach((p) => {
      const k = norm(p.cliente); if (!k) return;
      if (!mapa.has(k)) mapa.set(k, { key: k, nombre: p.cliente, toks: tokens(p.cliente).filter((t) => !STOP.has(t) && t.length >= 2), proyectos: [] });
      mapa.get(k).proyectos.push(p);
    });
    const df = {}, todosToks = new Set();
    mapa.forEach((c) => { unico(c.toks).forEach((t) => { df[t] = (df[t] || 0) + 1; todosToks.add(t); }); });
    return { mapa, df, todosToks, lista: Array.from(mapa.values()) };
  }
  // Devuelve { fuertes:[cliente], candidatos:[cliente] }
  function buscarClientes(qn, idx) {
    const qt = tokens(qn).filter((t) => !STOP.has(t));
    const rodeado = " " + qn + " ";
    const fuertes = [], candidatos = [];
    idx.lista.forEach((c) => {
      if (c.key.length >= 3 && rodeado.indexOf(" " + c.key + " ") > -1) { fuertes.push({ c, s: 10 + c.key.length / 10, frase: true }); return; }
      if (!c.toks.length) return;
      const acierta = c.toks.filter((t) => qt.some((x) => !RES.has(x) && simil(x, t)));
      if (acierta.length === c.toks.length && !(c.toks.length === 1 && GENERICAS.has(c.toks[0]))) { fuertes.push({ c, s: 5 + acierta.length }); return; }
      const distintivas = acierta.filter((t) => t.length >= 4 && !GENERICAS.has(t) && idx.df[t] <= 2);
      if (distintivas.length) candidatos.push({ c, s: distintivas.length / c.toks.length });
    });
    // si un nombre contiene a otro ("Carne Seca" ⊂ "Carne Seca el Barbas"), gana el más largo
    const fin = fuertes.filter((a) => !fuertes.some((b) => b !== a && b.c.key.length > a.c.key.length && (" " + b.c.key + " ").indexOf(" " + a.c.key + " ") > -1));
    fin.sort((a, b) => b.s - a.s);
    const topFrase = fin.filter((x) => x.frase);
    const fuertesFinal = (topFrase.length ? topFrase : fin).map((x) => x.c);
    candidatos.sort((a, b) => b.s - a.s);
    const cand = candidatos.map((x) => x.c).filter((c) => fuertesFinal.indexOf(c) === -1);
    if (!fuertesFinal.length && cand.length === 1) return { fuertes: cand, candidatos: [] };
    return { fuertes: fuertesFinal, candidatos: cand.slice(0, 6) };
  }
  function sugerirClientes(qn, idx) {
    const qt = tokens(qn).filter((t) => !STOP.has(t) && !RES.has(t) && t.length >= 5);
    const out = [];
    idx.lista.forEach((c) => {
      let mejor = 99;
      c.toks.forEach((t) => { if (t.length < 5) return; qt.forEach((x) => { const lim = Math.min(x.length, t.length) >= 8 ? 2 : 1; const d = dist(x, t, lim); if (d <= lim && d < mejor) mejor = d; if (x.length >= 5 && (t.indexOf(x) === 0 || x.indexOf(t) === 0)) mejor = Math.min(mejor, 1); }); });
      if (mejor <= 2) out.push({ c, d: mejor });
    });
    return out.sort((a, b) => a.d - b.d).slice(0, 3).map((x) => x.c);
  }

  /* ===================== filtros ===================== */
  function estatusEnPregunta(qt, vistos) {
    const completos = [], parciales = [];
    vistos.forEach((s) => {
      const toks = tokens(s).filter((t) => ["en", "de", "por", "a"].indexOf(t) === -1);
      if (!toks.length) return;
      const ok = (t) => qt.some((x) => (t.length <= 3 ? x === t : simil(x, t)));
      const hits = toks.filter(ok);
      if (hits.length === toks.length) completos.push(s);
      else if (toks.length > 1 && hits.length && ok(toks[toks.length - 1])) parciales.push(s);
    });
    return completos.length ? completos : parciales;
  }
  function leerFiltros(qn, proyectos, hoy) {
    const f = { estatus: [], vivos: false, porCobrar: false, pagados: false, sinAnticipo: false, factura: null, atrasados: false, rango: null, mes: null, modelo: null, grosor: null, sinCotizar: false, descr: [] };
    const qt = tokens(qn);
    const vistos = {}; proyectos.forEach((p) => { const s = estatusDe(p); if (s) vistos[s] = true; });
    f.estatus = estatusEnPregunta(qt, Object.keys(vistos));
    if (f.estatus.length) f.descr.push("estatus " + f.estatus.join(" / "));
    const por = /(por cobrar|cobrar|\bdebe\b|\bdeben\b|\bdebo\b|adeudo|saldo|sin pagar|falta(?:n)? (?:de )?pag|pendiente(?:s)? de (?:pago|cobro)|restante|\bdeuda|con deuda|les falta pagar|no han liquidado|sin liquidar)/.test(qn);
    if (por) { f.porCobrar = true; f.descr.push("con saldo pendiente"); }
    if (/(sin anticipo|no han pagado|no pagaron|sin pago|no han dado anticipo)/.test(qn)) { f.sinAnticipo = true; f.descr.push("sin anticipo"); }
    else if (/\b(pagado|pagados|liquidado|liquidados|pagaron|ya pagaron)\b/.test(qn) && !por) { f.pagados = true; f.descr.push("pagados al 100%"); }
    if (!por && !f.estatus.length && /\b(pendiente|pendientes|en curso|activo|activos|vivo|vivos|abierto|abiertos|por entregar|sin entregar|falta(?:n)? entregar|en proceso|en produccion)\b/.test(qn)) { f.vivos = true; f.descr.push("en curso"); }
    if (/sin factura/.test(qn)) { f.factura = false; f.descr.push("sin factura"); }
    else if (/(con factura|requieren factura|piden factura|pidieron factura|facturan|llevan factura)/.test(qn)) { f.factura = true; f.descr.push("con factura"); }
    if (/(sin cotizar|sin precio|por cotizar|no estan cotizad\w+|falta cotizar)/.test(qn)) { f.sinCotizar = true; f.descr.push("sin cotizar"); }
    if (/(atrasad|vencid|retrasad|ya pasaron|pasada de fecha|fuera de fecha)/.test(qn)) { f.atrasados = true; f.vivos = true; f.descr.push("atrasados"); }
    else if (/\bmanana\b/.test(qn)) { f.rango = [1, 1]; f.vivos = true; f.descr.push("entrega mañana"); }
    else if (/\bhoy\b/.test(qn) && /(entrega|entregan|entregar|vence|toca|salen|sale|para hoy)/.test(qn)) { f.rango = [0, 0]; f.vivos = true; f.descr.push("entrega hoy"); }
    else if (/(proxim|esta semana|siguientes? dias|por vencer|esta por vencer|en estos dias|esta por entregarse|proximas entregas)/.test(qn) && !/proximo mes/.test(qn)) { f.rango = [0, 7]; f.vivos = true; f.descr.push("próximos 7 días"); }
    const mes = qt.find((m) => MESES[m] !== undefined);
    if (mes) { f.mes = MESES[mes]; f.descr.push("entrega en " + MESES_TXT[f.mes]); }
    else if (/(mes pasado)/.test(qn)) { f.mes = (hoy.getMonth() + 11) % 12; f.descr.push("entrega en " + MESES_TXT[f.mes]); }
    else if (/(proximo mes|mes que viene|siguiente mes)/.test(qn)) { f.mes = (hoy.getMonth() + 1) % 12; f.descr.push("entrega en " + MESES_TXT[f.mes]); }
    else if (/(este mes|del mes|mes actual|en lo que va del mes)/.test(qn)) { f.mes = hoy.getMonth(); f.descr.push("entrega en " + MESES_TXT[f.mes]); }
    f.modelo = MODELOS_CLAVE.find((m) => qn.indexOf(m) > -1) || null;
    if (f.modelo) f.descr.push("modelo «" + f.modelo + "»");
    const g = qn.match(/\b(4\.5|4|5|6)\s*mm\b/);
    if (g) { f.grosor = g[1]; f.descr.push("grosor " + g[1] + " mm"); }
    return f;
  }
  const hayFiltros = (f) => !!(f.estatus.length || f.vivos || f.porCobrar || f.pagados || f.sinAnticipo || f.factura !== null || f.atrasados || f.rango || f.mes !== null || f.modelo || f.grosor || f.sinCotizar);

  function aplicar(proyectos, f, hoy) {
    return proyectos.filter((p) => {
      if (f.estatus.length && f.estatus.indexOf(estatusDe(p)) === -1) return false;
      if (f.vivos && !esVivo(p)) return false;
      if (f.porCobrar && !(precioDe(p) > 0 && saldoDe(p) > 0 && esVivo(p))) return false;
      if (f.pagados && !(liquidado(p))) return false;
      if (f.sinAnticipo && !(esVivo(p) && precioDe(p) > 0 && (pagoPct(p) === null || pagoPct(p) === 0))) return false;
      if (f.factura !== null && (norm(p.factura) === "si") !== f.factura) return false;
      if (f.sinCotizar && !(esVivo(p) && !precioDe(p))) return false;
      const d = diasPara(p, hoy);
      if (f.atrasados && !(d !== null && d < 0)) return false;
      if (f.rango && !(d !== null && d >= f.rango[0] && d <= f.rango[1])) return false;
      if (f.mes !== null) { const fe = fechaDe(p.fechaLimite, hoy); if (!(fe && fe.getMonth() === f.mes)) return false; }
      if (f.modelo && norm(p.tipo).indexOf(f.modelo) === -1) return false;
      if (f.grosor && !new RegExp("\\b" + f.grosor.replace(".", "\\.") + "\\b").test(norm(p.grosor))) return false;
      return true;
    });
  }

  /* ===================== presentación ===================== */
  const detalle = (html, etiqueta) => `<details style="margin-top:8px"><summary style="cursor:pointer;color:#888">${etiqueta || "Ver detalle"}</summary>${html}</details>`;
  const chips = (arr) => arr.length ? `<div class="chips">${arr.map(([t, q]) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(t)}</button>`).join("")}</div>` : "";
  const entendi = (partes) => partes.length ? `<div class="mut">Entendí: ${esc(partes.join(" · "))}</div>` : "";
  function saludo(hoy) { const h = hoy.getHours(); return h < 12 ? "¡Buenos días!" : h < 19 ? "¡Buenas tardes!" : "¡Buenas noches!"; }

  function pagoTxt(p) {
    const pr = precioDe(p); if (!pr) return "sin cotizar";
    const pc = pagoPct(p);
    if (pc === null) return esVivo(p) ? "sin anticipo registrado" : "entregado ✓";
    return pc >= 100 ? "pagado ✓" : "debe " + fmt(saldoDe(p));
  }
  function frase(lista, hoy) {
    if (!lista.length) return "";
    const n = lista.length;
    const porCobrar = lista.filter(esVivo).reduce((s, p) => s + saldoDe(p), 0);
    let t = elige(["Son ", "Tienes ", "Hay "]) + `<b>${plural(n, "proyecto", "proyectos")}</b>`;
    if (n <= 3) t += ": " + unico(lista.map((p) => p.cliente)).map((c) => `<b>${esc(c)}</b>`).join(", ").replace(/, ([^,]*)$/, " y $1");
    t += ".";
    const vivos = lista.filter(esVivo).map((p) => ({ p, d: diasPara(p, hoy) })).filter((x) => x.d !== null).sort((a, b) => a.d - b.d);
    const atras = vivos.filter((x) => x.d < 0), prox = vivos.filter((x) => x.d >= 0);
    if (atras.length) t += ` ⚠ ${atras.length === 1 ? `<b>${esc(atras[0].p.cliente)}</b> ya pasó su fecha (${esc(atras[0].p.fechaLimite)})` : `${atras.length} ya pasaron su fecha (el más atrasado: <b>${esc(atras[0].p.cliente)}</b>, ${esc(atras[0].p.fechaLimite)})`}.`;
    if (prox.length) t += ` El siguiente en entregarse es <b>${esc(prox[0].p.cliente)}</b> (${esc(prox[0].p.fechaLimite)}).`;
    if (porCobrar > 0) t += ` Falta cobrar <b>${fmt(porCobrar)}</b>.`;
    return t;
  }
  function filaProyecto(p) {
    const abre = p.codigo ? ` <a href="panel.html?abrir=${esc(p.codigo)}" class="mini">abrir ›</a>` : "";
    const pr = precioDe(p);
    return `<tr><td><b>${esc(p.cliente)}</b>${p.codigo ? `<br><code>${esc(p.codigo)}</code>` : ""}${abre}</td>` +
      `<td>${esc(limpio(p.tipo))}<br><small>${esc(limpio(p.cantidad))}${limpio(p.grosor) ? " · " + esc(p.grosor) : ""}</small></td>` +
      `<td>${esc(p.estatus || "—")}</td><td>${pr ? fmt(pr) : "—"}<br><small>${esc(pagoTxt(p))}</small></td>` +
      `<td>${esc(limpio(p.fechaLimite) || "—")}</td></tr>`;
  }
  function tabla(lista, max) {
    max = max || 25;
    return `<table><thead><tr><th>Cliente</th><th>Pedido</th><th>Estatus</th><th>Total</th><th>Entrega</th></tr></thead><tbody>${lista.slice(0, max).map(filaProyecto).join("")}</tbody></table>` +
      (lista.length > max ? `<div class="mut">…y ${lista.length - max} más. Afina la búsqueda (agrega estatus, mes o nombre).</div>` : "");
  }
  function resumen(lista) {
    const total = lista.reduce((s, p) => s + precioDe(p), 0);
    const porCobrar = lista.filter(esVivo).reduce((s, p) => s + saldoDe(p), 0);
    const sinCot = lista.filter((p) => !precioDe(p)).length;
    return `<b>${lista.length}</b> proyecto${lista.length === 1 ? "" : "s"} · total <b>${fmt(total)}</b> · por cobrar <b>${fmt(porCobrar)}</b>` + (sinCot ? ` · ${sinCot} sin cotizar` : "");
  }
  function ficha(p) {
    const pr = precioDe(p), pc = pagoPct(p);
    const filas = [
      ["Pedido", `${esc(limpio(p.tipo) || "—")} — ${esc(limpio(p.cantidad) || "—")}${limpio(p.grosor) ? " · " + esc(p.grosor) : ""}`],
      ["Estatus", esc(p.estatus || "—")],
      ["Total", pr ? fmt(pr) : "sin cotizar"],
      ["Pagado", pc === null ? (pr ? esc(pagoTxt(p)) : "—") : esc(pc + "%") + (pr && pc < 100 ? ` · debe ${fmt(saldoDe(p))}` : (pr ? " ✓" : ""))],
      ["Entrega", esc(limpio(p.fechaLimite) || "—")],
      ["Factura", esc(limpio(p.factura) || "—")],
      ["Hojas", limpio(p.hojas) ? esc(p.hojas) : "—"],
    ];
    if (p.zona) filas.push(["Zona", esc(p.zona)]);
    if (p.contacto) filas.push(["Contacto", esc(p.contacto)]);
    if (p.notas) filas.push(["Notas", esc(p.notas)]);
    return `<div class="card"><div class="ch"><b>${esc(p.cliente)}</b>${p.codigo ? ` <code>${esc(p.codigo)}</code> <a href="panel.html?abrir=${esc(p.codigo)}" class="mini">abrir en el panel ›</a>` : ""}</div>` +
      filas.map(([k, v]) => `<div class="cr"><span>${k}</span><span>${v}</span></div>`).join("") + `</div>`;
  }
  function fraseProyecto(p) {
    let t = `<b>${esc(p.cliente)}</b> va en <b>${esc(p.estatus || "sin estatus")}</b>`;
    if (limpio(p.fechaLimite)) t += `, entrega el ${esc(p.fechaLimite)}`;
    t += ".";
    const pr = precioDe(p);
    if (pr) { const pc = pagoPct(p); t += pc === null ? (esVivo(p) ? " Aún no hay anticipo registrado." : "") : pc >= 100 ? " Ya pagó todo ✓" : ` Pagó ${pc}% y debe <b>${fmt(saldoDe(p))}</b>.`; }
    else t += " Aún no está cotizado.";
    return t;
  }

  /* ===================== precios (motor real de joart-core.js) ===================== */
  function precios(q, core) {
    if (!core) return null;
    const t = norm(q);
    const num_ = "(\\d+(?:[.,]\\d+)?)";
    const md = t.match(new RegExp(num_ + "\\s*(?:x|por|\\*)\\s*" + num_ + "\\s*(?:x|por|\\*)\\s*" + num_));
    const gm = t.match(/\b(4|5|6)\s*mm\b/);
    const qm = t.match(/(\d{1,3})\s*(?:piezas?|pzs?|pz|unidades|exhibidores|displays?)\b/);
    if (md && !/(catalogo|medidas del catalogo)/.test(t)) {
      const A = parseFloat(md[1].replace(",", ".")), B = parseFloat(md[2].replace(",", ".")), C = parseFloat(md[3].replace(",", "."));
      const nm = t.match(/(\d+)\s*(niveles?|charolas?|escalon\w*|separadores?|divisiones|rejillas?)/);
      const n = nm ? parseInt(nm[1], 10) : 1;
      const tipo = nm && /escalon/.test(nm[2]) ? "escalonado" : nm && /separador|division|rejilla/.test(nm[2]) ? "separadores" : "niveles";
      const cant = qm ? parseInt(qm[1], 10) : 1;
      const grosor = gm ? gm[1] + " mm" : (A >= 100 ? "5 mm" : "4 mm");
      const g = core.geomPers(A, B, C, n, tipo), hp = core.hpExhibidor(g);
      if (!g || !hp) return null;
      const unit = core.cotizarPersonalizado(A, B, C, n, cant, grosor, tipo);
      return `<b>Personalizado ${A}×${B}×${C} cm</b> · ${n} ${tipo === "escalonado" ? "escalón(es)" : tipo === "separadores" ? "separador(es)" : "nivel(es)"} · ${grosor}<br>` +
        `Hojas por pieza: <b>${hp.toFixed(2)}</b> · ${cant} pz → ${(hp * cant).toFixed(2)} hojas<br>` +
        `Precio unitario: <b>${fmt(unit)}</b> · Total <b>${fmt(unit * cant)}</b> <span class="mut">(IVA incluido, entrega estándar, una cara)</span>`;
    }
    if (core.parsearPedidoTexto) {
      const r = core.parsearPedidoTexto(q);
      const lineas = [];
      (r.items || []).forEach((it) => {
        if (it.modelo === core.PERSONALIZADO) return;
        const m = (core.MODELOS || []).find((x) => x.nombre === it.modelo);
        const grosor = r.grosor || (m && m.piso ? "5 mm" : "4 mm");
        const unit = core.precioCatalogo(it.modelo, grosor, it.cantidad);
        if (unit == null) { lineas.push(`${esc(it.modelo)}: no existe en ${grosor} (usa ${core.grosoresDeModelo(it.modelo).join(" / ")})`); return; }
        lineas.push(`<b>${it.cantidad} × ${esc(it.modelo)}</b> (${grosor}): ${fmt(unit)} c/u → <b>${fmt(unit * it.cantidad)}</b>`);
      });
      if (lineas.length) return lineas.join("<br>") + `<br><span class="mut">Precio de catálogo, IVA incluido, entrega estándar, una cara.</span>`;
    }
    return null;
  }

  /* ===================== inventario ===================== */
  function inventarioHTML(datos) {
    const inv = datos.inventario || [];
    if (!inv.length) return "No pude leer la pestaña «Láminas» del Sheets. Revisa que el script esté actualizado.";
    const filas = inv.map((i) => {
      const dif = Math.round((i.laminas - i.enCola) * 100) / 100;
      return `<tr><td><b>${esc(i.grosor)}</b></td><td>${i.laminas}</td><td>${i.enCola}</td><td>${dif >= 0 ? "sobran " + dif : "<b>faltan " + (-dif) + "</b>"}</td></tr>`;
    }).join("");
    const faltan = inv.filter((i) => i.enCola > i.laminas);
    const corto = faltan.length
      ? `⚠ Ojo: no alcanza de ${faltan.map((i) => `<b>${esc(i.grosor)}</b> (faltan ${Math.round((i.enCola - i.laminas) * 10) / 10})`).join(" y ")}. Lo demás sí alcanza.`
      : `Todo bien: con lo que hay en Imprimir te alcanzan las láminas de todos los grosores.` + (inv[0] ? ` De ${esc(inv[0].grosor)} tienes <b>${inv[0].laminas}</b> y ocupas <b>${inv[0].enCola}</b>.` : "");
    return corto + detalle(`<table><thead><tr><th>Grosor</th><th>Tengo</th><th>Necesito</th><th>Balance</th></tr></thead><tbody>${filas}</tbody></table>` +
      `<div class="mut">Necesito = láminas de los pedidos en Imprimir y Repetir. Sale de la pestaña «Láminas» del Sheets${datos.ultimoConteo ? " · último conteo: " + esc(datos.ultimoConteo) : ""}.</div>`, "Ver todas");
  }

  function topModelos(proyectos) {
    const mapa = {};
    proyectos.forEach((p) => {
      const nums = (String(p.cantidad).replace(/\d+\s*\/\s*\d+/g, "").match(/\d+/g) || []).map((n) => parseInt(n, 10));
      const lineas = String(p.tipo || "").split(/\s\+\s|\s+y\s+(?=[A-ZÁÉÍÓÚa-z])/).filter((l) => l.trim() && !/^env[ií]o/i.test(l.trim()));
      lineas.forEach((linea, idx) => {
        const m = linea.match(/^(?:(\d+)\s*x\s+)?(.+?)(?:\s*\([^)]*\))?\s*$/i);
        if (!m) return;
        const nombre = m[2].trim();
        const cant = m[1] ? parseInt(m[1], 10) : (lineas.length === 1 ? (nums[0] || 1) : (nums.length === lineas.length ? nums[idx] : 1));
        const o = mapa[nombre.toLowerCase()] || (mapa[nombre.toLowerCase()] = { nombre, piezas: 0, pedidos: 0 });
        o.piezas += cant; o.pedidos += 1;
      });
    });
    return Object.keys(mapa).map((k) => ({ modelo: mapa[k].nombre, piezas: mapa[k].piezas, pedidos: mapa[k].pedidos })).sort((a, b) => b.piezas - a.piezas);
  }

  /* ===================== datos puntuales de un cliente ===================== */
  const CAMPOS = [
    ["contacto", /(telefono|whatsapp|contacto|celular|numero de|correo|\bnumero\b)/],
    ["factura", /(factura|facturar|facturan)/],
    ["notas", /\b(notas?|detalles?|comentarios?|observaci\w+|indicaciones)\b/],
    ["zona", /\b(zona|ciudad|direccion|a donde se envia|destino)\b/],
    ["piezas", /(cuant[oa]s? (piezas|pzs|exhibidores|displays?|llevan|lleva|son|pidio|pidieron)|\bcantidad\b|\bpiezas\b)/],
    ["hojas", /(cuant[oa]s? (hojas|laminas)|\bhojas\b|\blaminas\b)/],
    ["grosor", /\b(grosor|milimetros|que mm)\b/],
    ["tipo", /(que (pidio|pidieron|llevo|lleva|modelo|tipo|compro|compraron|es (el|su) pedido)|\bmodelo\b|de que es)/],
    ["fecha", /(cuando|\bfecha\b|entrega|entregan|entregar|para cuando|que dia|plazo|se acaba)/],
    ["dinero", /(\bdebe\b|\bdeben\b|\bdebo\b|saldo|adeudo|cuanto falta|por cobrar|restante|\bpago\b|\bpagó\b|\bpago\b|pagado|pagaron|\bpagar\b|anticipo|liquid\w+|abono|cuanto lleva|cuanto ha dado)/],
    ["precio", /(precio|\btotal\b|cuanto (cuesta|costo|cobramos|es|sale|vale|fue)|costo|cotizacion)/],
    ["estatus", /(estatus|status|como va|en que va|etapa|en que esta|que paso con|donde va|ya esta (listo|lista)|avance|como esta|como andan?|va en)/],
  ];
  function camposPedidos(qn) {
    const hit = [];
    CAMPOS.forEach(([c, re]) => { if (re.test(qn)) hit.push(c); });
    // "fecha" y "dinero" mandan sobre "precio"/"estatus" si coinciden
    if (hit.indexOf("dinero") > -1) return hit.filter((c) => c !== "precio" && c !== "estatus" || c === "estatus" && /como va|estatus|status/.test(qn));
    return hit;
  }
  function respuestaCampo(campo, p, hoy, varios) {
    const nom = `<b>${esc(p.cliente)}</b>`;
    const tag = varios ? ` <small>(${esc(limpio(p.tipo) || "pedido")}${limpio(p.cantidad) ? ", " + esc(p.cantidad) : ""})</small>` : "";
    const pr = precioDe(p), pc = pagoPct(p);
    switch (campo) {
      case "dinero":
        if (!pr) return `${nom}${tag} todavía no está cotizado.`;
        if (liquidado(p)) return pc === null ? `${nom}${tag}: ${fmt(pr)}, ya entregado; no hay % de pago anotado, lo tomo como liquidado.` : `${nom}${tag} ya pagó todo (${fmt(pr)}) ✓`;
        if (pc === null) return `${nom}${tag}: ${fmt(pr)} y todavía no hay anticipo registrado, debe <b>${fmt(pr)}</b>.`;
        return `${nom}${tag} lleva <b>${pc}%</b> de ${fmt(pr)}; te debe <b>${fmt(saldoDe(p))}</b>.`;
      case "precio": return pr ? `${nom}${tag}: <b>${fmt(pr)}</b> en total.` : `${nom}${tag} todavía no está cotizado.`;
      case "fecha": {
        const f = limpio(p.fechaLimite), d = diasPara(p, hoy);
        if (!esVivo(p)) return `${nom}${tag} ya está en <b>${esc(p.estatus)}</b>${f ? " (fecha: " + esc(f) + ")" : ""}.`;
        if (!f) return `${nom}${tag} todavía no tiene fecha de entrega; va en ${esc(p.estatus || "—")}.`;
        return `${nom}${tag} se entrega el <b>${esc(f)}</b>` + (d === null ? "" : d < 0 ? ` (<b>hace ${plural(-d, "día", "días")}</b> ⚠)` : d === 0 ? " (<b>hoy</b>)" : d === 1 ? " (mañana)" : ` (en ${d} días)`) + `; ahorita va en ${esc(p.estatus || "—")}.`;
      }
      case "estatus": return `${nom}${tag} va en <b>${esc(p.estatus || "sin estatus")}</b>${limpio(p.fechaLimite) ? `, entrega el ${esc(p.fechaLimite)}` : ""}.`;
      case "contacto": return `${nom}${tag}: ${p.contacto ? esc(p.contacto) : "no tiene contacto registrado"}`;
      case "factura": return `${nom}${tag}: ` + (norm(p.factura) === "si" ? "<b>sí</b> pidió factura." : norm(p.factura) === "no" ? "<b>no</b> pidió factura." : "no hay dato de factura.");
      case "notas": return `${nom}${tag}: ` + (p.notas ? esc(p.notas) : "sin notas.");
      case "zona": return `${nom}${tag}: ` + (p.zona ? esc(p.zona) : "sin zona registrada.");
      case "piezas": return `${nom}${tag}: <b>${esc(limpio(p.cantidad) || "sin cantidad")}</b>.`;
      case "hojas": return `${nom}${tag}: ` + (hojasDe(p) ? `unas <b>${Math.round(hojasDe(p) * 100) / 100}</b> hojas (${esc(p.hojas)}).` : "sin hojas calculadas todavía.");
      case "grosor": return `${nom}${tag}: ${esc(limpio(p.grosor) || "sin grosor registrado")}.`;
      case "tipo": return `${nom}${tag} pidió <b>${esc(limpio(p.tipo) || "—")}</b>${limpio(p.cantidad) ? ", " + esc(p.cantidad) : ""}${limpio(p.grosor) ? " en " + esc(p.grosor) : ""}.`;
    }
    return "";
  }

  /* ===================== memoria de la conversación ===================== */
  const ctx = { cliente: null, lista: null, t: 0 };
  function olvidarSiViejo() { if (Date.now() - ctx.t > 10 * 60 * 1000) { ctx.cliente = null; ctx.lista = null; } }
  function recordar(o) { if (o.cliente !== undefined) ctx.cliente = o.cliente; if (o.lista !== undefined) ctx.lista = o.lista; ctx.t = Date.now(); }

  /* ===================== respuestas por tipo de pregunta ===================== */
  const AYUDA_HTML = () => `Pregúntame como le preguntarías a alguien del equipo. Puedo con:<br>
• <b>Un cliente</b>: «¿cómo va Wingman?», «¿cuánto debe Aviador?», «¿cuándo se entrega Tapekenos?», «teléfono de Café Myrna»<br>
• <b>Listas</b>: «¿qué hay en imprimir?», «atrasados», «por cobrar», «los que piden factura», «pendientes de render»<br>
• <b>Cuentas</b>: «¿cuántos hay en imprimir?», «¿cuánto nos deben?», «ventas de septiembre», «¿cuántas piezas llevamos?»<br>
• <b>Rankings</b>: «el pedido más grande», «quién debe más», «el más urgente»<br>
• <b>Láminas y precios</b>: «¿alcanzan las láminas?», «precio de 15 floor stand 3 niveles»<br>
Puedes encadenar: «¿cómo va Match?» → «¿y cuánto debe?» → «de esos, los atrasados».` +
    chips([["¿Qué hay pendiente?", "resumen"], ["En imprimir", "proyectos en imprimir"], ["Atrasados", "proyectos atrasados"], ["Por cobrar", "por cobrar"]]);

  function resumenGeneral(proyectos, hoy) {
    const vivos = proyectos.filter(esVivo);
    const dias = DIAS_TXT[hoy.getDay()] + " " + hoy.getDate() + " de " + MESES_TXT[hoy.getMonth()];
    if (!vivos.length) return { html: `Hoy es ${dias} y no veo proyectos en curso.` };
    const porEst = {};
    vivos.forEach((p) => { const e = (p.estatus || "sin estatus").trim(); porEst[e] = (porEst[e] || 0) + 1; });
    const ORDEN = ["imprimir", "enviar", "yo", "hacer render", "corregir render", "en revision", "repetir"];
    const claves = Object.keys(porEst).sort((a, b) => { const ia = ORDEN.indexOf(norm(a)), ib = ORDEN.indexOf(norm(b)); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || porEst[b] - porEst[a]; });
    const atras = vivos.map((p) => ({ p, d: diasPara(p, hoy) })).filter((x) => x.d !== null && x.d < 0).sort((a, b) => a.d - b.d);
    const prox = vivos.map((p) => ({ p, d: diasPara(p, hoy) })).filter((x) => x.d !== null && x.d >= 0 && x.d <= 7).sort((a, b) => a.d - b.d);
    const cobrar = vivos.reduce((s, p) => s + saldoDe(p), 0);
    const sinCot = vivos.filter((p) => !precioDe(p) && ["hacer render", "corregir render", "en revision"].indexOf(estatusDe(p)) === -1).length;
    let h = `<b>${plural(vivos.length, "proyecto en curso", "proyectos en curso")}</b> (${dias}).<br>` + claves.map((k) => `• ${esc(k)}: <b>${porEst[k]}</b>`).join("<br>");
    if (atras.length) h += `<br>⚠ <b>${plural(atras.length, "atrasado", "atrasados")}</b>: ` + atras.slice(0, 3).map((x) => `${esc(x.p.cliente)} (${esc(x.p.fechaLimite)})`).join(", ") + (atras.length > 3 ? `… y ${atras.length - 3} más` : "");
    if (prox.length) h += `<br>📅 Próximos 7 días: ` + prox.slice(0, 3).map((x) => `${esc(x.p.cliente)} (${esc(x.p.fechaLimite)})`).join(", ") + (prox.length > 3 ? `… y ${prox.length - 3} más` : "");
    if (cobrar > 0) h += `<br>💰 Por cobrar: <b>${fmt(cobrar)}</b>`;
    if (sinCot) h += `<br>📝 ${plural(sinCot, "pedido sin cotizar", "pedidos sin cotizar")}`;
    const cs = claves.slice(0, 3).map((k) => ["Ver " + k, "proyectos en " + k]);
    if (atras.length) cs.push(["Atrasados", "proyectos atrasados"]);
    if (cobrar > 0) cs.push(["Por cobrar", "por cobrar"]);
    recordar({ lista: vivos });
    return { html: h + chips(cs) };
  }

  function listaRespuesta(lista, f, qn, hoy, base) {
    const ent = f.descr.slice();
    if (!lista.length) {
      recordar({ lista: [] });
      return { html: elige(["Nada por ahí", "No hay ninguno", "Cero"]) + ` (${esc(f.descr.join(" · ") || "con eso")}). 👌` + entendi(ent) };
    }
    const ps = lista.reduce((s, p) => s + piezasDe(p), 0);
    let lead;
    if (/cuant[oa]s? (piezas|pzs|exhibidores|displays?)/.test(qn)) lead = `Son <b>${ps}</b> piezas en ${plural(lista.length, "proyecto", "proyectos")}.`;
    else if (/cuant[oa]s? (hojas|laminas)|laminas (ocupan|necesit|requier|llevan|usan)|hojas (ocupan|necesit|requier|llevan|usan)/.test(qn)) { const h = lista.reduce((s, p) => s + hojasDe(p), 0); lead = h ? `Esos ${plural(lista.length, "proyecto", "proyectos")} ocupan unas <b>${(Math.round(h * 10) / 10)}</b> hojas.` : `Son ${plural(lista.length, "proyecto", "proyectos")}, pero ninguno tiene hojas calculadas todavía en el Sheets.`; }
    else if (/\bcuant[oa]s\b/.test(qn) && !/\bcuanto\b/.test(qn)) lead = `Hay <b>${plural(lista.length, "proyecto", "proyectos")}</b>${f.descr.length ? " (" + esc(f.descr.join(", ")) + ")" : ""}.`;
    else if ((f.porCobrar || f.sinAnticipo) && !/\bcuanto\b/.test(qn) && !f.estatus.length) {
      const deb = lista.filter(esVivo).slice().sort((a, b) => saldoDe(b) - saldoDe(a));
      lead = `Faltan por cobrar <b>${fmt(deb.reduce((s, p) => s + saldoDe(p), 0))}</b> en ${plural(lista.length, "proyecto", "proyectos")}.` + (deb.length ? ` El que más debe es <b>${esc(deb[0].cliente)}</b> (${fmt(saldoDe(deb[0]))}).` : "");
    }
    else if (/\bcuanto\b/.test(qn) && (f.porCobrar || f.sinAnticipo || /(deben|debe|cobrar|saldo|adeudo)/.test(qn))) {
      const tot = lista.filter(esVivo).reduce((s, p) => s + saldoDe(p), 0);
      lead = `Faltan por cobrar <b>${fmt(tot)}</b>, repartidos en ${plural(lista.length, "proyecto", "proyectos")}.`;
    } else if (/\bcuanto\b/.test(qn)) lead = `Suman <b>${fmt(lista.reduce((s, p) => s + precioDe(p), 0))}</b> en ${plural(lista.length, "proyecto", "proyectos")}.`;
    else lead = frase(lista, hoy);
    const nota = f.mes !== null ? `<div class="mut">El mes se toma de la <b>fecha de entrega</b> (el Sheets no guarda la fecha en que se hizo el pedido).</div>` : "";
    recordar({ lista });
    const cs = [];
    if (lista.length > 1) { cs.push(["¿Cuánto suman?", "cuánto suman esos"]); if (!f.atrasados) cs.push(["De esos, los atrasados", "de esos los atrasados"]); if (!f.porCobrar) cs.push(["De esos, los que deben", "de esos los que tienen saldo"]); cs.push(["El más urgente", "de esos el más urgente"]); }
    return { html: lead + detalle(`<div class="mut">${esc(f.descr.join(" · "))}</div>${resumen(lista)}${tabla(lista)}${nota}`, "Ver lista") + entendi(ent) + chips(cs) };
  }

  function ranking(lista, tipo, hoy, ent) {
    let ord, tit, val;
    if (tipo === "saldo") { lista = lista.filter((p) => esVivo(p) && saldoDe(p) > 0); ord = (a, b) => saldoDe(b) - saldoDe(a); tit = "los que más deben"; val = (p) => fmt(saldoDe(p)); }
    else if (tipo === "precio") { ord = (a, b) => precioDe(b) - precioDe(a); tit = "los pedidos más grandes"; val = (p) => fmt(precioDe(p)); }
    else if (tipo === "piezas") { ord = (a, b) => piezasDe(b) - piezasDe(a); tit = "los pedidos con más piezas"; val = (p) => piezasDe(p) + " pzs"; }
    else { lista = lista.filter((p) => esVivo(p) && diasPara(p, hoy) !== null); ord = (a, b) => diasPara(a, hoy) - diasPara(b, hoy); tit = "los más urgentes"; val = (p) => { const d = diasPara(p, hoy); return (d < 0 ? "hace " + (-d) + " d ⚠" : d === 0 ? "hoy" : "en " + d + " d") + " · " + (limpio(p.fechaLimite)); }; }
    if (!lista.length) return { html: "No encontré proyectos para ordenar con eso." + entendi(ent) };
    const top = lista.slice().sort(ord).slice(0, 3);
    recordar({ lista: top, cliente: top.length ? top[0] : null });
    const h = `<b>${elige(["El primero", "Arriba de la lista"])}:</b> ${esc(top[0].cliente)} (${esc(val(top[0]))}).` +
      (top.length > 1 ? `<br>Les siguen: ` + top.slice(1).map((p) => `${esc(p.cliente)} (${esc(val(p))})`).join(", ") + "." : "");
    return { html: h + detalle(tabla(top), "Ver " + tit) + entendi(ent) + chips([["Ficha de " + top[0].cliente, "cómo va " + top[0].cliente]]) };
  }

  function chipsCliente(nombre) {
    return chips([["¿Cuánto debe?", "cuánto debe " + nombre], ["¿Cuándo se entrega?", "cuándo se entrega " + nombre], ["Contacto", "contacto de " + nombre], ["Ficha completa", "ficha de " + nombre]]);
  }

  /* ===================== respuesta principal ===================== */
  function responder(pregunta, datos, opts) {
    opts = opts || {};
    const hoy = opts.hoy || new Date();
    olvidarSiViejo();
    const todos = ((datos && datos.proyectos) || []).filter(esProyectoReal);
    const q0 = String(pregunta || "").trim();
    let qn = norm(q0);
    if (!qn) return { html: AYUDA_HTML() };

    // muletillas y saludos al inicio
    let hubo = false, prev;
    do { prev = qn; qn = qn.replace(/^(hola|buenos dias|buenas tardes|buenas noches|buen dia|buenas|que onda|que tal|hey|ey|oye|disculpa|perdon|por favor|porfa|a ver|bueno|pues|entonces|dime|me puedes decir|me podrias decir|puedes decirme|quiero saber|necesito saber|quisiera saber|sabes|sabrias|ok|okay)\b[ ,]*/, ""); if (qn !== prev) hubo = true; } while (qn !== prev && qn);
    { const sin = qn.replace(/\b(por favor|porfa|gracias)\s*$/, "").trim(); if (sin) qn = sin; }

    if (!qn) return { html: hubo ? `${saludo(hoy)} ${(function () { const v = todos.filter(esVivo).length, i = todos.filter((p) => estatusDe(p) === "imprimir").length; return v ? `Hay ${plural(v, "proyecto", "proyectos")} en curso${i ? `, ${i} en Imprimir` : ""}.` : ""; })()} ¿En qué te ayudo?` + chips([["¿Qué hay pendiente?", "resumen"], ["Ayuda", "ayuda"]]) : AYUDA_HTML() };
    if (/^(ayuda|help|que puedes hacer|como funcionas|que sabes hacer|que puedo preguntar|como te uso|para que sirves|que haces)\b/.test(qn)) return { html: AYUDA_HTML() };
    if (/^(gracias|grax|thx|va|vale|perfecto|listo|chido|sale|genial|excelente|muy bien|de acuerdo|entendido|super)\b/.test(qn) && tokens(qn).length <= 4) return { html: elige(["¡De nada! ¿Algo más?", "Para eso estoy. ¿Qué más necesitas?", "¡Listo! Aquí sigo si necesitas algo."]) };
    if (/^(adios|hasta luego|nos vemos|bye|chao|me voy)\b/.test(qn)) return { html: "¡Hasta luego! 👋" };
    if (/(quien eres|como te llamas|eres una ia|eres humano|eres inteligencia|usas ia|que eres)/.test(qn)) return { html: "Soy el asistente de Joart Core. No uso inteligencia artificial: leo tu Sheets y lo ordeno con reglas, por eso respondo al instante. Si no entiendo algo, te lo digo en vez de adivinar." };
    if (/(que (dia|fecha) es|a cuanto estamos|que hora es)/.test(qn)) return { html: `Hoy es ${DIAS_TXT[hoy.getDay()]} ${hoy.getDate()} de ${MESES_TXT[hoy.getMonth()]} de ${hoy.getFullYear()}.` };

    const idx = indexarClientes(todos);
    qn = corregir(qn, idx.todosToks);
    SINONIMOS.forEach(([re, rep]) => { qn = qn.replace(re, rep); });
    if (/^(resumen|pendientes?|que hay pendiente|novedades|panorama)$/.test(qn) || /(como vamos|como estamos|como esta todo|que tenemos pendiente|que hay pendiente|que hay que hacer|que hago hoy|que toca hoy|que hay para hoy|que tengo que hacer|estado general|resumen (del dia|general|de hoy)|dame un resumen|que sigue\b)/.test(qn)) {
      if (!estatusEnPregunta(tokens(qn), unico(todos.map(estatusDe).filter(Boolean))).length) return resumenGeneral(todos, hoy);
    }

    // 1) código de seguimiento
    const cm = q0.toUpperCase().match(/JD-[A-Z0-9]{3,6}/);
    if (cm) {
      const hallados = todos.filter((p) => p.codigo === cm[0]);
      if (hallados.length) { recordar({ cliente: hallados[0], lista: hallados }); return { html: hallados.map((p) => fraseProyecto(p) + detalle(ficha(p))).join("<br>") + chipsCliente(hallados[0].cliente) }; }
      return { html: `No encuentro ningún proyecto con el código <code>${esc(cm[0])}</code>. ¿Lo escribiste bien?` };
    }

    // 2) precios de catálogo / medidas (solo si de verdad se puede cotizar)
    const pidePrecio = /(precio|cuesta|cuestan|cotiza|cotizar|costo|cuanto sale|cuanto salen|cuanto vale|cuanto cobr)/.test(qn);
    if (pidePrecio) { const r = precios(q0, opts.core); if (r) return { html: r + entendi(["cotización de catálogo"]) }; }

    // 3) entidades
    const filtros = leerFiltros(qn, todos, hoy);
    const hit = buscarClientes(qn, idx);
    let clientes = hit.fuertes;
    const campos = camposPedidos(qn);

    // 3a) inventario / láminas (solo si no hablan de un cliente ni de una lista)
    const pideLaminas = /\b(lamina|laminas|inventario|stock)\b/.test(qn) || (/\b(hoja|hojas)\b/.test(qn) && /(alcanz|quedan|tenemos|tengo|hay|faltan|sobran|comprar|surtir)/.test(qn));
    if (pideLaminas && !clientes.length && !hayFiltros(filtros)) return { html: inventarioHTML(datos || {}) };

    // 3b) seguimiento de la conversación
    const refLista = /\b(esos|esas|ellos|ellas|estos|estas|de la lista|de ahi|de los anteriores|ese grupo)\b/.test(qn);
    const refCliente = !clientes.length && ctx.cliente && (/^(y|e|pero|tambien|ademas|entonces)\b/.test(qn) || /\b(su|sus|le|el mismo|ese|esa|de el|de ella)\b/.test(qn)) && (campos.length > 0 || !hayFiltros(filtros));
    if (refCliente && !refLista) { const nm = norm(ctx.cliente.cliente); const g = idx.mapa.get(nm); if (g) clientes = [g]; }
    const heredaLista = refLista && ctx.lista && ctx.lista.length;

    // 4) rankings (el más grande, quién debe más, el más urgente…)
    const rk = /(que mas debe|quien mas debe|quien debe mas|cual debe mas|el que mas debe|mayor deuda|mayor saldo|mas adeuda|mas debe|debe mas|mas deben|deben mas)/.test(qn) ? "saldo"
      : /(mas piezas)/.test(qn) ? "piezas"
      : /(mas caro|mas grande|mayor|mas alto|de mas valor|el mejor pedido|mas dinero)/.test(qn) && !/\bmayoreo\b/.test(qn) ? "precio"
      : /(mas urgente|mas atrasad\w*|mas viejo|siguiente en entregar|siguiente entrega|proxim[oa] a entregar|el siguiente|el que sigue|cual sigue|primero en entregar|primero a entregar|que entrego primero)/.test(qn) ? "urgente" : null;
    if (rk && !clientes.length) {
      let base = heredaLista ? ctx.lista : todos;
      if (hayFiltros(filtros)) base = aplicar(base, filtros, hoy);
      else if (rk !== "precio" && rk !== "piezas") base = base.filter(esVivo);
      const ent = ["ranking " + (rk === "saldo" ? "por saldo" : rk === "precio" ? "por monto" : rk === "piezas" ? "por piezas" : "por urgencia")].concat(filtros.descr);
      return ranking(base, rk, hoy, ent);
    }

    // 5) modelos más pedidos
    if (/\b(mas vendid\w*|mas pedid\w*|populares?|top|favorit\w*|que modelos|cuales modelos|modelos mas|modelos que mas|modelo mas)\b/.test(qn) && !clientes.length) {
      let base = heredaLista ? ctx.lista : todos;
      if (hayFiltros(filtros)) base = aplicar(base, filtros, hoy);
      const top = topModelos(base).slice(0, 8);
      if (!top.length) return { html: "No encontré proyectos para armar el ranking." };
      return { html: `<b>Modelos más pedidos</b>${filtros.descr.length ? " (" + esc(filtros.descr.join(", ")) + ")" : ""}:<table><thead><tr><th>Modelo</th><th>Piezas</th><th>Pedidos</th></tr></thead><tbody>` +
        top.map((t) => `<tr><td>${esc(t.modelo)}</td><td>${t.piezas}</td><td>${t.pedidos}</td></tr>`).join("") + `</tbody></table>` + entendi(["ranking de modelos"].concat(filtros.descr)) };
    }

    // 6) uno o varios clientes
    if (clientes.length) {
      const grupos = clientes.slice(0, 4);
      const ent = ["cliente " + grupos.map((g) => g.nombre).join(" + ")];
      let todosProy = [];
      const bloques = grupos.map((g) => {
        let lista = g.proyectos;
        const fc = Object.assign({}, filtros); if (campos.indexOf("dinero") > -1) { fc.porCobrar = false; fc.sinAnticipo = false; fc.pagados = false; }
        if (campos.indexOf("fecha") > -1 || campos.indexOf("estatus") > -1) fc.estatus = [];
        if (hayFiltros(fc)) { const f2 = aplicar(lista, fc, hoy); if (f2.length) lista = f2; }
        todosProy = todosProy.concat(lista);
        const varios = lista.length > 1;
        const lineas = campos.length ? campos.map((c) => lista.map((p) => respuestaCampo(c, p, hoy, varios)).join("<br>")) : null;
        if (lineas) return lineas.join("<br>");
        if (!varios) return fraseProyecto(lista[0]) + detalle(ficha(lista[0]));
        const vivosC = lista.filter(esVivo);
        return `Encontré ${plural(lista.length, "pedido", "pedidos")} de <b>${esc(g.nombre)}</b>${vivosC.length ? `; ${vivosC.length} en curso` : ", todos ya entregados"}.` + (vivosC.length ? "<br>" + vivosC.slice(0, 3).map(fraseProyecto).join("<br>") : "") + detalle(tabla(lista), "Ver todos");
      });
      if (campos.length) ent.push("dato: " + campos.join(" + "));
      if (hayFiltros(filtros) && campos.indexOf("dinero") === -1 && campos.indexOf("fecha") === -1 && campos.indexOf("estatus") === -1) ent.push(filtros.descr.join(", "));
      recordar({ cliente: todosProy[0] || grupos[0].proyectos[0], lista: todosProy });
      return { html: bloques.join("<br>") + entendi(refCliente ? ent.concat(["(sigo hablando de " + grupos[0].nombre + ")"]) : ent) + (grupos.length === 1 ? chipsCliente(grupos[0].nombre) : "") };
    }

    // 7) varios candidatos parecidos → pregunto
    if (hit.candidatos.length) {
      return { html: `Hay varios clientes que se parecen a eso. ¿Cuál de estos?` + chips(hit.candidatos.map((c) => [c.nombre, q0 + " (" + c.nombre + ")"])) };
    }

    // 7b) piden precio pero no pude cotizar: pido lo que falta en vez de listar cualquier cosa
    if (pidePrecio && !(filtros.mes !== null || filtros.atrasados || filtros.porCobrar || filtros.vivos)) return { html: "Para cotizar dime el modelo y las piezas, o las medidas. Si preguntas por un cliente, dime su nombre." + chips([["Ejemplo: catálogo", "precio de 15 floor stand 3 niveles"], ["Ejemplo: medidas", "cotiza personalizado 120x50x30 3 niveles 10 piezas"]]) };

    // 8) listas con filtros (o continuación de "de esos…")
    if (heredaLista && !hayFiltros(filtros) && /(cuanto|suman|total|cuantos|cuantas)/.test(qn)) {
      const l = ctx.lista;
      return listaRespuesta(l, { descr: ["la lista anterior"], porCobrar: /(deben|debe|cobrar|saldo|adeudo)/.test(qn) }, qn.replace(/suman/g, "cuanto"), hoy);
    }
    if (hayFiltros(filtros) || heredaLista) {
      const base = heredaLista ? ctx.lista : todos;
      const lista = aplicar(base, filtros, hoy);
      const f = Object.assign({}, filtros, { descr: (heredaLista ? ["de la lista anterior"] : []).concat(filtros.descr) });
      return listaRespuesta(lista, f, qn, hoy, base);
    }

    // 9) precio sin poder cotizar
    if (pidePrecio) return { html: "Para cotizar dime el modelo y las piezas, o las medidas." + chips([["Ejemplo: catálogo", "precio de 15 floor stand 3 niveles"], ["Ejemplo: medidas", "cotiza personalizado 120x50x30 3 niveles 10 piezas"]]) };

    // 10) totales generales
    if (/(cuanto vendimos|ventas|facturado|ingresos|total vendido|cuanto llevamos|cuanto hemos vendido|cuanto hemos cobrado)/.test(qn)) {
      const tot = todos.reduce((s, p) => s + precioDe(p), 0);
      return { html: `En total llevas <b>${fmt(tot)}</b> en ${plural(todos.filter((p) => precioDe(p) > 0).length, "proyecto cotizado", "proyectos cotizados")}. Si quieres un mes, pregúntame «ventas de septiembre».` + chips([["Ventas de este mes", "ventas de este mes"], ["Por cobrar", "por cobrar"]]) };
    }
    if (/(cuantos|cuantas) (proyectos|pedidos|hay|tenemos|clientes)/.test(qn)) {
      return { html: `Hay ${plural(todos.length, "proyecto", "proyectos")} en el Sheets; <b>${todos.filter(esVivo).length}</b> siguen en curso.` + chips([["Ver en curso", "pendientes"], ["Resumen", "resumen"]]) };
    }
    if (/\b(piezas|pzs)\b/.test(qn) && /cuant/.test(qn)) {
      const v = todos.filter(esVivo);
      return { html: `En los ${plural(v.length, "proyecto en curso", "proyectos en curso")} hay unas <b>${v.reduce((s, p) => s + piezasDe(p), 0)}</b> piezas.` };
    }

    // 11) búsqueda libre, pero estricta: TODAS las palabras deben aparecer
    const palabras = tokens(qn).filter((t) => !STOP.has(t) && !RES.has(t) && t.length >= 3);
    if (palabras.length) {
      const tb = (p) => tokens([p.cliente, p.tipo, p.zona, p.contacto, p.notas, p.codigo].join(" "));
      const lista = todos.filter((p) => { const t = tb(p); return palabras.every((w) => t.some((x) => x === w || simil(x, w))); });
      if (lista.length && lista.length <= 40) {
        recordar({ lista, cliente: lista.length === 1 ? lista[0] : undefined });
        return { html: (lista.length === 1 ? fraseProyecto(lista[0]) + detalle(ficha(lista[0])) : frase(lista, hoy) + detalle(tabla(lista), "Ver lista")) + entendi(["búsqueda de «" + palabras.join(" ") + "» en cliente, pedido, zona y notas"]) };
      }
    }

    // 12) no entendí: lo digo, ofrezco lo más parecido y botones
    const sug = sugerirClientes(qn, idx);
    if (sug.length) return { html: `No estoy seguro de qué me preguntas. ¿Hablas de alguno de estos?` + chips(sug.map((c) => [c.nombre, "cómo va " + c.nombre])) };
    return { html: elige(["No te entendí bien.", "Eso no lo pude interpretar.", "Ahí me perdí."]) + ` Prefiero decírtelo que inventar una respuesta. Prueba con el nombre de un cliente, un estatus («qué hay en imprimir») o toca una opción:` +
      chips([["¿Qué hay pendiente?", "resumen"], ["Atrasados", "proyectos atrasados"], ["Por cobrar", "por cobrar"], ["¿Qué puedo preguntar?", "ayuda"]]) };
  }

  const Motor = { responder, norm, AYUDA: AYUDA_HTML(), reset: () => { ctx.cliente = null; ctx.lista = null; ctx.t = 0; } };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
  else root.Motor = Motor;
})(typeof window !== "undefined" ? window : globalThis);
