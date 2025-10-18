# 🧩 Unified Apex Validator

A VS Code extension built in TypeScript that helps you **validate, test, and document** your Salesforce Apex projects — all in one place. It scans your `package.xml`, runs tests, checks code quality with Salesforce Code Analyzer (PMD + CPD), and exports slick HTML/PDF reports. You can even plug in **Einstein GPT** for AI-powered feedback and auto-generated ApexDocs.

---

## 🚀 Features

- 🧠 Apex class validation using **Salesforce Code Analyzer v5 (PMD + CPD)**.
- 🔍 Duplicate code detection across your repo.
- 🧪 Apex test execution via Salesforce CLI with coverage metrics.
- 🤖 Optional **Einstein GPT** insights for risk detection and improvements.
- 📊 Automatic HTML/PDF report generation with an integrated VS Code viewer.
- 🪄 Sidebar views for reports, logs, and dependency checks.
- ⚙️ Quick commands: Validate Apex, Refresh views, Open output folders.
- 🗒️ AI-powered ApexDoc generation (beta) with tag enforcement.
- 🔄 Compare local Apex classes vs. your org (Monaco diff view).

---

## 🧰 Requirements

### System

- Node.js 18+ and npm 9+.
- Salesforce CLI (`sf`) with Java 11 or newer.
- wkhtmltopdf (for PDF export).
- An authenticated Salesforce org through the CLI.
- Einstein GPT credentials (Client Id/Secret) if you plan to use AI features.

---

## ⚙️ Settings

You’ll find them under **Unified Apex Validator** in your VS Code settings.

| Setting | Description |
| -------- | ----------- |
| `sfClientId` | Einstein GPT Connected App client id |
| `sfClientSecret` | Einstein GPT Connected App client secret |
| `sfDomain` | Salesforce domain (My Domain URL) |
| `sfOrgAlias` | Org alias used for CLI commands |
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

💡 *Dependencies view highlights missing GPT setup fields and disables AI commands until everything’s filled in.*

---

## 🕹️ How to Use

1. Right-click a `package.xml` file.
2. Select **UAV: Validate Apex Code**.
3. Track progress in the **Unified Apex Validator** output channel.
4. Review reports or logs in the sidebar.
5. (Optional) Run **UAV: Compare Apex Classes against Org** to diff your local vs. org versions.

---

## 🧭 VS Code Views

### 📊 Reports
Shows all generated reports (HTML/PDF) with options to refresh, open folder, or view inline in VS Code.

### 📜 Logs
Lists `.log` files stored under `~/.uav/logs`. Quick buttons to refresh or open the folder.

### 🔧 Dependencies
Checks Node.js, CLI, Java, wkhtmltopdf, Code Analyzer, and Einstein GPT configuration. Missing ones show in red and can be fixed from here.

---

## 🤖 Einstein GPT Setup

1. Create an **External Connected App** with scopes `api` and `refresh_token`.
   📘 Helpful docs:
   - [Access Models API with REST](https://developer.salesforce.com/docs/einstein/genai/guide/access-models-api-with-rest.html)
   - [Einstein Generative AI Setup](https://developer.salesforce.com/docs/einstein/genai/guide/org-setup.html)
2. Assign a user with **API Enabled** and **API Only User** permissions.
3. Turn on Einstein in Setup → *Einstein Generative AI*.
4. Configure your VS Code settings (`sfClientId`, `sfClientSecret`, `sfGptEndpoint`, `sfGptModel`, `iaPromptTemplate`).
5. Authenticate your org via CLI:
   ```bash
   sf org login web --alias <alias>
   ```
6. Refresh the **Dependencies** view — once all fields are set, AI features will unlock automatically.

---

## 🧾 ApexDoc Generation (Beta)

- Command: **UAV: Generate ApexDoc (chunked)**.
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

### 🚫 Org alias not connected
- Confirm your alias in `sfOrgAlias` exists via `sf org list`.
- If not, run `sf org login web --alias <alias>`.

### 📄 No reports generated
- The XML must contain `<name>ApexClass</name>`.
- Make sure `outputDir` exists and is writable.

### 🤖 AI analysis skipped
- Check `sfClientId`, `sfClientSecret`, `sfGptEndpoint`, `sfGptModel`, and `iaPromptTemplate`.
- Ensure `skipIAAnalysis` is `false`.

### 🪵 Logs missing
- Set `keepLogFiles = true`.
- Logs live under:
  ```
  .../globalStorage/ozkrgonzalez.unifiedapexvalidator/.uav/logs
  ```

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