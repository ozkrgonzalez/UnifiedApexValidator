# Graph Report - .  (2026-08-01)

## Corpus Check
- Corpus is ~36,923 words - fits in a single context window. You may not need a graph.

## Summary
- 576 nodes · 1027 edges · 52 communities (38 shown, 14 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.79)
- Token cost: 464,344 input · 0 output

## Community Hubs (Navigation)
- Core Validation & Reporting
- Extension Activation & AI Config
- Where-Used Analysis Engine
- AI ApexDoc Generation Pipeline
- Org Metadata Comparison
- Where-Used Report & Formatter UI
- Dev Dependencies & Build Tooling
- Runtime Dependencies
- ApexDoc Tag Schema
- TypeScript Compiler Config
- Build: Copy Resources Script
- Packaged Files & Bundled Modules
- Remove Debug Statements & Manifest
- Extension Manifest Metadata
- Allman Code Formatter
- Report Language Setting
- VS Code Contribution Points
- Marketplace Keywords
- ApexDoc Language Setting
- Extension Activation Events
- NPM Build Scripts
- External Dependency Checks
- Marketplace Categories
- Allman Formatter Toggle Setting
- AI Prompt Template Setting
- Keep Log Files Setting
- Max AI Class Chars Setting
- Output Directory Setting
- SF Client ID Setting
- SF Client Secret Setting
- SF CLI Path Setting
- SF Domain Setting
- SF GPT Endpoint Setting
- SF GPT Model Setting
- SF Repository Dir Setting
- Skip AI Analysis Setting
- Trace AST Setting
- Dependency Tree Item Model
- Settings Configuration Container
- Ambient Module Declarations
- Einstein GPT Setup Guide
- PDF Report Template
- html-pdf-node Type Stub
- Apex Icon V1 (Legacy)
- Changelog: Debug Removal Feature
- Walkthrough: Connect Org
- Walkthrough: Stay Updated
- Walkthrough: Validate Apex
- Walkthrough: Workspace Setup
- Apex Icon (Robot Face)
- Extension Marketplace Icon
- Claude Local Permissions Config

## God Nodes (most connected - your core abstractions)
1. `localize()` - 86 edges
2. `Logger class` - 27 edges
3. `activate()` - 26 edges
4. `runCompareApexClasses()` - 22 edges
5. `runUAV() orchestrator` - 20 edges
6. `TestSuite class` - 18 edges
7. `analyzeWhereUsedCore()` - 17 edges
8. `files` - 16 edges
9. `generateApexDocChunked()` - 16 edges
10. `DependenciesProvider class` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Walkthrough Step 3: Review Reports and Logs` --conceptually_related_to--> `activate()`  [INFERRED]
  docs/walkthrough/reports-logs.md → src/extension.ts
- `Walkthrough Step 1: Check Dependencies` --references--> `DependenciesProvider class`  [INFERRED]
  docs/walkthrough/dependencies.md → src/providers/dependenciesProvider.ts
- `i18n Fallback Bundle Architecture` --rationale_for--> `localize()`  [EXTRACTED]
  CLAUDE.md → src/i18n.ts
- `Allman-Style Apex Formatter Command (CHANGELOG v1.9.2)` --references--> `applyAllmanStyle()`  [EXTRACTED]
  CHANGELOG.md → src/resources/apex_allman_formatter.js
- `Code Analyzer PMD+CPD Ruleset Config` --semantically_similar_to--> `processPath()`  [INFERRED] [semantically similar]
  src/resources/templates/code-analyzer.yml → src/resources/apex_allman_formatter.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **ApexDoc AI Generation Pipeline** — src_core_generateapexdocchunked_generateapexdocchunked, src_core_apexastparser_apexastparser, src_core_aidocchunkrunner_aidocchunkrunner, src_core_iaanalisis_iaanalisis, src_core_patchapplier_patchapplier [EXTRACTED 1.00]
- **UAV Full Validation Run Orchestration** — src_core_uavcontroller_runuav, src_core_validator_runvalidator, src_core_testsuite_testsuite, src_core_iaanalisis_iaanalisis, src_core_reportgenerator_generatereport, src_core_reportviewer_showreport [EXTRACTED 1.00]
- **Extension Localization Infrastructure** — packagejson_manifest, packagenls_locale, packagenlses_locale, extensioni18n_strings [INFERRED 0.85]
- **Getting Started Walkthrough Sequence** — docs_walkthrough_dependencies_md, docs_walkthrough_validate_md, docs_walkthrough_reports_logs_md, docs_walkthrough_einstein_md, docs_walkthrough_workspace_md, docs_walkthrough_connect_org_md, docs_walkthrough_stay_updated_md, src_extension_opengettingstarted [INFERRED 0.85]
- **Unified Dark-Mode Report Theme Design System** — src_resources_templates_reporttemplate_html, src_resources_templates_whereused_template_html, src_resources_templates_class_comparison_report_html [INFERRED 0.85]
- **Einstein GPT Readiness Flow** — src_extension_activate, src_providers_dependenciesprovider_dependenciesprovider, docs_walkthrough_einstein_md, readme_einstein_setup [INFERRED 0.75]

## Communities (52 total, 14 thin omitted)

### Community 0 - "Core Validation & Reporting"
Cohesion: 0.08
Nodes (42): i18n Fallback Bundle Architecture, ComparisonReportEntry, findWkhtmltopdfPath(), formatGeneratedAt(), formatIAResults(), generateComparisonReport() (org diff report), generateReport() (validation report), logger (+34 more)

### Community 1 - "Extension Activation & AI Config"
Cohesion: 0.07
Nodes (25): Two-Stage Build Pipeline (tsc + esbuild), Where-Is-Used Worker Process Isolation, Walkthrough Step 1: Check Dependencies, Walkthrough Step 3: Review Reports and Logs, evaluateIaConfig(), IAConfigStatus, IAConnectionError, IAResponse (+17 more)

### Community 2 - "Where-Used Analysis Engine"
Cohesion: 0.11
Nodes (36): analyzeWhereUsed(), resolveRepositoryDir(), resolveWorkspaceFolder(), wrapLogger(), analyzeWhereUsedCore(), collectClassNames(), collectMatchingFiles(), deriveLwcComponentName() (+28 more)

### Community 3 - "AI ApexDoc Generation Pipeline"
Cohesion: 0.12
Nodes (20): AiDocChunkRunner class, ChunkResult, DocLanguage, ApexAstParser class, ApexChunk interface, sanitizeForParser(), analyzeDocBlock(), docBlockHasTag() (+12 more)

### Community 4 - "Org Metadata Comparison"
Cohesion: 0.11
Nodes (33): diff, diff, BINARY_EXTENSIONS, binaryDifference(), buildRetrieveMetadataMaps(), buildTextDiff(), collectRemoteFiles(), ComparisonResult (+25 more)

### Community 5 - "Where-Used Report & Formatter UI"
Cohesion: 0.09
Nodes (28): Allman-Style Apex Formatter Command (CHANGELOG v1.9.2), Metadata Comparison Against Org (CHANGELOG v2.0.1), Where Is Used Command & Report (CHANGELOG v1.9.2), Bundled Resource Assets (templates, formatter, ruleset), applyThemeClass(), formatTimestampForDisplay(), formatTimestampForFile(), getVSCodeThemeClass() (+20 more)

### Community 6 - "Dev Dependencies & Build Tooling"
Cohesion: 0.07
Nodes (29): esbuild, devDependencies, esbuild, prettier, prettier-plugin-apex, rimraf, @types/fs-extra, @types/glob (+21 more)

### Community 7 - "Runtime Dependencies"
Cohesion: 0.07
Nodes (27): antlr4ts, @apexdevtools/apex-parser, axios, dotenv, execa, fast-xml-parser, fs-extra, markdown-it (+19 more)

### Community 8 - "ApexDoc Tag Schema"
Cohesion: 0.11
Nodes (19): type, UnifiedApexValidator.classDocTags, UnifiedApexValidator.methodDocTags, default, description, items, markdownDescription, type (+11 more)

### Community 9 - "TypeScript Compiler Config"
Cohesion: 0.11
Nodes (17): node, node_modules, src/**/*, .vscode-test, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module (+9 more)

### Community 10 - "Build: Copy Resources Script"
Cohesion: 0.12
Nodes (15): copyRecursive(), distCoreDir, distDir, distDocsDir, distI18nDir, distResourcesDir, docsDir, ensureDir() (+7 more)

### Community 11 - "Packaged Files & Bundled Modules"
Cohesion: 0.12
Nodes (16): files, dist, docs/walkthrough, media, node_modules/axios, node_modules/dotenv, node_modules/fast-xml-parser, node_modules/fs-extra (+8 more)

### Community 12 - "Remove Debug Statements & Manifest"
Cohesion: 0.19
Nodes (14): Extension i18n String Table (English), Extension Manifest (package.json), package.json Localization (English), package.json Localization (Spanish), copyResources Build Script, collectSystemDebugStatements(), createRemovalRange(), dedupeRanges() (+6 more)

### Community 13 - "Extension Manifest Metadata"
Cohesion: 0.14
Nodes (13): description, displayName, engines, vscode, icon, license, main, name (+5 more)

### Community 14 - "Allman Code Formatter"
Cohesion: 0.29
Nodes (11): applyAllmanStyleToCode(), applyAllmanStyleToFile(), collectFilesFromUri(), convertToAllmanStyle(), formatApexAllman() command, formatWithPrettier(), gatherTargets(), loadPrettier() (+3 more)

### Community 15 - "Report Language Setting"
Cohesion: 0.17
Nodes (12): UnifiedApexValidator.reportLanguage, default, description, enum, enumDescriptions, type, Adapts the report language based on VS Code locale (ES when applicable)., auto (+4 more)

### Community 16 - "VS Code Contribution Points"
Cohesion: 0.18
Nodes (11): contributes, commands, menus, views, viewsContainers, walkthroughs, editor/context, explorer/context (+3 more)

### Community 17 - "Marketplace Keywords"
Cohesion: 0.20
Nodes (10): keywords, apex, code analyzer, cpd, einstein gpt, pmd, report, salesforce (+2 more)

### Community 18 - "ApexDoc Language Setting"
Cohesion: 0.20
Nodes (10): UnifiedApexValidator.apexDocLanguage, default, description, enum, enumDescriptions, type, english, Generates ApexDoc descriptions fully in English. (+2 more)

### Community 19 - "Extension Activation Events"
Cohesion: 0.25
Nodes (8): activationEvents, onCommand:UnifiedApexValidator.compareApexClasses, onCommand:UnifiedApexValidator.formatApexAllman, onCommand:UnifiedApexValidator.removeSystemDebugs, onCommand:UnifiedApexValidator.validateApex, onCommand:UnifiedApexValidator.whereIsUsed, onLanguage:apex, workspaceContains:**/*.xml

### Community 20 - "NPM Build Scripts"
Cohesion: 0.25
Nodes (8): scripts, build, bundle, clean, compile, copy-resources, deploy, package

### Community 21 - "External Dependency Checks"
Cohesion: 0.29
Nodes (6): External Runtime Dependencies (CLAUDE.md), UnifiedApexValidator Settings Table (CLAUDE.md), UnifiedApexValidator Settings Table (README), checkCommand(), collectDependencies(), getDependencySummary()

### Community 22 - "Marketplace Categories"
Cohesion: 0.50
Nodes (4): categories, Linters, Other, Testing

### Community 23 - "Allman Formatter Toggle Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.enableAllmanFormatter, default, description, type

### Community 24 - "AI Prompt Template Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.iaPromptTemplate, default, description, type

### Community 25 - "Keep Log Files Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.keepLogFiles, default, description, type

### Community 26 - "Max AI Class Chars Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.maxIAClassChars, default, description, type

### Community 27 - "Output Directory Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.outputDir, default, description, type

### Community 28 - "SF Client ID Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.sfClientId, default, description, type

### Community 29 - "SF Client Secret Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.sfClientSecret, default, description, type

### Community 30 - "SF CLI Path Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.sfCliPath, default, description, type

### Community 31 - "SF Domain Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.sfDomain, default, description, type

### Community 32 - "SF GPT Endpoint Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.sfGptEndpoint, default, description, type

### Community 33 - "SF GPT Model Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.sfGptModel, default, description, type

### Community 34 - "SF Repository Dir Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.sfRepositoryDir, default, description, type

### Community 35 - "Skip AI Analysis Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.skipIAAnalysis, default, description, type

### Community 36 - "Trace AST Setting"
Cohesion: 0.50
Nodes (4): UnifiedApexValidator.traceAst, default, description, type

### Community 38 - "Settings Configuration Container"
Cohesion: 0.67
Nodes (3): properties, title, configuration

## Ambiguous Edges - Review These
- `generateWhereUsedReport()` → `Ambient Module Declarations (glob, xml2js)`  [AMBIGUOUS]
  src/types/global.d.ts · relation: semantically_similar_to

## Knowledge Gaps
- **254 isolated node(s):** `name`, `displayName`, `description`, `publisher`, `version` (+249 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `generateWhereUsedReport()` and `Ambient Module Declarations (glob, xml2js)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `dependencies` connect `Runtime Dependencies` to `Org Metadata Comparison`, `Extension Manifest Metadata`?**
  _High betweenness centrality (0.435) - this node is a cross-community bridge._
- **Why does `runUAV() orchestrator` connect `Core Validation & Reporting` to `Extension Activation & AI Config`, `AI ApexDoc Generation Pipeline`, `Remove Debug Statements & Manifest`, `Runtime Dependencies`?**
  _High betweenness centrality (0.355) - this node is a cross-community bridge._
- **Why does `markdown-it` connect `Runtime Dependencies` to `Core Validation & Reporting`?**
  _High betweenness centrality (0.352) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `activate()` (e.g. with `Walkthrough Step 3: Review Reports and Logs` and `.error()`) actually correct?**
  _`activate()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `displayName`, `description` to the rest of the system?**
  _254 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core Validation & Reporting` be split into smaller, more focused modules?**
  _Cohesion score 0.08482523444160273 - nodes in this community are weakly interconnected._