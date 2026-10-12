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

## Evolución inmediata prevista

El siguiente producto a validar es un **MVP de CRM**, no un CRM completo: recibir las solicitudes de la landing, conservar los datos necesarios del contacto y su vereda, permitir el seguimiento comercial básico y mantener trazabilidad. Antes de elegir o añadir almacenamiento y servicios, se debe auditar el destino actual del webhook y reutilizarlo si satisface las necesidades. La incorporación del CRM no debe comprometer el funcionamiento ligero de la landing ni obligar a implementar desde el inicio facturación, inventario, aprovisionamiento técnico u otros módulos futuros.
