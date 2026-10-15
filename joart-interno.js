// SOLO PARA PRODUCCIÓN INTERNA (tandas.html). No cargar en páginas que ve el cliente.
const COSTO_HOJA = { "4 mm": 138, "5 mm": 220, "6 mm": 289 };                   // material por hoja completa
const COSTO_IMPRESION_M2 = 100;                                                  // se calcula sobre la hoja completa
function costear(plan){
  let total = 0;
  Object.keys(plan.porGrosor).forEach((gr) => { const p = plan.porGrosor[gr]; p.costoPorHoja = COSTO_HOJA[gr] + (HOJA.area / 10000) * COSTO_IMPRESION_M2; p.costo = p.nHojas * p.costoPorHoja; total += p.costo; });
  plan.costo = total; return plan;
}

// ===================== HOJAS: referencia del catálogo y fórmula =====================
// "Catálogo_Muebles" de tu Sheets: láminas por pieza (referencia práctica, ya con tus acomodos reales).
const LAMINAS_PIEZA = {
  "Counter display compacto con organizador": 0.0833, "Display con separadores": 0.125, "Pegboard display con ganchos": 0.2, "Display box — 1 nivel": 0.2,
  "Display escalonado — 2 escalones": 0.3333, "Display escalonado — 3 escalones": 0.2857, "POP display chico — 2 niveles": 0.4, "POP display — 2 niveles": 0.4,
  "POP display — 3 niveles": 0.6667, "Display con repisas": 0.6667, "Floor stand — 3 niveles": 1, "Floor stand chico — 3 niveles": 1,
  "Floor stand con ganchos": 1, "Floor stand — 4 niveles": 1.3333, "Floor stand — 5 niveles": 2,
};
// Hojas por pieza de un personalizado (misma fórmula del agente: AE / 26,000, con merma de 0.8–0.99 → 1).
function hpFormula(g){
  if(!g) return null; const [A, B, C] = g.d, N = g.n || 1;
  const AE = A * B + 2 * (A * C) + N * (B * C) + N * (B * 5) + (N >= 2 ? (N - 1) * 2 * (B * 3) : 0);
  let HP = AE / 26000; if(HP >= 0.8 && HP < 1) HP = 1; return HP;
}
// Hojas por pieza según el método de siempre (catálogo o fórmula).
function hojasPorPiezaMetodo(modelo, pers){ return modelo === PERSONALIZADO ? hpFormula(geomDe(modelo, pers)) : (LAMINAS_PIEZA[modelo] != null ? LAMINAS_PIEZA[modelo] : hpFormula(GEOM[modelo] ? GEOM[modelo] : null)); }
// 2.5 -> "2 hojas y 1/2" · 0.25 -> "1/4 de hoja" · como lo escribes en la columna "% DE HOJA".
function hojasTexto(x){
  x = Number(x) || 0; const ent = Math.floor(x + 1e-9), f = x - ent;
  const fr = [[1/2, "1/2"], [1/3, "1/3"], [2/3, "2/3"], [1/4, "1/4"], [3/4, "3/4"], [1/8, "1/8"], [1/15, "1/15"], [1/5, "1/5"]];
  let mejor = null; for(const [v, t] of fr) if(Math.abs(f - v) < 0.025 && (!mejor || Math.abs(f - v) < Math.abs(f - mejor[0]))) mejor = [v, t];
  if(f < 0.02) return ent === 1 ? "1 hoja" : ent + " hojas";
  if(f > 0.98) return (ent + 1) === 1 ? "1 hoja" : (ent + 1) + " hojas";
  if(!ent) return mejor ? mejor[1] + " de hoja" : (Math.round(x * 100) / 100) + " de hoja";
  return ent + (ent === 1 ? " hoja" : " hojas") + (mejor ? " y " + mejor[1] : " y " + Math.round(f * 100) / 100);
}
