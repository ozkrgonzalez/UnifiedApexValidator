# 🚀 Unified Apex Validator

A **Visual Studio*** Code extension built in TypeScript that performs a unified validation of Salesforce Apex classes directly from the editor.
It analyzes the classes listed in `package.xml`, runs Salesforce unit tests when test classes are included, validates code quality using **Salesforce Code Analyzer v5**, and executes a **CPD (Copy-Paste Detector)** scan against the local Apex repository.
Finally, it generates comprehensive **HTML** and **PDF** reports summarizing all analysis results.

---

## ✨ Features

- ✅ Apex class validation using Salesforce Code Analyzer v5
- 🧩 Duplicate code detection through CPD (Copy-Paste Detector) against the local Apex repository
- 🧪 Apex test execution via Salesforce CLI, including coverage and metrics
- 🤖 Optional AI analysis (Einstein GPT) to identify risks and optimization opportunities
- 📊 Automatic report generation in HTML and PDF formats
- 🧰 Integrated VS Code sidebar view for reports, logs, and dependency checks
- 🔄 Quick actions: Validate Apex, Refresh Reports, Open Output Folder
- ⚙️ Fully implemented in TypeScript, with no Python dependencies

---

## 📦 Requirements

### System

- **Node .js 18+** y **npm 9+**
- **Salesforce CLI (`sf`)** → [Official Docs](https://developer.salesforce.com/tools/sfdxcli)
- **PMD** Intalled → [Download here](https://pmd.github.io/)
  > Requieres **Java 11+**
- **wkhtmltopdf** → [https://wkhtmltopdf.org/downloads.html](https://wkhtmltopdf.org/downloads.html)
- **🤖 Salesforce Connected App (Einstein GPT)**
   >To obtain **Client ID** y **Client Secret**, you must to create a special **Connected App** in Salesforce.
- An active connection to a **Salesforce Sandbox** or **Production org** in VS Code through Salesforce CLI

---

## ⚙️ Configuration

In Settings → Unified Apex Validator, you can define the following properties:

| Property                                | Description                                                        |
| --------------------------------------- | ------------------------------------------------------------------ |
| `UnifiedApexValidator.sfUsername`       | Salesforce username                                                |
| `UnifiedApexValidator.sfPassword`       | Salesforce password                                                |
| `UnifiedApexValidator.sfSecurityToken`  | Salesforce security token                                          |
| `UnifiedApexValidator.sfClientId`       | Client ID from the Connected App                                   |
| `UnifiedApexValidator.sfClientSecret`   | Client Secret from the Connected App                               |
| `UnifiedApexValidator.sfDomain`         | Salesforce domain (`login.salesforce.com` / `test.salesforce.com`) |
| `UnifiedApexValidator.sfOrgAlias`       | Salesforce org alias                                               |
| `UnifiedApexValidator.sfRepositoryDir`  | Local path to the Apex repository                                  |
| `UnifiedApexValidator.sfCliPath`        | Path to the Salesforce CLI (`sf`) executable                       |
| `UnifiedApexValidator.pmdPath`          | Path to the `pmd` executable (used internally by Code Analyzer)    |
| `UnifiedApexValidator.outputDir`        | Folder where reports will be generated                             |
| `UnifiedApexValidator.skipIAAnalysis`   | Skip Einstein GPT analysis                                         |
| `UnifiedApexValidator.sfGptEndpoint`    | Einstein GPT endpoint                                              |
| `UnifiedApexValidator.sfGptModel`       | Einstein GPT model                                                 |
| `UnifiedApexValidator.iaPromptTemplate` | Base prompt for GPT analysis                                       |
| `UnifiedApexValidator.maxIAClassChars`  | Maximum number of characters per Apex class for AI analysis        |
| `UnifiedApexValidator.keepLogFiles`     | Keep log and temporary files after execution                       |


---

## ▶️ Usage

1. Right-click on the `package.xml` file in your Salesforce project.
2. Select **UAV: Validate Apex Code** from the context menu.
3. Monitor the process output in the **Unified Apex Validator** panel.
4. Open the generated reports from the **Reports sidebar view**.
5. If **keepLogFiles** is set to `true` in the settings, you can also review detailed logs in the **Logs view**.

---
## 📂 VS Code Views

## 🧩 Reports

Displays all generated reports and provides quick actions to:
- 🔄 Refresh
- 📂 Open Folder
- 🧾 View HTML/PDF Report

## 🧾 Logs

Lists all generated log files and provides quick actions to:
- 🔄 Refresh
- 📂 Open Folder
- 🧾 View Log File

---

## 🤖 Einstein GPT Configuration

To enable AI-powered analysis:

1. Create a **Connected App** in Salesforce with the `api` and `refresh_token` permissions.
2. Copy the **Client ID** and **Client Secret** from the app.
3. In VS Code, configure the following settings: `sfClientId`, `sfClientSecret`, `sfGptEndpoint`, and `sfGptModel`.

- 📘 Official documentation:
[Einstein GPT – Access Models API](https://developer.salesforce.com/docs/einstein/genai/guide/access-models-api-with-rest.html)

---

## 🛠️ Support & Troubleshooting
### Common Issues
#### 🔴 The extension does not appear in VS Code
- Make sure it’s installed correctly (.vsix file or Marketplace).
- Run Reload Window from the Command Palette (Ctrl+Shift+P).
- Check View → Output → Unified Apex Validator for any startup errors.

#### ⚙️ “sf” or “pmd” not recognized
- Ensure Salesforce CLI and Code Analyzer v5 are properly installed and accessible from your system’s PATH.
- Verify by running these commands in your terminal:
   ```bash
   sf --version
   java -version
   ```
- If either fails, reinstall or add them to the `PATH` environment variable.

#### 🧾 No reports generated
- Confirm that the selected file is a valid package.xml.
- Make sure your project has at least one Apex class referenced in the package.
- Check the output directory path in settings (UnifiedApexValidator.outputDir).

#### 🪵 Logs not visible
- Verify that keepLogFiles is set to true in settings.
- Logs are stored in:
`<UserData>/Code/User/globalStorage/ozkrgonzalez.unifiedapexvalidator/.uav/logs`

#### 🤖 Einstein GPT analysis skipped
- Make sure you have defined sfClientId, sfClientSecret, and sfGptEndpoint.
- If any are missing, the AI analysis will be automatically disabled.

## 💬 Need Help?

If you encounter issues or have feedback:
- Open an issue in the GitHub repository
- Include the .log file from the .uav/logs folder for faster assistance.

---
## 🧭 Next Improvements
- 🧹 Reduce output noise in the VS Code Output panel (add configurable log levels).
- 💬 Display the detected version of each dependency in the Dependencies View tooltip.
- 🧠 Add deeper integration with Einstein GPT for per-class recommendations.
- 🧾 Export additional report formats (Markdown, CSV).
- 🌐 Multi-language support for the interface (English / Spanish).
- 🧩 Publish to the VS Code Marketplace as a verified Salesforce tool.

---

## 👤 Author

- Developed by Oscar González
- 📧 GitHub – ozkrgonzalez


## 📝 Credits

Desarrollado por **Oscar González**
En colaboración con ChatGPT, Google Gemini
GitHub → [ozkrgonzalez](https://github.com/ozkrgonzalez)

---

## 🧾 License

GPL v3 © 2025 — [Oscar González](https://github.com/ozkrgonzalez)
