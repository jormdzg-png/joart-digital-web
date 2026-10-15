# Joart Digital — herramientas

**Uso diario (guárdalo en favoritos):** `panel.html` — cotizar (también comparar cantidades sin registrar), registrar pedido, enviar al cliente (PDF + enlace), pagos, renders y avisos. Acepta dictado por voz ("20 pop display de dos niveles para Boticas Unión en 5 mm").

**Para el cliente:** `configurador.html` (exhibidor en 3D con su logo y colores, cotiza por WhatsApp), `mi-pedido.html?codigo=JD-XXXXX` (estatus en vivo) y `aprobar-render.html`. `seguimiento.html` redirige a Mi pedido (enlaces viejos).

**Producción:** `tandas.html` — acomoda las piezas en hojas de 244 × 122 cm, estima hojas/merma/costo, compara con el método del catálogo y deja capturar las hojas realmente usadas.

**Desde el panel (pestaña Más):** asistente, tandas y configurador.

**Código compartido:** `joart-core.js` es la única fuente de precios, modelos, geometría, acomodo en hojas y lectura de pedidos dictados. Si cambian precios, se editan ahí y panel, configurador y tandas se actualizan juntos. `vendor/` trae Three.js (sin depender de CDN).

Backend: Google Apps Script (no está en este repo).
