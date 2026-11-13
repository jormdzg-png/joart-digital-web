// Pruebas de Días de Descuento (buen fin 2026). Ejecutar: node tests/promo.test.js
const C = require("../joart-core.js");
let fallos = 0;
const igual = (n, real, esp) => { const ok = JSON.stringify(real) === JSON.stringify(esp); if(!ok){ fallos++; console.log("FALLA:", n, "→", real, "(esperado", esp + ")"); } else console.log("ok:", n, "→", real); };

// Ejemplo de las Instrucciones: Floor stand 3 niveles × 5 = $6,500 → 15% ≈ $5,525
const base = C.precioCatalogo("Floor stand — 3 niveles", "5 mm", 5) * 5;
igual("base Floor stand 3n × 5", base, 6500);
igual("15%: total", C.aplicarPromo(base, "15").total, 5525);
igual("15%: descuento", C.aplicarPromo(base, "15").descuento, 975);
igual("MSI: el total no cambia", C.aplicarPromo(base, "msi").total, 6500);
igual("MSI: descuento 0", C.aplicarPromo(base, "msi").descuento, 0);
igual("'elegir' ya no existe: se ignora", C.aplicarPromo(base, "elegir").opcion, "");
igual("Sin promo", C.aplicarPromo(base, "").opcion, "");
// Mínimo $1,500 (inclusive)
igual("$1,499 no es elegible", C.aplicarPromo(1499, "15").elegible, false);
igual("$1,499 no descuenta", C.aplicarPromo(1499, "15").total, 1499);
igual("$1,499 falta $1", C.aplicarPromo(1499, "15").falta, 1);
igual("$1,500 sí es elegible", C.aplicarPromo(1500, "15").total, 1275);
// Redondeo al peso
igual("Redondeo al peso (1,505 × 15% = 225.75 → 226)", C.aplicarPromo(1505, "15").descuento, 226);
// Una sola opción: nunca acumulan
igual("MSI no suma descuento", C.aplicarPromo(3000, "msi").descuento, 0);
// Opción inválida
igual("Opción inválida se ignora", C.aplicarPromo(3000, "30").opcion, "");
// Con recargo exprés (+15%) el total que se compara es el de productos con recargo
igual("Base con recargo exprés ≥ mínimo", C.aplicarPromo(1400 + Math.round(1400 * 0.15), "15").elegible, true);
// Fechas (inclusive) y zona horaria de México
igual("12 nov: fuera", C.promoVigente("2026-11-12"), false);
igual("13 nov: dentro", C.promoVigente("2026-11-13"), true);
igual("17 nov: dentro", C.promoVigente("2026-11-17"), true);
igual("18 nov: fuera", C.promoVigente("2026-11-18"), false);
igual("hoyMX a las 23:30 del 17 nov en CDMX (05:30Z del 18) sigue siendo 17", C.hoyMX(new Date("2026-11-18T05:30:00Z")), "2026-11-17");
igual("hoyMX a las 00:30 del 13 nov en CDMX (06:30Z)", C.hoyMX(new Date("2026-11-13T06:30:00Z")), "2026-11-13");
if(fallos){ console.log(fallos + " fallas"); process.exit(1); } console.log("Todo bien ✓");
