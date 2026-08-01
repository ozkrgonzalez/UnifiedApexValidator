# 🧩 Unified Apex Validator

A VS Code extension written in TypeScript that helps you **validate, test, and document** your Salesforce Apex projects — all in one place. It scans your `package.xml`, runs tests, checks code quality with Salesforce Code Analyzer (PMD + CPD), and exports slick HTML/PDF reports. You can even plug in **Einstein GPT** for AI-powered feedback and auto-generated ApexDocs.

---

## 🚀 Features

- 🧩 Apex class validation using Salesforce Code Analyzer v5 (PMD + CPD).
- 🔍 Duplicate code detection across your repo.
- 🧪 Apex test execution via Salesforce CLI with coverage metrics.
- 🧠 Optional Einstein GPT insights for risk detection and improvements.
- 🧾 Automatic HTML/PDF report generation with an integrated VS Code viewer.
- 🧭 Sidebar views for reports, logs, and dependency checks.
- ⚡ Quick commands: Validate Apex, Refresh views, Open output folders.
- 🤖 AI-powered ApexDoc generation (beta) with tag enforcement.
- 🧱 Allman-style Apex formatter for .cls/.trigger files (leverages workspace prettier + prettier-plugin-apex).
- 🧹 Command palette action to strip System.debug(...) statements across the active selection or file.
- 🔄 Compare local metadata vs. your org (Monaco diff view for text assets, size checks for binaries).
- 🕸️ “Where is Used” report — scans dependencies across Apex Classes, Flows, and LWC, rendered in a clean interactive tree view.
- 🎨 Unified dark-themed report design — for a consistent visual experience, and interactive search across all HTML reports.
- 🌐 Multilingual reports — HTML/PDF templates honor your VS Code locale or a workspace override (Spanish/English) with per-report language switching.
- 🗂️ Orgs View & Active Org Switcher — inspect connected Salesforce orgs, switch active target orgs with one click, assign custom color accents to VS Code, and enjoy instant load times via persistent caching with execution timeouts removed.

---

## 🧰 Requirements

### System

- Node.js 18+ and npm 9+.
- Salesforce CLI (`sf`) with Java 11 or newer.
- wkhtmltopdf (for PDF export, Optional, but Recommended).
- Prettier and Prettier-Plugin-Apex.
- An authenticated Salesforce org through the CLI.
- Einstein GPT credentials (Client Id/Secret) if you plan to use AI features.

---

## ⚙️ Settings

You’ll find them under **Unified Apex Validator** in your VS Code settings.

| Setting | Description |
| -------- | ----------- |
| `aiProvider` | AI provider: `einstein`, `anthropic`, `openai`, or `custom`. Credentials are set via **UAV: Set AI API Key**, never stored here. |
| `aiModel` | Model name for the selected provider (empty = sensible default for Anthropic/OpenAI) |
| `aiCustomEndpoint` | Base URL for the `custom` provider (any OpenAI-compatible endpoint, e.g. Mimo) |
| `sfDomain` | Salesforce domain (My Domain URL) |
| `sfRepositoryDir` | Local repo path with your Apex code |
| `sfCliPath` | Custom Salesforce CLI path (defaults to `sf`) |
| `pmdPath` | Optional PMD binary path |
| `outputDir` | Folder for HTML/PDF reports |
| `skipIAAnalysis` | Skip Einstein GPT analysis |
| `sfGptEndpoint` | Einstein GPT API endpoint |
| `sfGptModel` | GPT model name |
| `iaPromptTemplate` | Custom AI prompt template |
| `maxIAClassChars` | Max characters per class sent to GPT |
| `keepLogFiles` | Keep log files after success |
| `traceAst` | Enable AST tracing (debug) |
| `classDocTags` | Required ApexDoc tags for classes |
| `methodDocTags` | Required ApexDoc tags for methods |
| `apexDocLanguage` | Language used by the AI ApexDoc generator (`spanish` or `english`) |
| `reportLanguage` | Controls report language: `auto` (follow VS Code locale), `es`, or `en` |

UAV usa automáticamente la org marcada como `isDefaultUsername` en `sf org list --json`. Asegúrate de tener una org por defecto conectada (`sf org login web`) antes de ejecutar el validador.


💡 *Dependencies view highlights missing GPT setup fields and disables AI commands until everything’s filled in.*

---

## 🕹️ How to Use

1. Right-click a `package.xml` file.
2. Select **UAV: Validate Apex Code**.
3. Track progress in the **Unified Apex Validator** output channel.
4. Review reports or logs in the sidebar.
5. (Optional) Run **UAV: Compare Metadata against Org** to diff your local vs. org versions.
6. (Optional) Use **UAV: Formatear Apex (Allman)** from the explorer/editor context menu to apply Allman braces to selected `.cls`/`.trigger` files (requires `prettier` + `prettier-plugin-apex` in your workspace).
7. (Optional) Use **UAV: Where is Used** from the editor context menu to run a report that scans dependencies across Apex Classes, Flows, and LWC, showing where each element is referenced.
8. (Optional) Use **UAV: Remove System.debug Statements** from the command palette to clean debug output in the active editor or current selections.

### 🔄 Metadata Comparison

- Available from the explorer and editor context menus for package.xml manifests and supported metadata files (classes, triggers, flows, Lightning bundles, etc.).
- From a manifest, UAV retrieves every type/member declared under <types>; from a single file it infers the metadata type automatically before running the retrieve.
- Text assets render in the Monaco diff view with syntax highlighting, while binaries surface size differences so you can decide whether to download them.

📝 HTML/PDF reports render in the language defined by `UnifiedApexValidator.reportLanguage` (default `auto`). The HTML viewer also exposes a globe selector so teammates can switch between Español and English on demand.

---

## 🧭 VS Code Views

### 📊 Reports
Shows all generated reports (HTML/PDF) with options to refresh, open folder, or view inline in VS Code.

### 📜 Logs
Lists `.log` files stored under `~/.uav/logs`. Quick buttons to refresh or open the folder.

### 🔧 Dependencies
Checks Node.js, CLI, Java, wkhtmltopdf, Code Analyzer, and Einstein GPT configuration. Missing ones show in red and can be fixed from here.

### 🗂️ Orgs
Lists all connected Salesforce orgs detected via Salesforce CLI (`sf org list`).
- **Instant Caching**: Orgs list is cached persistently (`globalState` + in-memory) so the tree view renders instantly on startup without waiting for slow CLI execution.
- **Timeout-Free CLI Execution**: Salesforce CLI org list calls run without hard execution timeouts, making it reliable for large or slow environments.
- **Active Org Indicator**: Highlights the currently active default org in the status bar and dynamically applies custom color accents (`statusBar.background`, `activityBar.background`) to your VS Code workspace.
- **Org Switcher & Colors**: Right-click or select any org to switch active target orgs (`sf config set target-org`) or assign custom hex colors.
- **Production Guardrail**: Visual alerts and modal confirmation prompts before executing actions against production-flagged orgs.
- **Manual Refresh**: Click the refresh button (`uav.orgsView.refresh`) anytime to force-refresh connected orgs directly from Salesforce CLI.

---

## 🤖 AI Setup (BYOK)

Unified Apex Validator supports bringing your own AI provider. Pick one in `aiProvider`:

- **`einstein`** (default) — Salesforce Einstein GPT via a Connected App.
- **`anthropic`** — Anthropic Claude, using your own API key.
- **`openai`** — OpenAI, using your own API key.
- **`custom`** — any OpenAI-compatible endpoint (e.g. Mimo, self-hosted), using your own API key and `aiCustomEndpoint`.

### Einstein GPT

1. Create an **External Connected App** with scopes `api` and `refresh_token`.
   📘 Helpful docs:
   - [Access Models API with REST](https://developer.salesforce.com/docs/einstein/genai/guide/access-models-api-with-rest.html)
   - [Einstein Generative AI Setup](https://developer.salesforce.com/docs/einstein/genai/guide/org-setup.html)
2. Assign a user with **API Enabled** and **API Only User** permissions.
3. Turn on Einstein in Setup → *Einstein Generative AI*.
4. Set `sfGptEndpoint`, `sfGptModel`, and `iaPromptTemplate` in settings.
5. Run **UAV: Set AI API Key** and provide the Connected App Client ID and Secret — stored securely via VS Code Secret Storage, never written to settings.
6. Authenticate your org via CLI:
   ```bash
   sf org login web --alias <alias>
   ```

### Anthropic / OpenAI / Custom

1. Set `aiProvider` to `anthropic`, `openai`, or `custom` (and `aiCustomEndpoint` for `custom`).
2. Run **UAV: Set AI API Key** and paste your API key.
3. Refresh the **Dependencies** view — once configured, AI features will unlock automatically.

---

## 🧾 ApexDoc Generation (Beta)

- Command: **UAV: Generate ApexDoc**.
- Uses Einstein GPT to auto-generate documentation.
- Ensures required tags (`@param`, `@return`, etc.) are filled.
- Disabled when Einstein GPT config is incomplete or `skipIAAnalysis` is true.

---

## 🧯 Troubleshooting

### 🧩 Extension not showing
- Make sure the `.vsix` is installed or from Marketplace.
- Run **Developer: Reload Window**.
- Check the **Unified Apex Validator** output channel.

### ⚠️ `sf` or `pmd` not found
- Run `sf --version` and `java -version`.
- Update PATH or reinstall if needed.

### 🚫 Default org not connected
- Ejecuta `sf org list --json` y verifica que alguna org tenga `isDefaultUsername: true`.
- Si no existe, ejecuta `sf org login web` y marca la org como predeterminada.
- Una vez conectada, vuelve a lanzar el validador.

### 🗂️ Orgs view not updating or slow CLI response
- The Orgs view caches your connected orgs automatically for instant rendering on VS Code startup.
- Salesforce CLI timeouts have been removed to ensure slow responses from large orgs complete successfully without timing out.
- Click the **Refresh** button on the Orgs view title bar (`uav.orgsView.refresh`) anytime you connect a new org or want to force-refresh the list from Salesforce CLI.

### 📄 No reports generated
- The XML must contain `<name>ApexClass</name>`.
- Make sure `outputDir` exists and is writable.

### 🤖 AI analysis skipped
- Check the **Dependencies** view for the AI section status.
- Confirm `aiProvider` is set and credentials were saved via **UAV: Set AI API Key**.
- For Einstein GPT, also check `sfGptEndpoint`, `sfGptModel`, and `iaPromptTemplate`. For `custom`, check `aiCustomEndpoint`.
- Ensure `skipIAAnalysis` is `false`.

### 🪵 Logs missing
- Set `keepLogFiles = true`.
- Logs live under:
  ```
  .../globalStorage/ozkrgonzalez.unifiedapexvalidator/.uav/logs
  ```


### Allman formatter not working
- Install `prettier` and `prettier-plugin-apex` in the workspace that contains your `.cls`/`.trigger` files (`npm install --save-dev prettier prettier-plugin-apex`).
- Refresh the **Dependencies** view to confirm both are detected (status should display in green).
- Run **UAV: Formatear Apex (Allman)** again from the explorer/editor context menu.

---

## 🗺️ Roadmap

- 🎚️ Configurable log levels
- 💬 Dependency tooltips with detected versions
- 🤖 Deeper Einstein GPT insights per class
- 📦 Markdown and CSV export options
- 🏪 Marketplace release with verified Salesforce badge

---

## 👨‍💻 Author

Created by **Oscar Gonzalez**
GitHub: [@ozkrgonzalez](https://github.com/ozkrgonzalez)

---

## 📄 License

**GPL v3 © 2025 – Oscar Gonzalez**
