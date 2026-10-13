# Contexto de producto y ruta de Pura Fibra Óptica

**Estado:** Contexto operativo y ruta prevista  
**Actualizado:** 2026-10-12

## 1. Papel de Pura Fibra Óptica

Pura Fibra Óptica es una iniciativa empresarial en incubación y el primer caso operativo para validar el recorrido de creación y crecimiento de un ISP con capacidades de OpenTelecomAI. No es propietaria exclusiva de las capacidades compartidas que utiliza.

Este repositorio conserva la responsabilidad de la landing estática y su integración de captación. El CRM compartido pertenece al repositorio [OpenTelecomAI, módulo `modules/crm/`](https://github.com/LintonGomez/OpenTelecomAI/tree/main/modules/crm). La automatización de redes sociales es un trabajo relacionado en desarrollo; no debe considerarse parte de la landing ni darse por terminada por estar documentada aquí.

## 2. Estado conocido

- **Landing de captación:** desarrollada. Su propósito es recibir solicitudes de interés de cobertura de fibra óptica en veredas y caseríos.
- **Entrada actual de leads:** el formulario utiliza el webhook existente de n8n `lead-vereda`. No cambiar el destino ni activar flujos V2 preparados hasta completar la aprobación de privacidad/consentimiento y las pruebas de aceptación.
- **Automatización de redes sociales:** en desarrollo. Debe mantenerse como capacidad diferenciada, reutilizando servicios existentes y con sus propias verificaciones, permisos y límites.
- **CRM de OpenTelecomAI:** tiene una implementación inicial orientada al esquema de PFO, pero su aceptación operativa completa y conexión con la captación pública siguen pendientes.
- **Operación de red:** forma parte de la evolución prevista con OpenTelecomAI/OTA_MicroNode; no es una capacidad proporcionada por el sitio estático.

La brecha inmediata no es otra landing: es cerrar de forma segura el recorrido que convierte una solicitud captada en un contacto gestionable y trazable en el CRM.

## 3. Siguiente resultado funcional

El siguiente resultado debe ser un recorrido verificable de extremo a extremo:

`Landing → webhook n8n existente → persistencia aprobada → CRM → consulta y seguimiento comercial`

Antes de considerar aceptado ese recorrido:

1. Validar las operaciones del CRM contra una base PostgreSQL aislada usando el mismo rol de mínimos privilegios previsto para el despliegue.
2. Verificar creación, consulta, actualización, idempotencia, prevención de duplicados e historial/auditoría.
3. Aprobar el aviso de privacidad, consentimiento, destino de persistencia, retención y tratamiento de errores.
4. Probar el recorrido completo con datos controlados, incluyendo fallos y recuperación.
5. Mantener el webhook público actual sin cambios y no activar V2 hasta que la aceptación esté documentada.

No importar automáticamente filas heredadas o de prueba. No publicar credenciales en la landing ni en código del navegador. No afirmar que el CRM está en producción o conectado hasta verificarlo en el entorno real.

## 4. Ruta de crecimiento del negocio

Tras aceptar el recorrido de captación y CRM, las siguientes capacidades se validarán con necesidades reales, no se implementarán todas de una vez:

1. Seguimiento comercial de contactos y calificación de solicitudes.
2. Registro del primer cliente y planificación de instalación.
3. Gestión incremental de planes, equipos, tareas o tickets cuando un flujo real demuestre su necesidad.
4. Integración con capacidades de ingeniería de OpenTelecomAI/OTA_MicroNode para inventario y operación de equipos compatibles.
5. Mejora coordinada de presencia digital y automatización de redes sociales, manteniendo consentimiento, trazabilidad, permisos y recuperación.
6. Evolución hacia una operación ISP más amplia sin duplicar la base institucional de conocimiento ni crear una base CRM paralela.

## 5. Límites entre repositorios

- **Este repositorio:** landing, experiencia de captación y código frontend relacionado.
- **OpenTelecomAI:** CRM compartido, capacidades de ingeniería, conocimiento, agentes, node y contratos de integración.
- **n8n:** orquestación de los flujos que efectivamente se administren allí; no asumir que un flujo está activo por aparecer en documentación.
- **Automatización de redes sociales:** capacidad relacionada en desarrollo. El repositorio o sistema responsable debe documentarse en su propio lugar cuando se confirme; no se inventa aquí una ubicación de código.

La landing captura interés; el CRM gestiona contactos y seguimiento; las capacidades de OpenTelecomAI ayudan a operar el negocio y la red. Estas responsabilidades se complementan, pero no deben mezclarse en un único despliegue estático.

## 6. Regla de desarrollo

Conservar los avances existentes y añadir cambios pequeños, útiles y verificables. Reutilizar primero el formulario, webhook y servicios actuales. No introducir una base de datos, framework o servicio adicional sin necesidad comprobada y evaluación de coste. Cualquier activación que afecte la captación pública requiere verificación previa, consentimiento aprobado y un procedimiento de recuperación.
