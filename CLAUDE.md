# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**Unified Apex Validator (UAV)** is a VS Code extension for Salesforce Apex development. It provides static analysis (PMD + CPD via Salesforce Code Analyzer), test suite execution, AI-powered code review via Einstein GPT, ApexDoc generation, Apex class comparison against a connected org, "Where Is Used" reference scanning, Allman-style formatting, and System.debug removal.

## Build Commands

```bash
# Full clean build (clean + install + compile + bundle + copy-resources)
npm run build

# Compile TypeScript only (outputs to out/)
npm run compile

# Bundle extension entry point via esbuild (outputs to dist/)
npm run bundle

# Copy HTML templates, resources, and whereUsed worker files from out/ to dist/
npm run copy-resources

# Package as .vsix for marketplace
npm run package
```

> **Important:** The build has two distinct stages:
> 1. `tsc` compiles all `src/**/*.ts` → `out/` (preserving file structure)
> 2. `esbuild` bundles only `src/extension.ts` → `dist/extension.js` (single bundle)
> 3. `copy-resources` copies `src/resources/`, `docs/`, `i18n/`, and the compiled `whereUsed*.js` worker files from `out/core/` into `dist/`

The `whereUsedWorkerProcess.ts` is intentionally **not** bundled by esbuild — it runs as a forked child process and must remain a standalone CommonJS file. It is compiled by `tsc` and then copied to `dist/core/` by `copy-resources`.

## Architecture Overview

### Entry Point
`src/extension.ts` — registers all VS Code commands, tree views, and status bar items. The `activate()` function sets up 3 activity bar views (Dependencies, Reports, Logs) and wires up all commands.

### Core Modules (`src/core/`)

| File | Responsibility |
|------|---------------|
| `uavController.ts` | Orchestrates the main validation flow (`runUAV`): resolves package.xml, calls validator → test suite → AI analysis → report generation |
| `validator.ts` | Runs Salesforce Code Analyzer (PMD + CPD) via `sf` CLI using the embedded `code-analyzer.yml` config |
| `testSuite.ts` | Executes Apex test classes via the `sf` CLI and collects results |
| `IAAnalisis.ts` | Authenticates with Salesforce OAuth2 and calls Einstein GPT endpoint for AI code review |
| `reportGenerator.ts` | Assembles combined HTML/PDF reports from validation + test + AI results using Nunjucks templates |
| `reportViewer.ts` | Opens generated reports in a VS Code webview |
| `compareController.ts` | Compares local Apex classes against a connected Salesforce org |
| `apexAstParser.ts` | Parses Apex source using `@apexdevtools/apex-parser` (ANTLR4-based) |
| `apexAllmanFormatter.ts` | Reformats Apex using Allman brace style (uses `src/resources/apex_allman_formatter.js`) |
| `whereUsedCore.ts` | Core data types and logic for cross-file reference scanning |
| `whereUsedAnalyzer.ts` | Scans Apex, Flow XML, and LWC files for class references |
| `whereUsedWorkerProcess.ts` | **Worker process** — forked by `extension.ts` via `child_process.fork()`; runs the heavy scan in isolation with a 10-minute timeout |
| `whereUsedPanel.ts` | Renders the Where Is Used results in a VS Code webview |
| `generateApexDocChunked.ts` | Entry point for AI-powered ApexDoc generation |
| `aiDocChunkRunner.ts` | Breaks large classes into chunks and calls Einstein iteratively |
| `patchApplier.ts` | Applies AI-generated doc patches back to source files |
| `removeSystemDebugs.ts` | Removes `System.debug()` calls from Apex files |
| `utils.ts` | Shared utilities: `Logger`, `parseApexClassesFromPackage`, `getStorageRoot`, `ensureOrgAliasConnected` |

### Providers (`src/providers/`)
- `dependenciesProvider.ts` — TreeDataProvider that checks and displays status of external dependencies (SF CLI, Code Analyzer plugin, Einstein config)

### i18n
`src/i18n.ts` wraps `vscode-nls` with a custom fallback that loads `i18n/extension.i18n.json`. Spanish is the default language; `package.nls.es.json` / `package.nls.json` handle package-level strings. All user-facing strings use `localize(key, defaultValue, ...args)`.

### Resources
`src/resources/` contains:
- `templates/reportTemplate.html` — Nunjucks template for validation reports
- `templates/whereUsed_template.html` — Nunjucks template for Where Is Used reports
- `templates/code-analyzer.yml` — embedded PMD + CPD ruleset config
- `apex_allman_formatter.js` — standalone JS formatter for Allman-style Apex

### Output Paths at Runtime
- Reports: `vscode.globalStorageUri/output/` (configurable via `UnifiedApexValidator.outputDir`)
- Logs: `vscode.globalStorageUri/.uav/logs/`
- Temp files: `vscode.globalStorageUri/temp/` (cleared on each run)

## Key Settings (VS Code config namespace: `UnifiedApexValidator`)

| Setting | Purpose |
|---------|---------|
| `sfClientId` / `sfClientSecret` / `sfDomain` | Salesforce OAuth2 credentials for AI features |
| `sfGptEndpoint` / `sfGptModel` | Einstein GPT endpoint and model |
| `sfRepositoryDir` | Root of the Salesforce project (defaults to workspace root) |
| `sfCliPath` | Path to the `sf` CLI executable (default: `sf`) |
| `iaPromptTemplate` | Nunjucks-style prompt template for AI analysis |
| `skipIAAnalysis` | Skip Einstein analysis even if configured |
| `enableAllmanFormatter` | Gates the Allman format command |
| `reportLanguage` | `auto` / `es` / `en` for report language |

## External Dependencies Required at Runtime
- **Salesforce CLI** (`sf`) with the **Code Analyzer plugin** (`@salesforce/plugin-code-analyzer`) v5+
- A connected Salesforce org (for compare and test execution features)
- Einstein GPT API credentials (for AI features)
