# Unified Apex Validator – Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and adheres to [Semantic Versioning](https://semver.org/).

---

## [1.8.0] – 2025-02-XX

### Added
- Method-level ApexDoc tag enforcement driven by the new `UnifiedApexValidator.methodDocTags` setting.
- Validation of the configured org alias (`sfOrgAlias`) ensures it is connected via Salesforce CLI and can launch `sf org login web` when missing.
- Automatic detection of missing Einstein GPT configuration before running ApexDoc generation or IA analysis (`evaluateIaConfig` shared logic).
- Dependencies view entry that highlights missing Einstein GPT fields and shows helpful tooltips.
- VS Code context key (`uav.iaReady`) to hide/disable IA commands when credentials are incomplete.
- Extended README documentation covering AI requirements and ApexDoc behaviour.
- Allman-style Apex formatter command (`UnifiedApexValidator.formatApexAllman`) that reuses the workspace installation of `prettier` + `prettier-plugin-apex` and adds menu items for classes/triggers.
- Configurable ApexDoc language via the new `UnifiedApexValidator.apexDocLanguage` setting (Spanish or English prompts for the AI generator).

### Changed
- ApexDoc generation now stops early with a warning when Einstein GPT credentials are incomplete.
- IA analysis in `runUAV` respects missing configuration even if `skipIAAnalysis` is `false`.
- ApexDoc processing synthesises `@param` and `@return` placeholders using the Apex signature whenever the model omits them.

### Removed
- Deprecated Salesforce credential settings (`sfUsername`, `sfPassword`, `sfSecurityToken`) that were no longer used.

---

## [1.7.1] – 2025-01-XX

### Added
- Comparison view to diff local Apex classes against a connected Salesforce org.
- Interactive HTML report with Monaco editor, light/dark theme support, and richer summary cards.
- Redesigned Dependencies tree with per-dependency actions and status icons.

### Changed
- Internal refactors to improve maintainability and compatibility with Salesforce CLI v2.48+.

---

## [1.7.0] – 2024-12-XX

### Added
- Full migration to Salesforce Code Analyzer v5 via `sf code-analyzer run`.
- Optional cleanup of logs/temp files controlled by `keepLogFiles`.

### Changed
- Output channel and log handling redesigned to avoid truncating previous runs.

---

## [1.6.4] – 2024-10-09

### Added
- Validation for any `.xml` location/name with Apex class detection.

### Fixed
- Path handling for macOS when locating rule files.

---

## [1.6.3] – 2024-10-08

### Added
- Webview-based HTML report viewer with automatic theme detection.

### Fixed
- Better cleanup of temporary files and improved relative path support.

---

## [1.2.2] – 2024-09-30

### Fixed
- Compatibility updates for Salesforce Code Analyzer v5.

---

## [1.2.0] – 2024-09-10

### Added
- PMD CPD duplication analysis and HTML/PDF report generation.

---

## [1.0.0] – 2024-09-06

### Added
- Initial public release of Unified Apex Validator for VS Code with validation, testing, AI analysis, and reporting.

---
