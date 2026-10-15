/* ====================================================================
   JOART CORE — la única fuente de precios, modelos, geometría, dictado y acomodo.
   Lo usan: panel.html, configurador.html y tandas.html.
   Para cambiar un precio o una medida, se cambia SOLO aquí.
   ==================================================================== */
// ===================== PRECIOS (misma tabla de tu Sheets "Precios") =====================
const QUIEBRES = [1, 3, 5, 10, 15, 20, 25, 30, 50, 75, 100];
const TABLA_POR_MODELO = {
  "Counter display compacto con organizador": "counter",
  "Display con separadores": "separadores",
  "Pegboard display con ganchos": "pegboard",
  "Display escalonado — 2 escalones": "escalonado2",
  "Display escalonado — 3 escalones": "escalonado3",
  "Display box — 1 nivel": "displaybox",
  "POP display — 2 niveles": "pop2",
  "POP display chico — 2 niveles": "pop2",
  "POP display — 3 niveles": "pop3repisas",
  "Display con repisas": "pop3repisas",
  "Floor stand — 3 niveles": "floor3",
  "Floor stand — 4 niveles": "floor4",
  "Floor stand — 5 niveles": "floor5",
  "Floor stand chico — 3 niveles": "floor3",
  "Floor stand con ganchos": "floor3",
};
const PRECIOS = {
  counter: { "4 mm": [250,215,180,160,150,145,140,130,120,110,100] },
  displaybox: {
    "4 mm": [500,450,420,380,350,330,310,300,280,260,250],
    "5 mm": [650,600,570,530,500,480,460,450,430,410,400],
    "6 mm": [900,850,820,780,750,730,710,700,680,660,650],
  },
  pop2: {
    "4 mm": [800,720,680,610,560,530,500,480,450,420,400],
    "5 mm": [950,870,830,760,710,680,650,630,600,570,550],
    "6 mm": [1200,1120,1080,1010,960,930,900,880,850,820,800],
  },
  pop3repisas: {
    "4 mm": [1050,975,930,870,830,800,760,730,715,690,670],
    "5 mm": [1200,1125,1080,1020,980,950,910,880,865,840,820],
    "6 mm": [1450,1375,1330,1270,1230,1200,1160,1130,1115,1090,1070],
  },
  floor3: {
    "4 mm": [1300,1200,1150,1050,1000,950,920,890,850,825,800],
    "5 mm": [1450,1350,1300,1200,1150,1100,1070,1040,1000,975,950],
    "6 mm": [1700,1600,1550,1450,1400,1350,1320,1290,1250,1225,1200],
  },
  floor4: {
    "4 mm": [1700,1580,1500,1400,1350,1285,1230,1200,1150,1110,1070],
    "5 mm": [1850,1730,1650,1550,1500,1435,1380,1350,1300,1260,1220],
    "6 mm": [2100,1980,1900,1800,1750,1685,1630,1600,1550,1510,1470],
  },
  floor5: {
    "4 mm": [2600,2500,2400,2300,2200,2100,2000,1900,1800,1700,1600],
    "5 mm": [2750,2650,2550,2450,2350,2250,2150,2050,1950,1850,1750],
    "6 mm": [3000,2900,2800,2700,2600,2500,2400,2300,2200,2100,2000],
  },
  separadores: { "4 mm": [250,240,228,220,205,195,185,170,160,150,140] },
  pegboard: {
    "4 mm": [400,380,360,340,320,300,280,260,240,220,200],
    "5 mm": [550,530,510,490,470,450,430,410,390,370,350],
    "6 mm": [800,780,760,740,720,700,680,660,640,620,600],
  },
  escalonado2: {
    "4 mm": [665,630,595,560,525,490,455,420,385,350,315],
    "5 mm": [815,780,745,710,675,640,605,570,535,500,465],
    "6 mm": [1065,1030,995,960,925,890,855,820,785,750,715],
  },
  escalonado3: {
    "4 mm": [570,545,515,485,455,430,400,370,345,315,285],
    "5 mm": [720,695,665,635,605,580,550,520,495,465,435],
    "6 mm": [970,945,915,885,855,830,800,770,745,715,685],
  },
};
function grosoresDeModelo(modelo){ const t = PRECIOS[TABLA_POR_MODELO[modelo]]; return t ? Object.keys(t) : ["4 mm","5 mm","6 mm"]; }
function escalonIdx(cantidad){ let idx = 0; for(let i = 0; i < QUIEBRES.length; i++) if(cantidad >= QUIEBRES[i]) idx = i; return idx; }
function precioCatalogo(modelo, grosor, cantidad){
  const tabla = PRECIOS[TABLA_POR_MODELO[modelo]];
  if(!tabla || !tabla[grosor]) return null;
  return tabla[grosor][escalonIdx(cantidad)];
}

// ===================== PERSONALIZADOS (mismo algoritmo del Agente / hoja "Cotización Personalizada") =====================
const TARIFA_A = [[0,2050],[0.5,1950],[1,1850],[2,1700],[4,1550],[7,1400],[10,1300],[15,1200],[20,1100],[30,1050],[50,1000],[100,900]];
const TARIFA_B = [[0,1300],[3,1250],[5,1200],[7,1150],[10,1100],[15,1050],[20,1000],[30,950],[50,900],[100,800]];
const EXTRA_GROSOR = { "4 mm": 0, "5 mm": 150, "6 mm": 400 };
function tarifaPara(tabla, ht){ let t = tabla[0][1]; for(const [min, precio] of tabla) if(ht >= min) t = precio; return t; }
// ----- Área equivalente (cm²) de un exhibidor a medida, según su tipo -----
//  niveles     : charolas/niveles (POP display, floor stand, box…)            n = niveles
//  escalonado  : escalones (sin letrero por escalón)                          n = escalones
//  separadores : una sola charola con N divisiones (rejilla de separadores)   sep = N separadores
// Calibrado con el catálogo: 2 y 3 escalones (±7 %) y "Display con separadores" (0 %). Las divisiones miden ~⅓ de un lateral.
const SEP_FACTOR = 0.33;
const TIPOS_PERS = {
  niveles:     { etiqueta: "Niveles / charolas", unidad: ["nivel", "niveles"] },
  escalonado:  { etiqueta: "Escalones",          unidad: ["escalón", "escalones"] },
  separadores: { etiqueta: "Separadores (divisiones)", unidad: ["separador", "separadores"] },
};
function areaExhibidor(g){
  const [A, B, C] = g.d, N = Math.max(1, g.n || 1), tipo = g.tipo === "pegboard" ? "niveles" : (g.tipo || "niveles");
  const apoyos = N >= 2 ? (N - 1) * 2 * (B * 3) : 0;
  if(tipo === "escalonado")  return A*B + 2*(A*C) + N*(B*C) + apoyos;
  if(tipo === "separadores") return A*B + 2*(A*C) + B*C + B*5 + (g.sep || 0) * SEP_FACTOR * (A*C);
  return A*B + 2*(A*C) + N*(B*C) + N*(B*5) + apoyos;
}
// Hojas por pieza (fórmula de personalizados): área / 26,000 cm², y de 0.8 a 0.99 se cobra la hoja completa.
function hpExhibidor(g){ if(!g) return null; let HP = areaExhibidor(g) / 26000; if(HP >= 0.8 && HP < 1) HP = 1; return HP; }
// Convierte lo capturado (alto, ancho, prof, cantidad de niveles/escalones/separadores, tipo) en la geometría estándar.
function geomPers(alto, ancho, prof, cuantos, tipo){
  const a = parseFloat(alto), b = parseFloat(ancho), c = parseFloat(prof), n = Math.max(1, parseInt(cuantos, 10) || 1);
  if(!(a > 0 && b > 0 && c > 0)) return null;
  tipo = TIPOS_PERS[tipo] ? tipo : "niveles";
  return tipo === "separadores" ? { d: [a, b, c], tipo, n: 1, sep: n } : { d: [a, b, c], tipo, n };
}
function cotizarPersonalizado(alto, ancho, prof, niveles, cantidad, grosor, tipo){
  const Q = cantidad;
  const HP = hpExhibidor(geomPers(alto, ancho, prof, niveles, tipo));
  const HT = HP * Q;
  const costoHoja = tarifaPara(HP < 0.8 ? TARIFA_A : TARIFA_B, HT);
  const base = Math.ceil((Math.round(HT * costoHoja / Q * 100) / 100) / 5) * 5;
  return base + (EXTRA_GROSOR[grosor] || 0);
}
// Redondeo hacia arriba al siguiente múltiplo de $5 (con protección contra errores de decimales)
const up5 = (n) => Math.ceil(Math.round(n * 100) / 100 / 5) * 5;

const MODELOS = [
  { nombre: "Counter display compacto con organizador", medidas: "22 x 21 x 16 cm", piso: false },
  { nombre: "Display con separadores", medidas: "28.5 x 34.5 x 19 cm", piso: false },
  { nombre: "Pegboard display con ganchos", medidas: "50 x 35 x 18.5 cm", piso: false },
  { nombre: "Display escalonado — 2 escalones", medidas: "50 x 42 x 31.5 cm", piso: false },
  { nombre: "Display escalonado — 3 escalones", medidas: "50.5 x 31 x 31 cm", piso: false },
  { nombre: "Display box — 1 nivel", medidas: "50 x 42 x 31.5 cm", piso: false },
  { nombre: "POP display — 2 niveles", medidas: "60 x 42 x 36.5 cm", piso: false },
  { nombre: "POP display chico — 2 niveles", medidas: "72 x 42 x 29.5 cm", piso: false },
  { nombre: "POP display — 3 niveles", medidas: "90 x 41.5 x 36.5 cm", piso: false },
  { nombre: "Display con repisas", medidas: "52.5 x 63 x 31.5 cm", piso: false },
  { nombre: "Floor stand — 3 niveles", medidas: "140 x 50 x 36.5 cm", piso: true },
  { nombre: "Floor stand — 4 niveles", medidas: "140 x 50 x 35.5 cm", piso: true },
  { nombre: "Floor stand — 5 niveles", medidas: "160 x 51.5 x 41.5 cm", piso: true },
  { nombre: "Floor stand chico — 3 niveles", medidas: "120 x 50 x 26.5 cm", piso: true },
  { nombre: "Floor stand con ganchos", medidas: "140 x 52 x 42.5 cm", piso: true },
];
const PERSONALIZADO = "__personalizado__";

// ===================== CONSTANTES DE PRODUCCIÓN =====================
const HOJA = { ancho: 244, alto: 122, area: 244 * 122 };                       // cm (el lado largo va siempre horizontal)
const CARGA_POR_NIVEL = { "4 mm": 2.5, "5 mm": 6, "6 mm": 9 };                  // kg por nivel (2+ niveles)
const ESCALAS_WEB = [1, 10, 50, 100];                                            // escalas que muestra la web pública
const GROSORES_VALIDOS = ["4 mm", "5 mm", "6 mm"];

// ===================== GEOMETRÍA POR MODELO (alto, ancho, fondo en cm) =====================
// tipo: niveles | escalonado | separadores | pegboard  ·  n: niveles o escalones
const GEOM = {
  "Counter display compacto con organizador": { d: [22, 21, 16], tipo: "niveles", n: 1 },
  "Display con separadores":                  { d: [28.5, 34.5, 19], tipo: "separadores", n: 1, sep: 2 },
  "Pegboard display con ganchos":             { d: [50, 35, 18.5], tipo: "pegboard", n: 1 },
  "Display escalonado — 2 escalones":         { d: [50, 42, 31.5], tipo: "escalonado", n: 2 },
  "Display escalonado — 3 escalones":         { d: [50.5, 31, 31], tipo: "escalonado", n: 3 },
  "Display box — 1 nivel":                    { d: [50, 42, 31.5], tipo: "niveles", n: 1 },
  "POP display — 2 niveles":                  { d: [60, 42, 36.5], tipo: "niveles", n: 2 },
  "POP display chico — 2 niveles":            { d: [72, 42, 29.5], tipo: "niveles", n: 2 },
  "POP display — 3 niveles":                  { d: [90, 41.5, 36.5], tipo: "niveles", n: 3 },
  "Display con repisas":                      { d: [52.5, 63, 31.5], tipo: "niveles", n: 3 },
  "Floor stand — 3 niveles":                  { d: [140, 50, 36.5], tipo: "niveles", n: 3 },
  "Floor stand — 4 niveles":                  { d: [140, 50, 35.5], tipo: "niveles", n: 4 },
  "Floor stand — 5 niveles":                  { d: [160, 51.5, 41.5], tipo: "niveles", n: 5 },
  "Floor stand chico — 3 niveles":            { d: [120, 50, 26.5], tipo: "niveles", n: 3 },
  "Floor stand con ganchos":                  { d: [140, 52, 42.5], tipo: "pegboard", n: 1 },
};
// Geometría de un renglón (catálogo o personalizado). Devuelve null si faltan medidas.
function geomDe(modelo, pers){
  if(modelo === PERSONALIZADO || (pers && pers.alto)){
    return pers ? geomPers(pers.alto, pers.ancho, pers.prof, pers.niveles, pers.tipoPers) : null;
  }
  return GEOM[modelo] || null;
}
// Piezas de UN exhibidor como rectángulos (cm). Los dos laterales triangulares se encajan como un solo rectángulo A×C.
// Es una ESTIMACIÓN para planear hojas: el suaje real lo manda.
function piezasDe(g){
  if(!g) return [];
  const [A, B, C] = g.d, N = g.n || 1, out = [];
  out.push({ n: "respaldo", w: A, h: B });
  out.push({ n: "laterales (par)", w: A, h: C });
  for(let i = 0; i < N; i++) out.push({ n: "base " + (i + 1), w: B, h: C });
  if(g.tipo !== "escalonado") for(let i = 0; i < N; i++) out.push({ n: "letrero " + (i + 1), w: B, h: 5 });
  if(N >= 2) for(let i = 0; i < (N - 1) * 2; i++) out.push({ n: "soporte " + (i + 1), w: B, h: 3 });
  for(let i = 0; i < (g.sep || 0); i++) out.push({ n: "separador " + (i + 1), w: A, h: Math.round(C * SEP_FACTOR * 10) / 10 });
  return out;
}
// Ajusta para que el lado largo quede horizontal (eje de 244 cm).
const orientar = (p) => (p.w >= p.h ? { w: p.w, h: p.h } : { w: p.h, h: p.w });

// ===================== ACOMODO EN HOJA (MaxRects, sin rotar el sentido) =====================
// piezas: [{id, w, h}] ya orientadas. Devuelve hojas con cada pieza colocada.
function acomodar(piezas, opt){
  opt = Object.assign({ gap: 1, margen: 1, W: HOJA.ancho, H: HOJA.alto }, opt || {});
  const W = opt.W - 2 * opt.margen, H = opt.H - 2 * opt.margen, g = opt.gap;
  const lista = piezas.map(p => Object.assign({}, p, orientar(p))).sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const sobran = [], hojas = [];
  const nueva = () => ({ libres: [{ x: 0, y: 0, w: W + g, h: H + g }], puestas: [], usada: 0 });   // +g para que el último no pague el hueco
  const mejor = (hoja, w, h) => {
    let best = null;
    for(const r of hoja.libres){
      const pw = w + g, ph = h + g;
      if(pw <= r.w + 1e-9 && ph <= r.h + 1e-9){
        const sc = Math.min(r.w - pw, r.h - ph), sc2 = Math.max(r.w - pw, r.h - ph);
        if(!best || sc < best.sc || (sc === best.sc && sc2 < best.sc2)) best = { r, sc, sc2 };
      }
    }
    return best;
  };
  const cortar = (hoja, ux, uy, uw, uh) => {
    const nuevos = [];
    for(const r of hoja.libres){
      if(ux >= r.x + r.w || ux + uw <= r.x || uy >= r.y + r.h || uy + uh <= r.y){ nuevos.push(r); continue; }
      if(ux > r.x) nuevos.push({ x: r.x, y: r.y, w: ux - r.x, h: r.h });
      if(ux + uw < r.x + r.w) nuevos.push({ x: ux + uw, y: r.y, w: r.x + r.w - (ux + uw), h: r.h });
      if(uy > r.y) nuevos.push({ x: r.x, y: r.y, w: r.w, h: uy - r.y });
      if(uy + uh < r.y + r.h) nuevos.push({ x: r.x, y: uy + uh, w: r.w, h: r.y + r.h - (uy + uh) });
    }
    hoja.libres = nuevos.filter((a, i) => !nuevos.some((b, j) => i !== j && a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9 && (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || i > j)));
  };
  for(const p of lista){
    if(p.w > W + 1e-9 || p.h > H + 1e-9){ sobran.push(p); continue; }          // no cabe ni sola en una hoja
    let puesto = false;
    for(const hoja of hojas){
      const m = mejor(hoja, p.w, p.h);
      if(m){ const x = m.r.x, y = m.r.y; hoja.puestas.push({ ...p, x: x + opt.margen, y: y + opt.margen }); hoja.usada += p.w * p.h; cortar(hoja, x, y, p.w + g, p.h + g); puesto = true; break; }
    }
    if(!puesto){
      const hoja = nueva(); hojas.push(hoja);
      const m = mejor(hoja, p.w, p.h), x = m.r.x, y = m.r.y;
      hoja.puestas.push({ ...p, x: x + opt.margen, y: y + opt.margen }); hoja.usada += p.w * p.h; cortar(hoja, x, y, p.w + g, p.h + g);
    }
  }
  const areaHoja = opt.W * opt.H;
  const usoPorHoja = hojas.map(h => h.usada / areaHoja);
  const ultima = usoPorHoja.length ? usoPorHoja[usoPorHoja.length - 1] : 0;
  const areaTotal = lista.reduce((s, p) => s + p.w * p.h, 0);
  return { hojas, nHojas: hojas.length, usoPorHoja, areaTotal, sobran,
    hojasEfectivas: hojas.length ? (hojas.length - 1 + Math.min(1, ultima * 1.0)) : 0,    // si la última hoja se comparte con otro pedido
    usoGlobal: hojas.length ? areaTotal / (hojas.length * areaHoja) : 0 };
}
// Todas las piezas de una lista de renglones [{modelo, cantidad, grosor, pers?}] agrupadas por grosor.
function planDeHojas(renglones, opt){
  const porGrosor = {};
  renglones.forEach((r, ri) => {
    const g = geomDe(r.modelo, r.pers || r); if(!g) return;
    const gr = GROSORES_VALIDOS.includes(r.grosor) ? r.grosor : "4 mm", q = Math.max(1, parseInt(r.cantidad, 10) || 1);
    const base = piezasDe(g);
    for(let k = 0; k < q; k++) base.forEach((p, pi) => (porGrosor[gr] = porGrosor[gr] || []).push({ id: `${ri}-${k}-${pi}`, ren: ri, n: p.n, w: p.w, h: p.h }));
  });
  const res = {}; let hojas = 0;
  for(const gr of Object.keys(porGrosor)){
    const a = acomodar(porGrosor[gr], opt);
    res[gr] = a; hojas += a.nHojas;
  }
  return { porGrosor: res, hojas };
}

// ===================== DICTADO / TEXTO LIBRE → PEDIDO =====================
const _sinAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const _UNI = { cero:0, un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10, once:11, doce:12, trece:13, catorce:14, quince:15, dieciseis:16, diecisiete:17, dieciocho:18, diecinueve:19, veinte:20, veintiuno:21, veintidos:22, veintitres:23, veinticuatro:24, veinticinco:25, veintiseis:26, veintisiete:27, veintiocho:28, veintinueve:29 };
const _DEC = { treinta:30, cuarenta:40, cincuenta:50, sesenta:60, setenta:70, ochenta:80, noventa:90 };
function numerosAPalabras(t){   // "treinta y cinco" -> "35", "cien" -> "100"
  let s = _sinAcentos(t).replace(/\bciento\b/g, "cien");
  s = s.replace(/\b(treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa) y (un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, (m, d, u) => String(_DEC[d] + _UNI[u]));
  s = s.replace(/\b(treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b/g, (m) => String(_DEC[m]));
  s = s.replace(/\bcien\b/g, "100");
  s = s.replace(/\b(cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve)\b/g, (m) => String(_UNI[m]));
  return s;
}
const _N = "(?:3|tres)", _N4 = "(?:4|cuatro)", _N5 = "(?:5|cinco)", _N2 = "(?:2|dos)";
// Orden = prioridad (lo más específico primero).
const ALIAS_MODELO = [
  ["Floor stand chico — 3 niveles", "floor ?stand chic[oa](?: de 3 niveles| 3 niveles)?"],
  ["Floor stand con ganchos",        "floor ?stand con ganchos"],
  ["Floor stand — 5 niveles",        `floor ?stand (?:de )?${_N5} niveles`],
  ["Floor stand — 4 niveles",        `floor ?stand (?:de )?${_N4} niveles`],
  ["Floor stand — 3 niveles",        `floor ?stand(?: (?:de )?${_N} niveles)?`],
  ["POP display chico — 2 niveles",  "pop ?display chic[oa](?: de 2 niveles| 2 niveles)?"],
  ["POP display — 3 niveles",        `pop ?display (?:de )?${_N} niveles`],
  ["POP display — 2 niveles",        `pop ?display(?: (?:de )?${_N2} niveles)?`],
  ["Display escalonado — 2 escalones", `(?:display )?escalonado (?:de )?${_N2}(?: escalones)?`],
  ["Display escalonado — 3 escalones", `(?:display )?escalonado(?: (?:de )?${_N}(?: escalones)?)?`],
  ["Display con separadores",        "(?:display )?(?:con )?separadores"],
  ["Display con repisas",            "(?:display )?(?:con )?repisas"],
  ["Pegboard display con ganchos",   "pegboard(?: display)?"],
  ["Display box — 1 nivel",          "(?:display )?box|caja"],
  ["Counter display compacto con organizador", "(?:counter(?: display)? )?compactos?|counter(?: display)?"],
];
function parsearPedidoTexto(texto){
  const t = numerosAPalabras(texto).replace(/[,;]/g, " , ").replace(/\s+/g, " ").trim();
  const res = { cliente: "", items: [], grosor: "", entrega: "", caras: "", factura: "", crudo: t };
  // grosor
  const mg = t.match(/\b(4|5|6)(?:[.,]0)? ?(?:mm|milimetros?)\b/); if(mg) res.grosor = mg[1] + " mm";
  // extras
  if(/\bexpres[s]?\b|\bexpress\b/.test(t)) res.entrega = "expres"; if(/\burgente\b/.test(t)) res.entrega = "urgente";
  if(/frente y vuelta|dos caras|ambas caras/.test(t)) res.caras = "dos";
  if(/con factura|requiere factura|factura si/.test(t)) res.factura = "si";
  // cliente
  const mc = t.match(/\b(?:para|cliente|a nombre de|de parte de)\s+(?:un |una )?([a-z0-9&'.\- ]+?)(?=\s*(?:,|\ben \d|\b\d+ ?(?:mm|milimetros?)|\bcon\b|\bexpres|\burgente|\bfrente|\bfactura|\bde \d|\bpor \d|$))/);
  if(mc){   // se recupera la escritura original (con acentos) palabra por palabra
    const orig = String(texto || "").normalize("NFC").split(/\s+/), limpia = (w) => _sinAcentos(w).replace(/[^a-z0-9&'.\-]/g, "");
    res.cliente = mc[1].trim().split(" ").map((tok) => { const w = orig.find((o) => limpia(o) === tok); return (w ? w.replace(/[,;.]+$/g, "") : tok).replace(/^\w/, (c) => c.toUpperCase()); }).join(" ");
  }
  // modelos (se busca en el texto, antes de "para <cliente>" para no confundir el nombre)
  const zona = mc ? t.replace(mc[0], " ").replace(/\s+/g, " ") : t;
  const mpRx = /personalizad[oa][^0-9]{0,20}(\d+(?:[.,]\d+)?)\s*(?:x|por|\*)\s*(\d+(?:[.,]\d+)?)\s*(?:x|por|\*)\s*(\d+(?:[.,]\d+)?)(?:[^0-9]{0,20}(\d) ?(niveles?|charolas?|escalon(?:es)?|separadores?|divisiones|rejillas?))?/;
  const mp = zona.match(mpRx);
  const zonaMod = mp ? zona.replace(mp[0], " | ") : zona;   // así "4 separadores" de un personalizado no se confunde con el modelo "Display con separadores"
  const union = new RegExp("(" + ALIAS_MODELO.map(([, rx]) => `(?:${rx})`).join("|") + ")", "g");
  let m, ultimoFin = 0; const hallados = [];
  while((m = union.exec(zonaMod))){
    const nombre = (ALIAS_MODELO.find(([, rx]) => new RegExp("^(?:" + rx + ")$").test(m[1])) || [])[0];
    if(!nombre){ continue; }
    const antes = zonaMod.slice(ultimoFin, m.index), despues = zonaMod.slice(m.index + m[1].length, m.index + m[1].length + 18);
    let q = (antes.match(/(\d{1,3})\s*(?:piezas?|pzs?|unidades|exhibidores|displays?)?\s*(?:de\s+)?(?:los |las |el |la )?$/) || [])[1];
    if(!q) q = (despues.match(/^\s*(?:x\s*)?(\d{1,3})\s*(?:piezas?|pzs?|unidades)\b/) || [])[1];
    hallados.push({ modelo: nombre, cantidad: Math.min(Math.max(parseInt(q, 10) || 1, 1), 9999) });
    ultimoFin = m.index + m[1].length;
  }
  // personalizado: "personalizado de 30 por 20 por 10" / "30x20x10"
  if(mp){
    const antes = zona.slice(0, zona.indexOf(mp[0])), q = (antes.match(/(\d{1,3})\s*(?:piezas?|pzs?|unidades)?\s*(?:de\s+)?$/) || [])[1];
    hallados.push({ modelo: PERSONALIZADO, cantidad: parseInt(q, 10) || 1, alto: mp[1].replace(",", "."), ancho: mp[2].replace(",", "."), prof: mp[3].replace(",", "."), niveles: parseInt(mp[4], 10) || 1, tipoPers: /escalon/.test(mp[5] || "") ? "escalonado" : /separador|division|rejilla/.test(mp[5] || "") ? "separadores" : "niveles" });
  }
  res.items = hallados;
  res.faltantes = [!res.cliente && "cliente", !res.items.length && "modelo"].filter(Boolean);
  return res;
}


if(typeof module !== "undefined") module.exports = { SEP_FACTOR, TIPOS_PERS, areaExhibidor, hpExhibidor, geomPers, QUIEBRES, PRECIOS, TABLA_POR_MODELO, MODELOS, PERSONALIZADO, precioCatalogo, escalonIdx, cotizarPersonalizado, up5, grosoresDeModelo, HOJA, CARGA_POR_NIVEL, ESCALAS_WEB, GEOM, geomDe, piezasDe, acomodar, planDeHojas, parsearPedidoTexto, numerosAPalabras };
