# 🚀 Unified Apex Validator (TypeScript Edition)

Extensión de **Visual Studio Code** desarrollada en **TypeScript**, que realiza una validación integral del código **Apex** directamente desde el editor.  
Permite analizar clases listadas en `package.xml`, ejecutar pruebas en Salesforce, detectar duplicación de código con **PMD**, aplicar validaciones con **Salesforce Code Analyzer**, e integrar análisis de buenas prácticas mediante **IA (Einstein GPT)**.  
Los resultados se presentan en reportes **HTML** y **PDF** generados de forma nativa.

---

## ✨ Características

- ✅ Validación de clases Apex con **PMD** y **Salesforce Code Analyzer**  
- 🧪 Ejecución de **pruebas Apex** vía Salesforce CLI, con cobertura y métricas  
- 🤖 Análisis IA opcional (Einstein GPT) para detectar riesgos y sugerencias de optimización  
- 📊 Reportes automáticos en **HTML**, **PDF** y **JSON**  
- 🧩 Vista lateral integrada en VS Code con reportes y logs  
- 🔄 Botones rápidos: **Validar Apex**, **Refrescar reportes**, **Abrir carpeta de salida**  
- 🧰 100 % implementado en **TypeScript**, sin dependencias de Python

---

## 📦 Requisitos

### Sistema

- **Node .js 18+** y **npm 9+**
- **Salesforce CLI (`sf`)** → [Guía oficial](https://developer.salesforce.com/tools/sfdxcli)
- **PMD** instalado → [Descargar aquí](https://pmd.github.io/)
  > Requiere **Java 11+**
- **wkhtmltopdf** → [https://wkhtmltopdf.org/downloads.html](https://wkhtmltopdf.org/downloads.html)
- Conexión activa a **Salesforce Sandbox** o **Producción**

---

## ⚙️ Configuración

En **Settings → Unified Apex Validator** puedes definir:

| Propiedad | Descripción |
|------------|--------------|
| `UnifiedApexValidator.sfUsername` | Usuario de Salesforce |
| `UnifiedApexValidator.sfPassword` | Contraseña |
| `UnifiedApexValidator.sfSecurityToken` | Token de seguridad |
| `UnifiedApexValidator.sfClientId` | Client ID de la Connected App |
| `UnifiedApexValidator.sfClientSecret` | Client Secret |
| `UnifiedApexValidator.sfDomain` | Dominio (`login.salesforce.com` / `test.salesforce.com`) |
| `UnifiedApexValidator.sfOrgAlias` | Alias del entorno |
| `UnifiedApexValidator.sfRepositoryDir` | Ruta local al repositorio Apex |
| `UnifiedApexValidator.sfCliPath` | Ruta al ejecutable `sf` |
| `UnifiedApexValidator.pmdPath` | Ruta al ejecutable `pmd` |
| `UnifiedApexValidator.outputDir` | Carpeta de reportes |
| `UnifiedApexValidator.skipIAAnalysis` | Omitir análisis IA |
| `UnifiedApexValidator.sfGptEndpoint` | Endpoint Einstein GPT |
| `UnifiedApexValidator.sfGptModel` | Modelo IA |
| `UnifiedApexValidator.iaPromptTemplate` | Prompt base de análisis |
| `UnifiedApexValidator.maxIAClassChars` | Límite de caracteres por clase |
| `UnifiedApexValidator.keepLogFiles` | Mantener logs y archivos temporales |

---

## ▶️ Uso

1. Haz clic derecho sobre `package.xml` en tu proyecto.  
2. Selecciona **UAV: Validate Apex Code**.  
3. Revisa la salida en el panel **Unified Apex Validator**.  
4. Abre los reportes generados en la vista lateral **Reportes**.

---

## 📂 Vistas en VS Code

### 🧩 Reportes
Lista los reportes generados y muestra botones para:
- 🔄 **Refrescar**
- 📂 **Abrir Carpeta**
- 🧾 **Ver HTML/PDF**

---

## 🛠️ Desarrollo

### Instalación local

1. Clona el repositorio  
   ```bash
   git clone https://github.com/ozkrgonzalez/UnifiedApexValidator.git
   cd UnifiedApexValidator
   ```
2. Instala dependencias  
   ```bash
   npm install
   ```
3. Compila y empaqueta  
   ```bash
   npm run build
   vsce package
   ```
4. Instala la extensión resultante  
   ```bash
   code --install-extension unifiedapexvalidator-1.0.0.vsix
   ```
5. Ejecuta en modo desarrollo (F5 desde VS Code)

---

## 🧮 Scripts disponibles

| Comando | Descripción |
|----------|-------------|
| `npm run compile` | Compila TypeScript |
| `npm run bundle` | Genera bundle optimizado con esbuild |
| `npm run build` | Limpia, compila y copia recursos |
| `npm run package` | Genera el archivo .vsix listo para instalar |

---

## 📁 Estructura del proyecto

```plaintext
src/
 ├── core/
 │   ├── reportGenerator.ts
 │   ├── uavController.ts
 │   ├── validator.ts
 │   ├── testSuite.ts
 │   ├── IAAnalisis.ts
 │   └── logger.ts
 ├── extension.ts
 ├── resources/templates/
 └── media/
      ├── apex-icon.svg
      └── icon.png
dist/
 └── extension.js
```

---

## 🧪 Prueba rápida

1. Abre un proyecto Salesforce con `package.xml`.  
2. Clic derecho → **UAV: Validate Apex Code**.  
3. Sigue el progreso desde el **Output Panel** y revisa `/output/report.html`.

---

## 🤖 Configuración Einstein GPT

Para habilitar el análisis IA:

1. Crea una **Connected App** en Salesforce con permisos `api` y `refresh_token`.  
2. Copia el **Client ID** y **Client Secret**.  
3. Configura en VS Code los campos `sfClientId`, `sfClientSecret`, `sfGptEndpoint` y `sfGptModel`.  

📘 Documentación oficial:  
[Einstein GPT – Access Models API](https://developer.salesforce.com/docs/einstein/genai/guide/access-models-api-with-rest.html)

---

## 🧩 Requisitos de compilación

El compilador TypeScript usa las siguientes opciones (ver `tsconfig.json`):

```json
{
  "target": "ES2022",
  "module": "commonjs",
  "rootDir": "src",
  "outDir": "dist",
  "strict": true,
  "types": ["node"]
}
```

---

## ✅ Verificación final

- `sf --version` → Salesforce CLI funcionando  
- `pmd --version` → PMD en PATH  
- `java -version` → Java 11+  
- `wkhtmltopdf --version` → Generador PDF instalado  

---

## 🆘 Soporte

Errores frecuentes:
- `PMD not found` → revisar variable PATH  
- `sf: command not found` → reinstalar CLI  
- `wkhtmltopdf missing` → descargar desde sitio oficial  
- `CANNOT_EXECUTE_FLOW_TRIGGER` → usuario inactivo en Salesforce  

Revisa el panel **Unified Apex Validator** o el archivo de logs dentro de  
`<directorio>/logs/<fecha>.log`.

---

## 📝 Créditos

Desarrollado por **Oscar González**  
En colaboración con ChatGPT, Google Gemini y Banco Estado de Chile  
GitHub → [ozkrgonzalez](https://github.com/ozkrgonzalez)

---

## 🧾 Licencia

GPL v3 © 2025 — [Oscar González](https://github.com/ozkrgonzalez)
