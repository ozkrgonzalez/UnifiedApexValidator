# Unified Apex Validator – Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and adheres to [Semantic Versioning](https://semver.org/).

---

## [1.9.2] – 2025-10-20

### Added
- Validation of the configured org alias (`sfOrgAlias`) ensures it is connected via Salesforce CLI and can launch `sf org login web` when missing.
- Automatic detection of missing Einstein GPT configuration before running ApexDoc generation or IA analysis (`evaluateIaConfig` shared logic).
- VS Code context key (`uav.iaReady`) to hide/disable IA commands when credentials are incomplete.
- Extended README documentation covering AI requirements and ApexDoc behaviour.
- **Allman-style Apex formatter** command (`UnifiedApexValidator.formatApexAllman`) that reuses the workspace installation of `prettier` + `prettier-plugin-apex` and adds contextual menu entries for classes and triggers.
- **New “Where is Used” command and HTML report**, allowing dependency lookup across Apex Classes, Flows, and LWC, displayed in an interactive tree-style view.
- **Revamped report aesthetics** for UAV HTML reports (`reportTemplate.html` and `whereUsed_template.html`) featuring unified dark mode, consistent typography, accent color palette, interactive search bars, and modernized summary cards.
- Configurable ApexDoc language via the new `UnifiedApexValidator.apexDocLanguage` setting (Spanish or English prompts for the AI generator).

### Changed
- Refactored all HTML report templates to adopt a consistent layout and color scheme, matching the new “Where is Used” design.
- Standardized header, typography, and badge elements across all generated reports.
- Improved summary card sizing and readability (larger numbers, unified shadows, balanced spacing).
- Enhanced search bar logic for better live filtering within the HTML reports.
- Minor performance and accessibility improvements across template rendering and file handling.
- ApexDoc generation now stops early with a warning when Einstein GPT credentials are incomplete.
- IA analysis in `runUAV` respects missing configuration even if `skipIAAnalysis` is `false`.
- ApexDoc processing synthesises `@param` and `@return` placeholders using the Apex signature whenever the model omits them.

---

### Removed
- Deprecated Salesforce credential settings (`sfUsername`, `sfPassword`, `sfSecurityToken`) that were no longer used.

---

## [1.7.1] – 2025-10-13

### Added
- Comparison view to diff local Apex classes against a connected Salesforce org.
- Interactive HTML report with Monaco editor, light/dark theme support, and richer summary cards.
- Redesigned Dependencies tree with per-dependency actions and status icons.

### Changed
- Internal refactors to improve maintainability and compatibility with Salesforce CLI v2.48+.

---

## [1.7.0] – 2025-10-12

### Added
- Full migration to Salesforce Code Analyzer v5 via `sf code-analyzer run`.
- Optional cleanup of logs/temp files controlled by `keepLogFiles`.

### Changed
- Output channel and log handling redesigned to avoid truncating previous runs.

---

## [1.6.4] – 2025-10-09

### Added
- Validation for any `.xml` location/name with Apex class detection.

### Fixed
- Path handling for macOS when locating rule files.

---

## [1.6.3] – 2025-10-07

### Added
- Webview-based HTML report viewer with automatic theme detection.

### Fixed
- Better cleanup of temporary files and improved relative path support.

---

## [1.2.2] – 2025-10-06

### Fixed
- Compatibility updates for Salesforce Code Analyzer v5.

---

## [1.2.0] – 2025-10-04

### Added
- PMD CPD duplication analysis and HTML/PDF report generation.

---

## [1.0.0] – 2025-10-03

### Added
- Initial public release of Unified Apex Validator for VS Code with validation, testing, AI analysis, and reporting.

---
