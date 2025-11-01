import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nunjucks from 'nunjucks';
import * as child_process from 'child_process';
import { execa } from 'execa';
import { Logger } from './utils';
import { localize } from '../i18n';

const logger = new Logger('ReportGenerator', false);

type ReportLanguage = 'es' | 'en';

const REPORT_TRANSLATIONS: Record<ReportLanguage, Record<string, string>> = {
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
export async function generateReport(outputDir: string, data: any) {
  try {
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const outputSetting = config.get<string>('outputDir')?.trim();

    if (!outputSetting) {
      const message = localize(
        'error.reportGenerator.outputDirMissing',
        'The "UnifiedApexValidator.outputDir" setting is not configured.'
      );
      logger.error(message);
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    const finalOutputDir = path.resolve(outputSetting);
    await fs.ensureDir(finalOutputDir);

    const extension = vscode.extensions.getExtension('ozkrgonzalez.unifiedapexvalidator');
    const extensionPath = extension?.extensionPath || __dirname;
    if (!extensionPath) {
      throw new Error(localize('error.reportGenerator.extensionPathMissing', 'Could not determine the extension path.'));
    }

    let templatePath = path.join(extensionPath, 'dist', 'resources', 'templates', 'reportTemplate.html');
    if (!fs.existsSync(templatePath)) {
      templatePath = path.join(extensionPath, 'src', 'resources', 'templates', 'reportTemplate.html');
    }
    if (!fs.existsSync(templatePath)) {
      throw new Error(
        localize('error.reportGenerator.templateNotFound', 'Could not find report template at {0}.', templatePath)
      );
    }

    const coverageData = (data.testResults?.coverage_data || []).map((entry: any) => ({
      ...entry,
      isLowCoverage: (entry.CoveragePercentageInt ?? 0) < 75
    }));

    const reportLanguageSetting = config.get<string>('reportLanguage') || 'auto';
    const reportLanguage = resolveReportLanguage(reportLanguageSetting);
    const reportLabels = REPORT_TRANSLATIONS[reportLanguage];
    const reportTranslationsJson = JSON.stringify(REPORT_TRANSLATIONS);

    const lowCoverageCount = coverageData.filter((entry: any) => entry.isLowCoverage).length;
    const iaFormatted = formatIAResults(data.iaResults || []);

    const duplicatedClasses = new Set<string>();
    for (const dup of data.pmdResults || []) {
      const names = (dup.clases || '')
        .split(',')
        .map((value: string) => value.trim())
        .filter((value: string) => value.length > 0);
      names.forEach((value: string) => duplicatedClasses.add(value));
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
      } catch (renderError: any) {
        logger.warn(
          localize(
            'log.reportGenerator.pdfTemplateRenderFailed',
            'Unable to render dedicated PDF template: {0}. Falling back to primary HTML.',
            renderError.message
          )
        );
        pdfHtmlPath = htmlFilePath;
      }
    }

    const pdfFilePath = path.join(finalOutputDir, 'reporte_validaciones.pdf');
    const pdfGenerated = await tryGeneratePdfHybrid(pdfHtmlPath, pdfFilePath, logger);

    if (pdfHtmlTempCreated) {
      try {
        await fs.remove(pdfHtmlPath);
      } catch {
        // ignore temp deletion errors
      }
    }

    if (!pdfGenerated) {
      logger.warn(
        localize(
          'log.reportGenerator.pdfNotGenerated',
          'PDF was not generated because no compatible engine was found. HTML output only.'
        )
      );
    }

    return { htmlFilePath, pdfFilePath };
  } catch (error: any) {
    const message = localize('error.reportGenerator.generateFailed', 'Error generating report: {0}', error.message);
    logger.error(message);
    vscode.window.showErrorMessage(message);
    throw error;
  }
}

/**
 * Attempts to generate a PDF using wkhtmltopdf (or falls back to HTML only).
 */
async function tryGeneratePdfHybrid(htmlPath: string, pdfPath: string, logger: Logger): Promise<boolean> {
  try {
    const wkPath = await findWkhtmltopdfPath();
    if (!wkPath) {
      logger.warn(localize('log.reportGenerator.wkhtmltopdfMissing', 'wkhtmltopdf was not found on PATH.'));
      return false;
    }

    logger.info(localize('log.reportGenerator.wkhtmltopdfStart', 'Generating PDF with wkhtmltopdf at {0}...', wkPath));
    await new Promise<void>((resolve, reject) => {
      child_process.execFile(wkPath, [htmlPath, pdfPath], (err) => (err ? reject(err) : resolve()));
    });
    logger.info(localize('log.reportGenerator.wkhtmltopdfSuccess', 'PDF generated successfully with wkhtmltopdf.'));
    return true;
  } catch (error: any) {
    logger.warn(localize('log.reportGenerator.wkhtmltopdfError', 'Error using wkhtmltopdf: {0}', error.message));
    return false;
  }
}

/**
 * Searches for wkhtmltopdf in the current PATH.
 */
async function findWkhtmltopdfPath(): Promise<string | null> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execa(cmd, ['wkhtmltopdf']);
    const candidate = stdout.split(/\r?\n/)[0].trim();
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {
    logger.warn(localize('log.reportGenerator.wkhtmltopdfMissing', 'wkhtmltopdf was not found on PATH.'));
  }
  return null;
}

function formatGeneratedAt(date: Date): string {
  try {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return date.toISOString();
  }
}

function formatIAResults(iaResults: any[]): Record<string, any> {
  const map: Record<string, any> = {};
  for (const result of iaResults) {
    if (result.Clase) {
      map[result.Clase] = {
        resumenHtml: result.resumenHtml || `<p>${result.resumen || localize('info.reportGenerator.noSummary', 'No summary provided.')}</p>`
      };
    }
  }
  return map;
}

function resolveReportLanguage(preference: string): ReportLanguage {
  if (preference === 'es' || preference === 'en') {
    return preference;
  }

  const editorLanguage = vscode.env.language?.toLowerCase() ?? '';
  return editorLanguage.startsWith('es') ? 'es' : 'en';
}

/**
 * Generates the Apex class comparison report (local vs org) using the class_comparison_report template.
 */
export async function generateComparisonReport(
  outputDir: string,
  orgAlias: string,
  comparisonResults: {
    ClassName: string;
    Status: string;
    StatusKey?: 'match' | 'mismatch' | 'onlyLocal' | 'onlyOrg' | 'missingBoth';
    Differences?: string;
    LocalVersion?: string;
    SalesforceVersion?: string;
  }[]
) {
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
      throw new Error(
        localize('error.reportGenerator.comparisonTemplateMissing', 'Could not find class comparison template at {0}', templatePath)
      );
    }

    await fs.ensureDir(outputDir);

    const env = nunjucks.configure(path.dirname(templatePath), { autoescape: false });
    env.addFilter('tojson', (value: any) => {
      try {
        return JSON.stringify(value || '').replace(/</g, '\u003c');
      } catch {
        return '""';
      }
    });

    const statusMatchLabel = localize('compare.status.match', 'Match');
    const statusMismatchLabel = localize('compare.status.mismatch', 'Mismatch');
    const statusOnlyLocalLabel = localize('compare.status.onlyLocal', 'Only in Local');
    const statusOnlyOrgLabel = localize('compare.status.onlyOrg', 'Only in Org');
    const statusMissingBothLabel = localize('compare.status.missingBoth', 'Missing in both');

    const resolveStatusKey = (
      status: string,
      statusKey?: 'match' | 'mismatch' | 'onlyLocal' | 'onlyOrg' | 'missingBoth'
    ): 'match' | 'mismatch' | 'onlyLocal' | 'onlyOrg' | 'missingBoth' | 'unknown' => {
      if (statusKey) return statusKey;
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

    vscode.window.showInformationMessage(
      localize('info.reportGenerator.comparisonGenerated', 'Comparison HTML report generated: {0}', htmlFilePath)
    );
    return htmlFilePath;
  } catch (err: any) {
    const message = localize('error.reportGenerator.comparisonFailed', 'Error generating comparison report: {0}', err.message);
    vscode.window.showErrorMessage(message);
    throw err;
  }
}
