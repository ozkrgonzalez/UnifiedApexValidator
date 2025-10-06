# 🧩 Unified Apex Validator — Changelog

## [1.0.0] — 2025-10-06
### 🚀 Versión inicial

Primera versión pública del **Unified Apex Validator**, extensión de VS Code escrita en TypeScript para la validación integral de código Apex.

---

### ✨ Funcionalidades principales

#### 🔍 Validación de dependencias
- Verificación automática de entorno:
  - Node.js  
  - Java  
  - Salesforce CLI (`sf`)  
  - PMD  
  - Salesforce Code Analyzer v5  
  - wkhtmltopdf  
  - Configuración de IA Einstein GPT (Client ID, Secret y Endpoint)
- Visualización de estado (✅/❌) en panel lateral con iconos temáticos.

#### 📊 Reportes
- Vista dedicada en la barra lateral con ícono UAV.
- Muestra todos los archivos `.html` y `.pdf` generados en el directorio de salida configurado.
- Botones de acción:
  - 🔄 **Refrescar reportes**
  - 📂 **Abrir carpeta de reportes**
- Integración con el generador de reportes HTML/PDF para resultados de:
  - Code Analyzer
  - PMD (duplicaciones)
  - Pruebas Apex
  - Análisis IA Einstein GPT

#### 📜 Logs
- Vista dedicada a los registros de ejecución.
- Lectura directa desde `~/.uav/logs` (carpeta interna en `globalStorage`).
- Muestra archivos `.log` individuales con apertura rápida.
- Botones de acción:
  - 🔄 **Refrescar logs**
  - 📂 **Abrir carpeta de logs**

#### 🧠 Ejecución integrada
- Comando contextual sobre `package.xml`:
  ```
  UAV: Validate Apex Code
  ```
  Ejecuta el flujo completo:
  1. Análisis estático (Code Analyzer + PMD)
  2. Ejecución de pruebas Apex
  3. Análisis IA (opcional)
  4. Generación de reportes
  5. Limpieza controlada de archivos temporales

#### ⚙️ Configuración
- Accesible desde `Unified Apex Validator Settings`:
  - Credenciales Salesforce
  - Parámetros IA
  - Rutas personalizadas (`outputDir`, `pmdPath`, `sfCliPath`)
  - Control de logs (`keepLogFiles`)

---

### 🧱 Base técnica
- Implementado completamente en **TypeScript** con APIs nativas de VS Code.
- Estructura modular:
  - `extension.ts` → punto de entrada
  - `uavController.ts` → núcleo de validación y vistas
  - `utils.ts` → funciones auxiliares y logger
- Uso de:
  - `execa` para comandos shell
  - `fs-extra` para operaciones de E/S
  - `nunjucks` + `html-pdf-node` para reportes
  - `MarkdownIt` para contenido IA

---

### 🧭 Proximas mejoras
- 🧹 **Reducir ruido en la ventana *Output***:
  - Parametrizar niveles de log (OFF / ERROR / WARN / INFO).
  - Silenciar mensajes de consola sin afectar los archivos `.log`.
- 💬 Tooltip con número de versión detectada en cada dependencia.
- 📦 Publicación en el marketplace de VS Code.

---

© 2025 — *Desarrollado por Oscar González*
