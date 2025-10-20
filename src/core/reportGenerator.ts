import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nunjucks from 'nunjucks';
import * as child_process from 'child_process';
import { execa } from 'execa';
import { Logger } from './utils';

const logger = new Logger('ReportGenerator',false);

/**
 * Genera el reporte HTML y PDF consolidado del UAV.
 * Intenta wkhtmltopdf; si ninguno, deja solo HTML.
 */
export async function generateReport(outputDir: string, data: any)
{
    try
    {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const outputSetting = config.get<string>('outputDir')?.trim();

        // ðŸš« ValidaciÃ³n obligatoria
        if (!outputSetting)
        {
            const msg = 'âŒ No se ha configurado el parÃ¡metro "UnifiedApexValidator.outputDir" en Settings.';
            logger.error(msg);
            vscode.window.showErrorMessage(msg);
            throw new Error(msg);
        }

        // âœ… Crear carpeta de salida
        const finalOutputDir = path.resolve(outputSetting);
        await fs.ensureDir(finalOutputDir);

        // âœ… Validar template
        const currentExt = vscode.extensions.getExtension('ozkrgonzalez.unifiedapexvalidator');
        const extensionPath = currentExt?.extensionPath || __dirname;
        if (!extensionPath)
        {
            throw new Error('No se pudo determinar la ruta de la extensiÃ³n.');
        }

        // Busca el template tanto en dist (paquete) como en src (modo debug)
        let templatePath = path.join(extensionPath, 'dist', 'resources', 'templates', 'reportTemplate.html');
        if (!fs.existsSync(templatePath))
        {
            templatePath = path.join(extensionPath, 'src', 'resources', 'templates', 'reportTemplate.html');
        }
        if (!fs.existsSync(templatePath))
        {
            throw new Error(`No se encontrÃ³ el template empaquetado ni en dist ni en src (${templatePath})`);
        }

        // ðŸ”¹ Marcar cobertura baja
        const coverageData = (data.testResults?.coverage_data || []).map((c: any) => ({
            ...c,
            isLowCoverage: (c.CoveragePercentageInt ?? 0) < 75
        }));

        // ðŸ”¹ Calcular cuÃ¡ntas clases tienen cobertura < 75 %
        const lowCoverageCount = coverageData.filter((c: any) => c.isLowCoverage).length;

        // ðŸ”¹ Transformar resultados IA
        const iaFormatted = formatIAResults(data.iaResults || []);

        // ðŸ”¹ Contar clases Ãºnicas con duplicados detectados
        const duplicatedClasses = new Set<string>();
        for (const dup of data.pmdResults || [])
        {
            const classes = (dup.clases || '')
                .split(',')
                .map((c: string) => c.trim())
                .filter((c: string) => c.length > 0);
            classes.forEach((c: string) => duplicatedClasses.add(c));
        }
        const duplicate_class_count = duplicatedClasses.size;

        const context = {
            apex_results: data.codeAnalyzerResults || [],
            pmd_results: data.pmdResults || [],
            test_results: data.testResults?.test_results || [],
            test_coverage: coverageData,
            low_coverage_count: lowCoverageCount,
            einsteinAnalysis: iaFormatted,
            duplicate_class_count: duplicate_class_count,
            generatedAt: data?.generatedAt ?? formatGeneratedAt(new Date())
        };

        // Render con Nunjucks
        const env = nunjucks.configure(path.dirname(templatePath), { autoescape: true });
        const html = env.render('reportTemplate.html', context);

        // Guardar HTML principal
        const htmlFilePath = path.join(finalOutputDir, 'reporte_validaciones.html');
        await fs.writeFile(htmlFilePath, html, 'utf8');
        logger.info('Reporte HTML generado correctamente.');

        // Generar HTML alternativo para PDF si existe
        let pdfHtmlPath = htmlFilePath;
        let pdfHtmlTempCreated = false;
        const pdfTemplatePath = path.join(path.dirname(templatePath), 'reportTemplate_pdf.html');
        if (fs.existsSync(pdfTemplatePath))
        {
            try
            {
                const pdfHtml = env.render('reportTemplate_pdf.html', context);
                pdfHtmlPath = path.join(finalOutputDir, 'reporte_validaciones_pdf.html');
                await fs.writeFile(pdfHtmlPath, pdfHtml, 'utf8');
                pdfHtmlTempCreated = true;
            }
            catch (renderError: any)
            {
                logger.warn(`No se pudo renderizar el template PDF dedicado: ${renderError.message}. Se usará el HTML principal.`);
                pdfHtmlPath = htmlFilePath;
            }
        }

        // Intentar generar PDF
        const pdfFilePath = path.join(finalOutputDir, 'reporte_validaciones.pdf');
        const pdfOk = await tryGeneratePdfHybrid(pdfHtmlPath, pdfFilePath, logger);

        if (pdfHtmlTempCreated)
        {
            try { await fs.remove(pdfHtmlPath); } catch { /* ignorar */ }
        }

        if (!pdfOk)
        {
            logger.warn('No se generó PDF (no se encontró motor compatible). Se deja solo HTML.');
        }

        return { htmlFilePath, pdfFilePath };

    }
    catch (error: any)
    {
        const msg = `Error generando reporte: ${error.message}`;
        logger.error(msg);
        vscode.window.showErrorMessage(msg);
        throw error;
    }
}

/**
 * Intenta generar PDF usando Puppeteer o wkhtmltopdf.
 */
async function tryGeneratePdfHybrid(htmlPath: string, pdfPath: string, logger: Logger): Promise<boolean>
{
    // Intentar wkhtmltopdf
    try
    {
        const wkPath = await findWkhtmltopdfPath();
        if (!wkPath)
        {
            logger.warn('⚠️ wkhtmltopdf no encontrado en PATH.');
            return false;
        }

        logger.info(`🧩 Generando PDF con wkhtmltopdf (${wkPath})...`);
        await new Promise<void>((resolve, reject) => {
            child_process.execFile(wkPath, [htmlPath, pdfPath], (err) => (err ? reject(err) : resolve()));
        });
        logger.info('🖨️ PDF generado correctamente con wkhtmltopdf.');
        return true;
    }
    catch (e: any)
    {
        logger.warn(`⚠️ Error usando wkhtmltopdf: ${e.message}`);
    }
    return false;
}

/**
 * Busca wkhtmltopdf en el PATH (Windows y Linux/Mac).
 */
async function findWkhtmltopdfPath(): Promise<string | null>
{
    try
    {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execa(cmd, ['wkhtmltopdf']);
        const candidate = stdout.split(/\r?\n/)[0].trim();
        if (candidate && fs.existsSync(candidate))
        {
            return candidate;
        }
    }
    catch
    {
        logger.warn(`âš ï¸ wkhtmltopdf no encontrado`);
    }
    return null;
}

/**
 * Convierte los resultados IA en un objeto agrupado por clase.
 */
function formatGeneratedAt(date: Date): string {
    try {
        return date.toLocaleString('es-ES', {
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
    for (const r of iaResults)
    {
        if (r.Clase)
        {
            map[r.Clase] = {
                resumenHtml: r.resumenHtml || `<p>${r.resumen || 'Sin resumen'}</p>`
            };
        }
    }
    return map;
}

/**
 * Genera el reporte HTML de comparaciÃ³n de clases Apex (LOCAL vs ORG)
 * usando el template class_comparison_report.html con Monaco Editor.
 */
export async function generateComparisonReport(
  outputDir: string,
  orgAlias: string,
  comparisonResults: {
    ClassName: string;
    Status: string;
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

    // ðŸ“‚ busca el template con nombre class_comparison_report.html
    let templatePath = path.join(extensionPath, 'dist', 'resources', 'templates', 'class_comparison_report.html');
    if (!fs.existsSync(templatePath)) {
      templatePath = path.join(extensionPath, 'src', 'resources', 'templates', 'class_comparison_report.html');
    }
    if (!fs.existsSync(templatePath)) {
      throw new Error(`No se encontrÃ³ el template HTML (${templatePath})`);
    }

    await fs.ensureDir(outputDir);

    const env = nunjucks.configure(path.dirname(templatePath), { autoescape: false });

    // ðŸ§© Filtro personalizado para permitir {{ valor | tojson }}
    env.addFilter('tojson', function (value) {
      try {
        return JSON.stringify(value || '').replace(/</g, '\\u003c');
      } catch {
        return '""';
      }
    });

    const match_count = comparisonResults.filter(r => r.Status === 'Match').length;
    const mismatch_count = comparisonResults.filter(r => r.Status === 'Mismatch').length;
    const not_in_local_count = comparisonResults.filter(r => r.Status === 'Solo en Local').length;
    const not_in_salesforce_count = comparisonResults.filter(r => r.Status === 'Solo en Org').length;

    const html = env.render(path.basename(templatePath), {
      results: comparisonResults,
      match_count,
      mismatch_count,
      not_in_local_count,
      not_in_salesforce_count
    });

    const fileName = `compare_${orgAlias}_${new Date().getTime()}.html`;
    const htmlFilePath = path.join(outputDir, fileName);
    await fs.writeFile(htmlFilePath, html, 'utf8');

    vscode.window.showInformationMessage(`ðŸ“Š Reporte HTML de comparaciÃ³n generado: ${htmlFilePath}`);
    return htmlFilePath;
  } catch (err: any) {
    const msg = `âŒ Error generando reporte de comparaciÃ³n: ${err.message}`;
    vscode.window.showErrorMessage(msg);
    throw err;
  }
}


