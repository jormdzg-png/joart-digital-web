const Motor = require("../asistente-motor.js");
const hoy = new Date(2026, 10, 12, 10);
const P = (o) => Object.assign({ cliente: "", tipo: "Display box", cantidad: "10", grosor: "4 mm", estatus: "Imprimir", precio: 1000, pagado: "50%", fechaLimite: "14 de noviembre", factura: "no", hojas: 2, codigo: "", contacto: "", zona: "", notas: "" }, o);
const datos = {
  proyectos: [
    P({ cliente: "Wingman", codigo: "JD-AAA11", precio: 3000, pagado: "100%", fechaLimite: "10 de noviembre" }),
    P({ cliente: "Aviador", codigo: "JD-AAA12", pagado: "N/A", fechaLimite: "13 de noviembre", tipo: "Floor stand 3 niveles", precio: 2500 }),
    P({ cliente: "Ink Balm Tattoo", codigo: "JD-AAA13", estatus: "Hacer render", precio: 0, pagado: "", fechaLimite: "" , notas: "tatuajes"}),
    P({ cliente: "Café Myrna", estatus: "Enviado", pagado: "50%", precio: 4000, fechaLimite: "5 de noviembre", contacto: "55 1234 5678" }),
    P({ cliente: "Café Myrna", estatus: "Imprimir", tipo: "Display box" }),
    P({ cliente: "Café Myrna", estatus: "Imprimir", tipo: "Display box" }),
    P({ cliente: "Octubre - Semana 3", tipo: "", estatus: "" }),
  ],
  inventario: [{ grosor: "4 mm", laminas: 5, enCola: 8 }],
};
const q = (t) => Motor.responder(t, datos, { hoy }).html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
let fallos = 0;
const espera = (t, re) => { const r = q(t); const ok = re.test(r); if (!ok) { fallos++; console.log("FALLA:", t, "\n  ->", r); } else console.log("ok:", t); };
espera("cómo va Wingman", /Wingman va en/);
espera("cuanto debe aviadro", /Aviador/);
espera("redáctame un mensaje de cobro para Aviador", /Borrador.*Aviador.*queda pendiente \$2,500/);
espera("mensaje de avance de Café Myrna", /Borrador.*Myrna/);
espera("ventas por mes", /Ventas por mes.*noviembre 2026/);
espera("el de los tatuajes", /Ink Balm/);
espera("tattoo", /Ink Balm/);
espera("resumen", /en curso/);
const ins = Motor.insights(datos, hoy).map((i) => i.texto.replace(/<[^>]+>/g, ""));
console.log(ins);
if (!ins.some((t) => /atrasado/.test(t)) || !ins.some((t) => /duplicado/.test(t)) || !ins.some((t) => /láminas/.test(t)) || !ins.some((t) => /sin anticipo/.test(t))) { fallos++; console.log("FALLA insights"); }
console.log(Motor.sugerir("avi", datos), Motor.sugerir("por c", datos));
const al = Motor.responder("el tatuador", datos, { hoy, alias: { tatuador: "ink balm tattoo" } }).html;
if (!/Ink Balm/.test(al)) { fallos++; console.log("FALLA alias"); }
process.exit(fallos ? 1 : 0);
