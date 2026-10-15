/* Joart — motor del Asistente SIN IA.
 * Entiende preguntas en español con reglas simples y las responde buscando directo en los
 * proyectos del Sheets. No llama a ningún servicio externo: es instantáneo y no falla por "alta demanda".
 * Uso: Motor.responder(pregunta, { proyectos, inventario, movimientos }, { core, hoy }) -> { html }
 */
(function (root) {
  "use strict";

  const MESES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
  const MESES_TXT = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const STOP = new Set(("de la el los las un una unos unas y o a e en con por para que cual cuales cuanto cuantos cuanta cuantas es son esta estan " +
    "tiene tienen hay del al me mi mis tu su sus lo le se si no como donde cuando quien dame dime muestrame muestra ver lista listame todos todas todo " +
    "proyecto proyectos pedido pedidos cliente clientes negocio negocios hay tengo tenemos hacer hace dame quiero ya").split(" "));
  const MODELOS_CLAVE = ["floor stand", "pop display", "display box", "escalonado", "repisas", "separadores", "pegboard", "counter", "personalizado", "ganchos"];

  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9$%.\-]+/g, " ").replace(/\s+/g, " ").trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => "$" + Math.round(n).toLocaleString("es-MX");
  const tokens = (s) => norm(s).split(" ").filter(Boolean);
  const tokEq = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
  const pct = (p) => { const n = parseFloat(String(p == null ? "" : p).replace("%", "").replace(",", ".")); return isNaN(n) ? 0 : n; };
  const estatusDe = (p) => norm(p.estatus);
  const esVivo = (p) => ["entregado", "enviado", "cancelado"].indexOf(estatusDe(p)) === -1;
  const saldoDe = (p) => Math.max(0, (p.precio || 0) * (1 - pct(p.pagado) / 100));

  function fechaDe(txt, hoy) {
    const m = norm(txt).match(/(\d{1,2}) de ([a-z]+)/);
    if (!m || MESES[m[2]] === undefined) return null;
    let d = new Date(hoy.getFullYear(), MESES[m[2]], parseInt(m[1], 10), 12, 0, 0);
    if ((d - hoy) / 86400000 < -200) d = new Date(hoy.getFullYear() + 1, MESES[m[2]], parseInt(m[1], 10), 12, 0, 0);
    return d;
  }

  // ---------- presentación ----------
  function filaProyecto(p) {
    const abre = p.codigo ? ` <a href="panel.html?abrir=${esc(p.codigo)}" class="mini">abrir ›</a>` : "";
    const saldo = p.precio ? (pct(p.pagado) >= 100 ? "pagado ✓" : "debe " + fmt(saldoDe(p))) : "sin cotizar";
    return `<tr><td><b>${esc(p.cliente)}</b>${p.codigo ? `<br><code>${esc(p.codigo)}</code>` : ""}${abre}</td>` +
      `<td>${esc(p.tipo)}<br><small>${esc(p.cantidad)}${p.grosor ? " · " + esc(p.grosor) : ""}</small></td>` +
      `<td>${esc(p.estatus || "—")}</td><td>${p.precio ? fmt(p.precio) : "—"}<br><small>${esc(saldo)}</small></td>` +
      `<td>${esc(p.fechaLimite || "—")}</td></tr>`;
  }
  function tabla(lista, max) {
    max = max || 25;
    const filas = lista.slice(0, max).map(filaProyecto).join("");
    return `<table><thead><tr><th>Cliente</th><th>Pedido</th><th>Estatus</th><th>Total</th><th>Entrega</th></tr></thead><tbody>${filas}</tbody></table>` +
      (lista.length > max ? `<div class="mut">…y ${lista.length - max} más. Afina la búsqueda (ej. agrega el estatus o el nombre).</div>` : "");
  }
  function resumen(lista) {
    const total = lista.reduce((s, p) => s + (p.precio || 0), 0);
    const porCobrar = lista.reduce((s, p) => s + saldoDe(p), 0);
    const sinCot = lista.filter((p) => !p.precio).length;
    return `<b>${lista.length}</b> proyecto${lista.length === 1 ? "" : "s"} · total <b>${fmt(total)}</b> · por cobrar <b>${fmt(porCobrar)}</b>` + (sinCot ? ` · ${sinCot} sin cotizar` : "");
  }
  function ficha(p) {
    const filas = [
      ["Pedido", `${esc(p.tipo)} — ${esc(p.cantidad)}${p.grosor ? " · " + esc(p.grosor) : ""}`],
      ["Estatus", esc(p.estatus || "—")],
      ["Total", p.precio ? fmt(p.precio) : "sin cotizar"],
      ["Pagado", esc(p.pagado || "0%") + (p.precio && pct(p.pagado) < 100 ? ` · debe ${fmt(saldoDe(p))}` : (p.precio ? " ✓" : ""))],
      ["Entrega", esc(p.fechaLimite || "—")],
      ["Factura", esc(p.factura || "—")],
      ["Hojas", p.hojas ? esc(p.hojas) : "—"],
    ];
    if (p.zona) filas.push(["Zona", esc(p.zona)]);
    if (p.contacto) filas.push(["Contacto", esc(p.contacto)]);
    if (p.notas) filas.push(["Notas", esc(p.notas)]);
    return `<div class="card"><div class="ch"><b>${esc(p.cliente)}</b>${p.codigo ? ` <code>${esc(p.codigo)}</code>` : ""}${p.codigo ? ` <a href="panel.html?abrir=${esc(p.codigo)}" class="mini">abrir en el panel ›</a>` : ""}</div>` +
      filas.map(([k, v]) => `<div class="cr"><span>${k}</span><span>${v}</span></div>`).join("") + `</div>`;
  }

  // ---------- precios (motor de precios real de joart-core.js) ----------
  function precios(q, core) {
    if (!core) return null;
    const t = norm(q);
    const num = "(\\d+(?:[.,]\\d+)?)";
    const md = t.match(new RegExp(num + "\\s*(?:x|por|\\*)\\s*" + num + "\\s*(?:x|por|\\*)\\s*" + num));
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

  // ---------- inventario ----------
  function inventarioHTML(datos) {
    const inv = datos.inventario || [];
    if (!inv.length) return "No pude leer el inventario. Revisa que el script esté actualizado.";
    const filas = inv.map((i) => {
      const dif = Math.round((i.laminas - i.enCola) * 100) / 100;
      return `<tr><td><b>${esc(i.grosor)}</b></td><td>${i.laminas}</td><td>${i.enCola}</td><td>${dif >= 0 ? "sobran " + dif : "<b>faltan " + (-dif) + "</b>"}</td></tr>`;
    }).join("");
    const mov = (datos.movimientos || []).slice(0, 4).map((m) => `${esc(m.fecha)} · ${esc(m.tipo)} ${esc(m.grosor)} (${m.laminas > 0 ? "+" : ""}${m.laminas})`).join("<br>");
    return `<table><thead><tr><th>Grosor</th><th>Disponibles</th><th>Comprometidas</th><th>Balance</th></tr></thead><tbody>${filas}</tbody></table>` +
      `<div class="mut">Comprometidas = hojas de proyectos que aún no están Enviados/Entregados.</div>` + (mov ? `<div class="mut" style="margin-top:6px">Últimos movimientos:<br>${mov}</div>` : "");
  }

  // ---------- filtros ----------
  function leerFiltros(qn, proyectos, hoy) {
    const f = { estatus: [], vivos: false, porCobrar: false, pagados: false, sinAnticipo: false, factura: null, atrasados: false, proximos: false, mes: null, modelo: null, descr: [] };
    const qt = tokens(qn);
    // estatus que existen de verdad en tu Sheets
    const vistos = {};
    proyectos.forEach((p) => { const s = estatusDe(p); if (s) vistos[s] = true; });
    Object.keys(vistos).forEach((s) => {
      const dist = tokens(s).filter((t) => ["en", "de", "por", "hacer", "ya", "a"].indexOf(t) === -1 && t.length > 2);
      if (dist.length && dist.every((d) => qt.some((t) => tokEq(t, d)))) { f.estatus.push(s); }
    });
    if (f.estatus.length) f.descr.push("estatus " + f.estatus.join(" / "));
    const por = /(por cobrar|cobrar|\bdebe\b|\bdeben\b|adeudo|saldo|sin pagar|falta(?:n)? (?:de )?pag|pendiente(?:s)? de (?:pago|cobro)|restante|\bdeuda)/.test(qn);
    if (por) { f.porCobrar = true; f.descr.push("con saldo pendiente"); }
    if (/(sin anticipo|no han pagado|no pagaron|sin pago)/.test(qn)) { f.sinAnticipo = true; f.descr.push("sin anticipo"); }
    else if (/\b(pagado|pagados|liquidado|liquidados|pagaron)\b/.test(qn) && !por) { f.pagados = true; f.descr.push("pagados al 100%"); }
    if (!por && /\b(pendiente|pendientes|en curso|activo|activos|vivo|vivos|abierto|abiertos|por entregar|sin entregar|en proceso)\b/.test(qn) && !f.estatus.length) { f.vivos = true; f.descr.push("en curso"); }
    if (/sin factura/.test(qn)) { f.factura = false; f.descr.push("sin factura"); }
    else if (/(con factura|requieren factura|piden factura|facturan)/.test(qn)) { f.factura = true; f.descr.push("con factura"); }
    if (/(atrasad|vencid|retrasad)/.test(qn)) { f.atrasados = true; f.vivos = true; f.descr.push("atrasados"); }
    else if (/(proxim|esta semana|siguientes? dias|por vencer|esta por vencer)/.test(qn)) { f.proximos = true; f.vivos = true; f.descr.push("próximos a vencer (7 días)"); }
    const mes = Object.keys(MESES).find((m) => qt.indexOf(m) > -1);
    if (mes) { f.mes = MESES[mes]; f.descr.push("entrega en " + MESES_TXT[MESES[mes]]); }
    else if (/(mes pasado)/.test(qn)) { f.mes = (hoy.getMonth() + 11) % 12; f.descr.push("entrega en " + MESES_TXT[f.mes]); }
    else if (/(este mes|del mes|mes actual|en lo que va del mes)/.test(qn)) { f.mes = hoy.getMonth(); f.descr.push("entrega en " + MESES_TXT[f.mes]); }
    f.modelo = MODELOS_CLAVE.find((m) => qn.indexOf(m) > -1) || null;
    if (f.modelo) f.descr.push("modelo «" + f.modelo + "»");
    return f;
  }
  function hayFiltros(f) { return !!(f.estatus.length || f.vivos || f.porCobrar || f.pagados || f.sinAnticipo || f.factura !== null || f.atrasados || f.proximos || f.mes !== null || f.modelo); }

  function aplicar(proyectos, f, hoy) {
    return proyectos.filter((p) => {
      if (f.estatus.length && f.estatus.indexOf(estatusDe(p)) === -1) return false;
      if (f.vivos && !esVivo(p)) return false;
      if (f.porCobrar && !(p.precio > 0 && pct(p.pagado) < 100 && esVivo(p))) return false;
      if (f.pagados && !(pct(p.pagado) >= 100)) return false;
      if (f.sinAnticipo && !(pct(p.pagado) === 0 && esVivo(p))) return false;
      if (f.factura !== null && (norm(p.factura) === "si") !== f.factura) return false;
      const fecha = fechaDe(p.fechaLimite, hoy);
      if (f.atrasados && !(fecha && fecha < hoy)) return false;
      if (f.proximos && !(fecha && fecha >= hoy && (fecha - hoy) / 86400000 <= 7)) return false;
      if (f.mes !== null && !(fecha && fecha.getMonth() === f.mes)) return false;
      if (f.modelo && norm(p.tipo).indexOf(f.modelo) === -1) return false;
      return true;
    });
  }

  // ---------- clientes ----------
  function coincidenClientes(qn, proyectos) {
    const qt = tokens(qn);
    const fuertes = proyectos.filter((p) => {
      const cn = norm(p.cliente);
      if (cn.length < 3) return false;
      if ((" " + qn + " ").indexOf(" " + cn + " ") > -1) return true;
      const ct = tokens(p.cliente).filter((t) => !STOP.has(t) && t.length >= 3);
      return ct.length > 0 && ct.every((t) => qt.some((x) => tokEq(x, t)));
    });
    if (fuertes.length) return fuertes;
    // coincidencia parcial: una palabra distintiva del nombre del cliente
    const genericas = new Set(["tienda", "display", "floor", "stand", "pop", "box", "super", "mini", "grupo", "casa", "dulces", "farmacia", "tiendas"]);
    return proyectos.filter((p) => {
      const ct = tokens(p.cliente).filter((t) => !STOP.has(t) && t.length >= 4 && !genericas.has(t));
      return ct.some((t) => qt.some((x) => x.length >= 4 && tokEq(x, t) && !STOP.has(x)));
    });
  }

  function textoBusqueda(p) { return norm([p.cliente, p.tipo, p.estatus, p.zona, p.contacto, p.notas, p.codigo, p.cantidad].join(" ")); }

  function topModelos(proyectos) {
    const mapa = {};
    proyectos.forEach((p) => {
      const nums = (String(p.cantidad).match(/\d+/g) || []).map((n) => parseInt(n, 10));
      const lineas = String(p.tipo || "").split(/\s\+\s/).filter((l) => !/^env[ií]o/i.test(l.trim()));
      lineas.forEach((linea, idx) => {
        const m = linea.match(/^(?:(\d+)\s*x\s+)?(.+?)(?:\s*\([^)]*\))?\s*$/i);
        if (!m) return;
        const nombre = m[2].trim();
        const cant = m[1] ? parseInt(m[1], 10) : (lineas.length === 1 ? (nums[0] || 1) : (nums.length === lineas.length ? nums[idx] : 1));
        const o = mapa[nombre] || (mapa[nombre] = { piezas: 0, pedidos: 0 });
        o.piezas += cant; o.pedidos += 1;
      });
    });
    return Object.keys(mapa).map((n) => ({ modelo: n, piezas: mapa[n].piezas, pedidos: mapa[n].pedidos })).sort((a, b) => b.piezas - a.piezas);
  }

  // ---------- respuesta principal ----------
  const AYUDA = `Puedo buscar directo en tus proyectos (sin IA, al instante). Prueba así:<br>
• <b>Un cliente</b>: «Tienda Uno», «cuánto debe Tienda Uno», «teléfono de Dulces López»<br>
• <b>Un código</b>: «JD-4X7K2»<br>
• <b>Por estatus</b>: «proyectos en imprimir», «qué falta por hacer render», «entregados»<br>
• <b>Dinero</b>: «por cobrar», «sin anticipo», «ventas de octubre», «con factura»<br>
• <b>Fechas</b>: «atrasados», «próximos a vencer», «entregas de noviembre»<br>
• <b>Modelos</b>: «floor stand en imprimir», «modelos más pedidos»<br>
• <b>Láminas</b>: «inventario», «cuántas hojas necesitan los de imprimir»<br>
• <b>Precios</b>: «precio de 15 floor stand 3 niveles», «cotiza personalizado 120x50x30 3 niveles 10 piezas»`;

  function responder(pregunta, datos, opts) {
    opts = opts || {};
    const hoy = opts.hoy || new Date();
    const proyectos = (datos && datos.proyectos) || [];
    const q = String(pregunta || "").trim();
    const qn = norm(q);
    if (!qn) return { html: AYUDA };
    if (/^(ayuda|help|que puedes hacer|como funcionas|que sabes hacer|hola|buenas?)\b/.test(qn)) return { html: AYUDA };

    // 1) código de seguimiento
    const cm = q.toUpperCase().match(/JD-[A-Z0-9]{3,6}/);
    if (cm) {
      const hallados = proyectos.filter((p) => p.codigo === cm[0]);
      return { html: hallados.length ? hallados.map(ficha).join("") : `No hay ningún proyecto con el código <code>${esc(cm[0])}</code> en el Sheets.` };
    }

    // 2) precios / cotizaciones (usa el motor de precios real)
    if (/(precio|cuesta|cuestan|cotiza|cotizar|costo|cuanto sale|cuanto salen|cuanto vale)/.test(qn)) {
      const r = precios(q, opts.core);
      if (r) return { html: r };
      return { html: "Para cotizar dime el modelo y las piezas (ej. «precio de 15 floor stand 3 niveles»), o las medidas: «cotiza personalizado 120x50x30 3 niveles 10 piezas»." };
    }

    // 3) inventario / láminas
    const pideLaminas = /(lamina|laminas|hoja|hojas|inventario|stock)/.test(qn);
    const filtros = leerFiltros(qn, proyectos, hoy);
    const clientes = coincidenClientes(qn, proyectos);
    if (pideLaminas && !clientes.length) {
      if (hayFiltros(filtros) && /(necesit|requier|ocupan|llevan|comprometid|usan|gastan|cuantas)/.test(qn) && !/(disponible|quedan|tenemos|hay)/.test(qn)) {
        const lista = aplicar(proyectos, filtros, hoy);
        const total = lista.reduce((s, p) => s + (p.hojas || 0), 0);
        return { html: `Los proyectos (${esc(filtros.descr.join(", "))}) suman <b>${total.toFixed(2)}</b> hojas.<br>${resumen(lista)}${lista.length ? tabla(lista, 15) : ""}` };
      }
      return { html: inventarioHTML(datos || {}) };
    }

    // 4) modelos más pedidos
    if (/(mas vendid|mas pedid|populares|top|favorit|que modelos|cuales modelos)/.test(qn)) {
      let base = proyectos;
      if (hayFiltros(filtros)) base = aplicar(proyectos, filtros, hoy);
      const top = topModelos(base).slice(0, 8);
      if (!top.length) return { html: "No encontré proyectos para armar el ranking." };
      return { html: `<b>Modelos más pedidos</b>${filtros.descr.length ? " (" + esc(filtros.descr.join(", ")) + ")" : ""}:<table><thead><tr><th>Modelo</th><th>Piezas</th><th>Pedidos</th></tr></thead><tbody>` +
        top.map((t) => `<tr><td>${esc(t.modelo)}</td><td>${t.piezas}</td><td>${t.pedidos}</td></tr>`).join("") + `</tbody></table>` };
    }

    // 5) cliente(s) + pregunta puntual
    if (clientes.length) {
      let lista = clientes;
      if (hayFiltros(filtros)) { const f2 = aplicar(clientes, filtros, hoy); if (f2.length) lista = f2; }
      const unico = lista.length === 1;
      const p0 = lista[0];
      if (/(telefono|whatsapp|contacto|celular|numero de)/.test(qn)) {
        return { html: lista.map((p) => `<b>${esc(p.cliente)}</b>: ${p.contacto ? esc(p.contacto) : "no tiene contacto registrado"}`).join("<br>") };
      }
      if (/(\bdebe\b|\bdeben\b|saldo|adeudo|cuanto falta|por cobrar|restante)/.test(qn)) {
        const filas = lista.map((p) => `<b>${esc(p.cliente)}</b>${p.codigo ? " <code>" + esc(p.codigo) + "</code>" : ""}: ${p.precio ? (pct(p.pagado) >= 100 ? "pagado completo ✓" : "debe <b>" + fmt(saldoDe(p)) + "</b> de " + fmt(p.precio) + " (pagado " + esc(p.pagado || "0%") + ")") : "aún sin cotizar"}`);
        return { html: filas.join("<br>") };
      }
      if (/(cuando|fecha|entrega|para cuando)/.test(qn) && unico) {
        return { html: `<b>${esc(p0.cliente)}</b>: entrega ${esc(p0.fechaLimite || "sin fecha")} · estatus ${esc(p0.estatus || "—")}.` };
      }
      if (/(estatus|status|como va|en que va|etapa|en que esta)/.test(qn)) {
        return { html: lista.map((p) => `<b>${esc(p.cliente)}</b>${p.codigo ? " <code>" + esc(p.codigo) + "</code>" : ""}: <b>${esc(p.estatus || "—")}</b>${p.fechaLimite ? " · entrega " + esc(p.fechaLimite) : ""}`).join("<br>") };
      }
      if (unico) return { html: ficha(p0) };
      return { html: `${resumen(lista)}${tabla(lista)}` };
    }

    // 6) filtros (estatus, dinero, fechas, modelo…)
    if (hayFiltros(filtros)) {
      const lista = aplicar(proyectos, filtros, hoy);
      const encab = esc(filtros.descr.join(" · "));
      if (!lista.length) return { html: `No hay proyectos con: ${encab}.` };
      const nota = filtros.mes !== null ? `<div class="mut">El mes se toma de la <b>fecha de entrega</b> (el Sheets no guarda la fecha en que se hizo el pedido).</div>` : "";
      if (/(cuantos|cuantas|numero de)/.test(qn) && !/(debe|cobrar|vendimos|ventas|total)/.test(qn)) return { html: `${resumen(lista)}<div class="mut">${encab}</div>${nota}${tabla(lista, 8)}` };
      return { html: `<div class="mut">${encab}</div>${resumen(lista)}${tabla(lista)}${nota}` };
    }

    // 7) totales generales
    if (/(cuanto vendimos|ventas|facturado|ingresos|total vendido|cuanto llevamos)/.test(qn)) {
      return { html: `${resumen(proyectos)}<div class="mut">Suma de todos los proyectos del Sheets. Para un mes pregunta «ventas de octubre» (se toma por fecha de entrega).</div>` };
    }
    if (/(cuantos proyectos|cuantos pedidos|cuantos hay)/.test(qn)) {
      return { html: `${resumen(proyectos)}<br>En curso: <b>${proyectos.filter(esVivo).length}</b>` };
    }

    // 8) búsqueda libre en todo el texto
    const palabras = tokens(qn).filter((t) => !STOP.has(t) && t.length >= 3);
    if (palabras.length) {
      const lista = proyectos.filter((p) => { const tb = textoBusqueda(p); return palabras.every((w) => tb.indexOf(w) > -1); });
      if (lista.length) return { html: `${resumen(lista)}${tabla(lista)}` };
      const alguna = proyectos.filter((p) => { const tb = textoBusqueda(p); return palabras.some((w) => w.length >= 4 && tb.indexOf(w) > -1); });
      if (alguna.length && alguna.length <= 12) return { html: `No encontré una coincidencia exacta; esto se parece:${tabla(alguna)}` };
    }
    return { html: `No encontré nada con «${esc(q)}». Prueba con el nombre del cliente, un código JD-…, un estatus o escribe «ayuda».` };
  }

  const Motor = { responder, norm, AYUDA };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
  else root.Motor = Motor;
})(typeof window !== "undefined" ? window : globalThis);
