# Pura Fibra Óptica — Landing de preventa

Landing estática en español para recibir solicitudes de interés de cobertura de fibra óptica en veredas y caseríos.

## Publicación automática

El workflow `.github/workflows/pages.yml` publica el sitio en GitHub Pages al hacer push a `main`.

Si GitHub Pages no queda habilitado automáticamente, ve a **Settings → Pages** y selecciona **GitHub Actions** como fuente.

## Formulario y n8n

El formulario envía una solicitud POST JSON a:

`https://purafibraoptica.opentelecomai.com/webhook/lead-vereda`

El workflow de n8n debe estar activo y responder con un estado HTTP 2xx solo después de aceptar el registro. Como el formulario usa `Content-Type: application/json`, el navegador hará una comprobación CORS preflight (`OPTIONS`). Configura CORS en el proxy/aplicación para permitir el origen exacto del sitio GitHub Pages.

Antes de promocionar la landing, prueba el formulario de extremo a extremo y confirma que los registros llegan al destino esperado. El HTML y JavaScript del navegador son públicos: no incluyas secretos en el frontend.

## Privacidad

Antes de iniciar una campaña pública, publica y enlaza la política de tratamiento de datos personales y define un canal para consultas o solicitudes de los titulares. El formulario solicita autorización para el uso de datos con el propósito descrito en la propia página.


## Regla de desarrollo tipo LEGO

Este repositorio y las capacidades que se incorporen a Pura Fibra Óptica deben evolucionar mediante piezas pequeñas, útiles y verificables, aprovechando primero la infraestructura y los flujos existentes.

- **Infraestructura limitada:** mantener la solución sencilla y económica. No añadir servicios, bases de datos, frameworks o dependencias sin una necesidad comprobada y una evaluación de su coste operativo.
- **Un resultado por incremento:** cada cambio debe completar un recorrido útil, no crear muchas funcionalidades incompletas.
- **Módulos extensibles:** mantener responsabilidades y contratos claros para que nuevas capacidades puedan añadirse sin rehacer las existentes. No introducir abstracciones o sistemas de plugins para necesidades hipotéticas.
- **Reutilizar antes de duplicar:** auditar el flujo actual de la landing y el webhook de n8n antes de sustituir o replicar la recepción y persistencia de solicitudes.
- **Separación de responsabilidades:** la landing captura el interés; la futura capacidad CRM gestiona contactos y seguimiento comercial; las capacidades técnicas de red podrán integrarse después con OpenTelecomAI/OTA_MicroNode. No crear una base institucional de conocimiento paralela a OpenTelecomAI.
- **Verificación y privacidad:** probar el flujo completo, evitar duplicados cuando sea posible y proteger los datos personales. No incluir secretos en el frontend.

## CRM de OpenTelecomAI: piloto Pura Fibra Óptica

El CRM es una capacidad compartida cuyo código fuente se mantiene en el repositorio [OpenTelecomAI, módulo `modules/crm/`](https://github.com/LintonGomez/OpenTelecomAI/tree/main/modules/crm). Pura Fibra Óptica es el primer piloto operativo, no la propietaria exclusiva del producto.

Este repositorio se limita a la landing y su integración de captación. El formulario continúa enviando solicitudes al webhook existente de n8n; no se ha cambiado el destino ni se han activado los flujos V2. La conexión con el CRM queda pendiente de aprobación de privacidad/consentimiento y aceptación integral del recorrido.

El CRM inicial usa el esquema `pfo` y el modelo de datos de Pura Fibra Óptica. No debe suponerse que Globalwifi u otra organización puede conectarse al mismo servicio: cada integración requiere un contrato de datos y límites de autorización validados. Los módulos de tickets, planes, facturación e inventarios ISP se incorporarán por incrementos en OpenTelecomAI cuando sus flujos estén definidos.

El workflow de GitHub Pages publica únicamente `index.html`, `assets/` y `.nojekyll`; el código de servidor del CRM no forma parte de la landing estática.


## Contexto del proyecto y ruta prevista

El estado de Pura Fibra Óptica, la relación con el CRM compartido de OpenTelecomAI, las dependencias de privacidad y el siguiente recorrido funcional están documentados en [Contexto de producto y ruta de Pura Fibra Óptica](docs/PROJECT_CONTEXT_AND_ROADMAP.md). Este documento complementa las instrucciones operativas existentes; no cambia el webhook ni activa flujos.
