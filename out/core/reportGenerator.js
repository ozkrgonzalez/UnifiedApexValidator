"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReport = generateReport;
exports.generateComparisonReport = generateComparisonReport;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const nunjucks = __importStar(require("nunjucks"));
const child_process = __importStar(require("child_process"));
const execa_1 = require("execa");
const utils_1 = require("./utils");
const i18n_1 = require("../i18n");
const logger = new utils_1.Logger('ReportGenerator', false);
const REPORT_TRANSLATIONS = {
    es: {
        'page-title': 'Unified Apex Validator Report',
        'header-title': 'Unified Apex Validator Report',
        'header-subtitle': 'Panorama general del estado de calidad y pruebas para tu organización Salesforce.',
        'badge-updated': 'Actualizado {date}',
        'search-placeholder': 'Filtrar resultados...',
        'search-aria': 'Buscar en el reporte',
        'search-no-results': '⚠️ Sin coincidencias para la búsqueda.',
        'language-selector': 'Selector de idioma',
        'card-issues-title': '🚨 Problemas',
        'card-issues-subtitle': 'Reglas que requieren atención',
        'card-tests-title': '🧪 Pruebas ejecutadas',
        'card-tests-subtitle': 'Resultados de clases de prueba',
        'card-coverage-title': '📉 Cobertura < 75%',
        'card-coverage-subtitle': 'Clases por debajo del umbral',
        'card-dup-title': '📑 Código duplicado',
        'card-dup-subtitle': 'Clases con coincidencias detectadas',
        'heading-issues': 'Problemas Detectados',
        'heading-coverage': 'Cobertura de Código',
        'heading-tests': 'Resultados de Pruebas',
        'heading-dup': 'Código duplicado',
        'heading-ai': '🧠 Análisis IA',
        'column-class': 'Clase',
        'column-line': 'Línea',
        'column-rule': 'Regla',
        'column-severity': 'Severidad',
        'column-description': 'Descripción',
        'column-view-rule': 'Ver Regla',
        'link-open': '🔗 Abrir',
        'column-total-lines': 'Líneas Totales',
        'column-covered': 'Cubiertas',
        'column-coverage-percent': 'Cobertura %',
        'column-method': 'Método',
        'column-result': 'Resultado',
        'column-message': 'Mensaje',
        'column-duplicate-lines': 'Líneas duplicadas',
        'column-snippet': 'Fragmento',
        'column-reference': 'Referencia',
        'empty-no-issues': '✅ No se encontraron problemas.',
        'empty-no-coverage': 'ℹ️ No hay datos de cobertura.',
        'empty-no-tests': '⚠️ No se ejecutaron pruebas.',
        'empty-no-duplicates': '✅ No se encontraron duplicados.',
        'empty-no-ai': '🤖 El análisis IA fue omitido o no se encontraron resultados.',
        'pdf-title': 'Reporte de Validaciones Salesforce Apex',
        'pdf-header-title': 'Reporte de Validaciones Salesforce Apex'
    },
    en: {
        'page-title': 'Unified Apex Validator Report',
        'header-title': 'Unified Apex Validator Report',
        'header-subtitle': 'High-level view of quality and testing status for your Salesforce org.',
        'badge-updated': 'Updated {date}',
        'search-placeholder': 'Filter results...',
        'search-aria': 'Search the report',
        'search-no-results': '⚠️ No matches for the search.',
        'language-selector': 'Language selector',
        'card-issues-title': '🚨 Issues',
        'card-issues-subtitle': 'Rules that need attention',
        'card-tests-title': '🧪 Tests executed',
        'card-tests-subtitle': 'Test class outcomes',
        'card-coverage-title': '📉 Coverage < 75%',
        'card-coverage-subtitle': 'Classes below the threshold',
        'card-dup-title': '📑 Duplicate code',
        'card-dup-subtitle': 'Classes with matches detected',
        'heading-issues': 'Detected Issues',
        'heading-coverage': 'Code Coverage',
        'heading-tests': 'Test Results',
        'heading-dup': 'Duplicate Code',
        'heading-ai': '🧠 AI Analysis',
        'column-class': 'Class',
        'column-line': 'Line',
        'column-rule': 'Rule',
        'column-severity': 'Severity',
        'column-description': 'Description',
        'column-view-rule': 'View Rule',
        'link-open': '🔗 Open',
        'column-total-lines': 'Total Lines',
        'column-covered': 'Covered',
        'column-coverage-percent': 'Coverage %',
        'column-method': 'Method',
        'column-result': 'Result',
        'column-message': 'Message',
        'column-duplicate-lines': 'Duplicate Lines',
        'column-snippet': 'Snippet',
        'column-reference': 'Reference',
        'empty-no-issues': '✅ No issues found.',
        'empty-no-coverage': 'ℹ️ No coverage data available.',
        'empty-no-tests': '⚠️ No tests were executed.',
        'empty-no-duplicates': '✅ No duplicates detected.',
        'empty-no-ai': '🤖 AI analysis was skipped or returned no results.',
        'pdf-title': 'Salesforce Apex Validation Report',
        'pdf-header-title': 'Salesforce Apex Validation Report'
    }
};
/**
 * Generates the main HTML report (and attempts PDF) for UAV results.
 */
async function generateReport(outputDir, data) {
    try {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const outputSetting = config.get('outputDir')?.trim();
        if (!outputSetting) {
            const message = (0, i18n_1.localize)('error.reportGenerator.outputDirMissing', 'The "UnifiedApexValidator.outputDir" setting is not configured.');
            logger.error(message);
            vscode.window.showErrorMessage(message);
            throw new Error(message);
        }
        const finalOutputDir = path.resolve(outputSetting);
        await fs.ensureDir(finalOutputDir);
        const extension = vscode.extensions.getExtension('ozkrgonzalez.unifiedapexvalidator');
        const extensionPath = extension?.extensionPath || __dirname;
        if (!extensionPath) {
            throw new Error((0, i18n_1.localize)('error.reportGenerator.extensionPathMissing', 'Could not determine the extension path.'));
        }
        let templatePath = path.join(extensionPath, 'dist', 'resources', 'templates', 'reportTemplate.html');
        if (!fs.existsSync(templatePath)) {
            templatePath = path.join(extensionPath, 'src', 'resources', 'templates', 'reportTemplate.html');
        }
        if (!fs.existsSync(templatePath)) {
            throw new Error((0, i18n_1.localize)('error.reportGenerator.templateNotFound', 'Could not find report template at {0}.', templatePath));
        }
        const coverageData = (data.testResults?.coverage_data || []).map((entry) => ({
            ...entry,
            isLowCoverage: (entry.CoveragePercentageInt ?? 0) < 75
        }));
        const reportLanguageSetting = config.get('reportLanguage') || 'auto';
        const reportLanguage = resolveReportLanguage(reportLanguageSetting);
        const reportLabels = REPORT_TRANSLATIONS[reportLanguage];
        const reportTranslationsJson = JSON.stringify(REPORT_TRANSLATIONS);
        const lowCoverageCount = coverageData.filter((entry) => entry.isLowCoverage).length;
        const iaFormatted = formatIAResults(data.iaResults || []);
        const duplicatedClasses = new Set();
        for (const dup of data.pmdResults || []) {
            const names = (dup.clases || '')
                .split(',')
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
            names.forEach((value) => duplicatedClasses.add(value));
        }
        const duplicateClassCount = duplicatedClasses.size;
        const context = {
            apex_results: data.codeAnalyzerResults || [],
            pmd_results: data.pmdResults || [],
            test_results: data.testResults?.test_results || [],
            test_coverage: coverageData,
            low_coverage_count: lowCoverageCount,
            einsteinAnalysis: iaFormatted,
            duplicate_class_count: duplicateClassCount,
            generatedAt: data?.generatedAt ?? formatGeneratedAt(new Date())
        };
        const templateContext = {
            ...context,
            reportLanguage,
            reportLanguagePreference: reportLanguageSetting,
            reportLabels,
            reportTranslationsJson
        };
        const env = nunjucks.configure(path.dirname(templatePath), { autoescape: true });
        const html = env.render('reportTemplate.html', templateContext);
        const htmlFilePath = path.join(finalOutputDir, 'reporte_validaciones.html');
        await fs.writeFile(htmlFilePath, html, 'utf8');
        let pdfHtmlPath = htmlFilePath;
        let pdfHtmlTempCreated = false;
        const pdfTemplatePath = path.join(path.dirname(templatePath), 'reportTemplate_pdf.html');
        if (fs.existsSync(pdfTemplatePath)) {
            try {
                const pdfHtml = env.render('reportTemplate_pdf.html', templateContext);
                pdfHtmlPath = path.join(finalOutputDir, 'reporte_validaciones_pdf.html');
                await fs.writeFile(pdfHtmlPath, pdfHtml, 'utf8');
                pdfHtmlTempCreated = true;
            }
            catch (renderError) {
                logger.warn((0, i18n_1.localize)('log.reportGenerator.pdfTemplateRenderFailed', 'Unable to render dedicated PDF template: {0}. Falling back to primary HTML.', renderError.message));
                pdfHtmlPath = htmlFilePath;
            }
        }
        const pdfFilePath = path.join(finalOutputDir, 'reporte_validaciones.pdf');
        const pdfGenerated = await tryGeneratePdfHybrid(pdfHtmlPath, pdfFilePath, logger);
        if (pdfHtmlTempCreated) {
            try {
                await fs.remove(pdfHtmlPath);
            }
            catch {
                // ignore temp deletion errors
            }
        }
        if (!pdfGenerated) {
            logger.warn((0, i18n_1.localize)('log.reportGenerator.pdfNotGenerated', 'PDF was not generated because no compatible engine was found. HTML output only.'));
        }
        return { htmlFilePath, pdfFilePath };
    }
    catch (error) {
        const message = (0, i18n_1.localize)('error.reportGenerator.generateFailed', 'Error generating report: {0}', error.message);
        logger.error(message);
        vscode.window.showErrorMessage(message);
        throw error;
    }
}
/**
 * Attempts to generate a PDF using wkhtmltopdf (or falls back to HTML only).
 */
async function tryGeneratePdfHybrid(htmlPath, pdfPath, logger) {
    try {
        const wkPath = await findWkhtmltopdfPath();
        if (!wkPath) {
            logger.warn((0, i18n_1.localize)('log.reportGenerator.wkhtmltopdfMissing', 'wkhtmltopdf was not found on PATH.'));
            return false;
        }
        logger.info((0, i18n_1.localize)('log.reportGenerator.wkhtmltopdfStart', 'Generating PDF with wkhtmltopdf at {0}...', wkPath));
        await new Promise((resolve, reject) => {
            child_process.execFile(wkPath, [htmlPath, pdfPath], (err) => (err ? reject(err) : resolve()));
        });
        logger.info((0, i18n_1.localize)('log.reportGenerator.wkhtmltopdfSuccess', 'PDF generated successfully with wkhtmltopdf.'));
        return true;
    }
    catch (error) {
        logger.warn((0, i18n_1.localize)('log.reportGenerator.wkhtmltopdfError', 'Error using wkhtmltopdf: {0}', error.message));
        return false;
    }
}
/**
 * Searches for wkhtmltopdf in the current PATH.
 */
async function findWkhtmltopdfPath() {
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await (0, execa_1.execa)(cmd, ['wkhtmltopdf']);
        const candidate = stdout.split(/\r?\n/)[0].trim();
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    catch {
        logger.warn((0, i18n_1.localize)('log.reportGenerator.wkhtmltopdfMissing', 'wkhtmltopdf was not found on PATH.'));
    }
    return null;
}
function formatGeneratedAt(date) {
    try {
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    catch {
        return date.toISOString();
    }
}
function formatIAResults(iaResults) {
    const map = {};
    for (const result of iaResults) {
        if (result.Clase) {
            map[result.Clase] = {
                resumenHtml: result.resumenHtml || `<p>${result.resumen || (0, i18n_1.localize)('info.reportGenerator.noSummary', 'No summary provided.')}</p>`
            };
        }
    }
    return map;
}
function resolveReportLanguage(preference) {
    if (preference === 'es' || preference === 'en') {
        return preference;
    }
    const editorLanguage = vscode.env.language?.toLowerCase() ?? '';
    return editorLanguage.startsWith('es') ? 'es' : 'en';
}
/**
 * Generates the Apex class comparison report (local vs org) using the class_comparison_report template.
 */
async function generateComparisonReport(outputDir, orgAlias, comparisonResults) {
    try {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const extension = vscode.extensions.getExtension('ozkrgonzalez.unifiedapexvalidator');
        const extensionPath = extension?.extensionPath || __dirname;
        let templatePath = path.join(extensionPath, 'dist', 'resources', 'templates', 'class_comparison_report.html');
        if (!fs.existsSync(templatePath)) {
            templatePath = path.join(extensionPath, 'src', 'resources', 'templates', 'class_comparison_report.html');
        }
        if (!fs.existsSync(templatePath)) {
            throw new Error((0, i18n_1.localize)('error.reportGenerator.comparisonTemplateMissing', 'Could not find class comparison template at {0}', templatePath));
        }
        await fs.ensureDir(outputDir);
        const env = nunjucks.configure(path.dirname(templatePath), { autoescape: false });
        env.addFilter('tojson', (value) => {
            try {
                return JSON.stringify(value || '').replace(/</g, '\u003c');
            }
            catch {
                return '""';
            }
        });
        const statusMatchLabel = (0, i18n_1.localize)('compare.status.match', 'Match');
        const statusMismatchLabel = (0, i18n_1.localize)('compare.status.mismatch', 'Mismatch');
        const statusOnlyLocalLabel = (0, i18n_1.localize)('compare.status.onlyLocal', 'Only in Local');
        const statusOnlyOrgLabel = (0, i18n_1.localize)('compare.status.onlyOrg', 'Only in Org');
        const statusMissingBothLabel = (0, i18n_1.localize)('compare.status.missingBoth', 'Missing in both');
        const resolveStatusKey = (status, statusKey) => {
            if (statusKey)
                return statusKey;
            switch (status) {
                case statusMatchLabel:
                case 'Match':
                    return 'match';
                case statusMismatchLabel:
                case 'Mismatch':
                    return 'mismatch';
                case statusOnlyLocalLabel:
                case 'Solo en Local':
                    return 'onlyLocal';
                case statusOnlyOrgLabel:
                case 'Solo en Org':
                    return 'onlyOrg';
                case statusMissingBothLabel:
                case 'No existe en ninguno':
                    return 'missingBoth';
                default:
                    return 'unknown';
            }
        };
        const matchCount = comparisonResults.filter((r) => resolveStatusKey(r.Status, r.StatusKey) === 'match').length;
        const mismatchCount = comparisonResults.filter((r) => resolveStatusKey(r.Status, r.StatusKey) === 'mismatch').length;
        const notInLocalCount = comparisonResults.filter((r) => resolveStatusKey(r.Status, r.StatusKey) === 'onlyLocal').length;
        const notInSalesforceCount = comparisonResults.filter((r) => resolveStatusKey(r.Status, r.StatusKey) === 'onlyOrg').length;
        const html = env.render(path.basename(templatePath), {
            results: comparisonResults,
            match_count: matchCount,
            mismatch_count: mismatchCount,
            not_in_local_count: notInLocalCount,
            not_in_salesforce_count: notInSalesforceCount
        });
        const fileName = `compare_${orgAlias}_${Date.now()}.html`;
        const htmlFilePath = path.join(outputDir, fileName);
        await fs.writeFile(htmlFilePath, html, 'utf8');
        vscode.window.showInformationMessage((0, i18n_1.localize)('info.reportGenerator.comparisonGenerated', 'Comparison HTML report generated: {0}', htmlFilePath));
        return htmlFilePath;
    }
    catch (err) {
        const message = (0, i18n_1.localize)('error.reportGenerator.comparisonFailed', 'Error generating comparison report: {0}', err.message);
        vscode.window.showErrorMessage(message);
        throw err;
    }
}
