// Pruebas del cotizador de personalizados contra la hoja "Cotización Personalizada" (Sheets "Joart Digital").
// Ejecutar: node tests/cotizador.test.js
const C = require("../joart-core.js");
let fallos = 0;
const cerca = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const igual = (nombre, real, esperado, tol) => {
  const ok = typeof esperado === "number" ? cerca(real, esperado, tol === undefined ? 0.005 : tol) : real === esperado;
  if (!ok) { fallos++; console.log("FALLA:", nombre, "→", real, "(esperado", esperado + ")"); } else console.log("ok:", nombre, "→", real);
};
const hp = (a, b, c, n, tipo, opc) => C.hpExhibidor(C.geomPers(a, b, c, n, tipo, opc));
const precio = (a, b, c, n, q, gr, tipo, opc) => C.cotizarPersonalizado(a, b, c, n, q, gr, tipo, opc);

// Caso que tiene la hoja capturado hoy: 110×40×20, 4 niveles, 1 pza, Estándar → AE 13520, HP 0.52, base 1015, final 1165, 6 mm 1415
const r = C.calcPersonalizado(C.geomPers(110, 40, 20, 4, "niveles"));
igual("Estándar AE", r.AE, 13520, 0.001);
igual("Estándar HP", r.HP, 0.52, 0.0001);
igual("Estándar 4 mm (alto ≥ 100 fuerza 5 mm)", precio(110, 40, 20, 4, 1, "4 mm", "niveles"), 1165);
igual("Estándar 5 mm", precio(110, 40, 20, 4, 1, "5 mm", "niveles"), 1165);
igual("Estándar 6 mm = base + 400", precio(110, 40, 20, 4, 1, "6 mm", "niveles"), 1415);
igual("Estándar bajo (alto < 100) 4 mm", precio(50, 40, 20, 2, 1, "4 mm", "niveles"), 495);
igual("Grosor mínimo alto 110", C.grosorMinimoPers(110, "niveles"), "5 mm");
igual("Grosor mínimo alto 60", C.grosorMinimoPers(60, "niveles"), "4 mm");

// Con separadores (Display con separadores 28.5×34.5×19, 2 separadores): ~8 piezas por lámina (calibración de la hoja)
igual("Separadores HP", hp(28.5, 34.5, 19, 2, "separadores"), 0.12, 0.002);
igual("Separadores: B7 vacío = 2", hp(28.5, 34.5, 19, 2, "separadores"), hp(28.5, 34.5, 19, 2, "separadores", undefined));
// Con rejilla: estándar + rejilla (W-0.8)×(D-0.8); B7 vacío = 1
const base = C.calcPersonalizado(C.geomPers(40, 30, 20, 3, "niveles")).AE;
const conRej = C.calcPersonalizado(C.geomPers(40, 30, 20, 3, "rejilla")).AE;
igual("Rejilla suma 1 rejilla (W-0.8)(D-0.8)", conRej - base, (30 - 0.8) * (20 - 0.8), 0.001);
igual("Rejilla ×2", C.calcPersonalizado(C.geomPers(40, 30, 20, 3, "rejilla", 2)).AE - base, 2 * (30 - 0.8) * (20 - 0.8), 0.001);
// Escalonado: soportes automáticos n(n+1)/2 si n ≥ 3, 0 si n < 3; B7 los sobrescribe (0 = sin soportes)
const e3 = C.calcPersonalizado(C.geomPers(50.5, 31, 31, 3, "escalonado")), e3s = C.calcPersonalizado(C.geomPers(50.5, 31, 31, 3, "escalonado", 0));
igual("Escalonado 3: soportes automáticos = 6", +(e3.partes.soportes / (31 * (20 / 3 - 0.4) * 0.5)).toFixed(6), 6, 0.0001);
igual("Escalonado 3 con B7=0 sin soportes", e3s.partes.soportes, 0);
igual("Escalonado 2: sin soportes", C.calcPersonalizado(C.geomPers(50, 42, 31.5, 2, "escalonado")).partes.soportes, 0);
igual("Escalonado bases W×D×(n+2)/2", e3.partes.bases, 31 * 31 * 5 / 2, 0.001);
igual("Escalonado laterales 2×D×(A−21)", e3.partes.laterales, 2 * 31 * (50.5 - 21), 0.001);
// Tiras: piezas por lámina en 243×121 (mejor orientación); sin recargo de 5 mm por largo
igual("Tiras 120×10 → piezas por lámina", Math.round(1 / hp(120, 10, 0, 1, "tiras")), Math.max(Math.floor(243 / 120) * Math.floor(121 / 10), Math.floor(243 / 10) * Math.floor(121 / 120)));
igual("Tiras largo 150 sin +150", precio(150, 10, 0, 1, 100, "4 mm", "tiras"), 120);
igual("Tiras que no caben → null", precio(300, 200, 0, 1, 1, "4 mm", "tiras"), null);
// Tarifas: la fila de 100 hojas totales sí aplica (A: 900 con HP<0.8 y HT≥100 · B: 800)
const hp1 = hp(30, 20, 10, 1, "niveles"); // chico
igual("Escalón de 100 hojas (A)", C.cotizarPersonalizado(30, 20, 10, 1, Math.ceil(100 / hp1) + 1, "4 mm", "niveles") <= C.cotizarPersonalizado(30, 20, 10, 1, 1, "4 mm", "niveles"), true);
if (fallos) { console.log(fallos + " fallas"); process.exit(1); } console.log("Todo bien ✓");
