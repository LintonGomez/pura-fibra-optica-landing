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
