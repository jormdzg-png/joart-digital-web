# Joart Digital — herramientas

**Uso diario (guárdalo en favoritos):** `panel.html` — *Joart Core*.
- **Nuevo:** registras el pedido (dictado, chat de WhatsApp pegado o a mano) con modelo o personalizado, medidas, cantidad, detalles e imágenes. No cotiza. Va a Sheets y ClickUp.
- **Proyectos:** buscas al cliente, abres su ficha y generas la cotización con lo registrado (cambias cantidades o detalles). PDF + mensaje de WhatsApp con enlace.
- **Más:** configurador, asistente, video del render, láminas (solo lectura: lo que dice la pestaña «Láminas» del Sheets). Las cuentas bancarias de las cotizaciones están en CONFIG dentro de panel.html.

**Asistente (`asistente.html`):** sin IA. Busca directo en los proyectos del Sheets (`asistente-motor.js`) y usa el motor de precios real para cotizar. Es instantáneo y no depende de ningún servicio externo.

**Video del render (`video-render.html`):** subes el render aprobado, escribes negocio y folio, y genera en el navegador un video vertical de 8 s (MP4 en Chrome/Edge/Safari) para mandarlo por WhatsApp. No usa servidor.

**Para el cliente:** `configurador.html` (exhibidor en 3D con su logo), `mi-pedido.html?codigo=JD-XXXXX` (estatus en vivo) y `aprobar-render.html`. `seguimiento.html` redirige a Mi pedido.

**Código compartido:** `joart-core.js` (precios, modelos, fórmula de personalizados con niveles/escalones/separadores, lectura de pedidos dictados). `vendor/` trae Three.js.

Backend: Google Apps Script (no está en este repo; localiza cada pedido por su código, no por número de fila). Los estatus y pagos se llevan en el Sheet, no en el panel.
