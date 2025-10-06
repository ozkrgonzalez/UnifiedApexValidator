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
 * Intenta Puppeteer, luego wkhtmltopdf; si ninguno, deja solo HTML.
 */
export async function generateReport(outputDir: string, data: any) {
    try {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const outputSetting = config.get<string>('outputDir')?.trim();

        // 🚫 Validación obligatoria
        if (!outputSetting) {
            const msg = '❌ No se ha configurado el parámetro "UnifiedApexValidator.outputDir" en Settings.';
            logger.error(msg);
            vscode.window.showErrorMessage(msg);
            throw new Error(msg);
        }

        // ✅ Crear carpeta de salida
        const finalOutputDir = path.resolve(outputSetting);
        await fs.ensureDir(finalOutputDir);

        // ✅ Validar template
        const currentExt = vscode.extensions.getExtension('ozkrgonzalez.unifiedapexvalidator');
        const extensionPath = currentExt?.extensionPath || __dirname;
        if (!extensionPath) {
            throw new Error('No se pudo determinar la ruta de la extensión.');
        }

        // Busca el template tanto en dist (paquete) como en src (modo debug)
        let templatePath = path.join(extensionPath, 'dist', 'resources', 'templates', 'reportTemplate.html');
        if (!fs.existsSync(templatePath)) {
            templatePath = path.join(extensionPath, 'src', 'resources', 'templates', 'reportTemplate.html');
        }
        if (!fs.existsSync(templatePath)) {
            throw new Error(`No se encontró el template empaquetado ni en dist ni en src (${templatePath})`);
        }

        // 🔹 Marcar cobertura baja
        const coverageData = (data.testResults?.coverage_data || []).map((c: any) => ({
            ...c,
            isLowCoverage: (c.CoveragePercentageInt ?? 0) < 75
        }));

        // 🔹 Calcular cuántas clases tienen cobertura < 75 %
        const lowCoverageCount = coverageData.filter((c: any) => c.isLowCoverage).length;

        // 🔹 Transformar resultados IA
        const iaFormatted = formatIAResults(data.iaResults || []);

        // 🔹 Contar clases únicas con duplicados detectados
        const duplicatedClasses = new Set<string>();
        for (const dup of data.pmdResults || []) {
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
            duplicate_class_count: duplicate_class_count
        };

        // --- Diagnóstico previo al render ---
        logger.info(`📊 Tamaño de datos previo al render:`);
        logger.info(`   • codeAnalyzerResults: ${JSON.stringify(data.codeAnalyzerResults)?.length || 0} bytes`);
        logger.info(`   • pmdResults: ${JSON.stringify(data.pmdResults)?.length || 0} bytes`);
        logger.info(`   • testResults: ${JSON.stringify(data.testResults)?.length || 0} bytes`);
        logger.info(`   • coverage: ${JSON.stringify(data.testResults?.coverage_data)?.length || 0} bytes`);
        logger.info(`   • iaResults: ${JSON.stringify(data.iaResults)?.length || 0} bytes`);

        //logger.info('📊 Previsualización de datos renderizados:');
        //logger.info(JSON.stringify(context, null, 2).slice(0, 2000)); // solo los primeros 2 KB

        // 🧩 Render con Nunjucks
        const env = nunjucks.configure(path.dirname(templatePath), { autoescape: true });
        const html = env.render('reportTemplate.html', context);

        // 📝 Guardar HTML
        const htmlFilePath = path.join(finalOutputDir, 'reporte_validaciones.html');
        await fs.writeFile(htmlFilePath, html, 'utf8');
        logger.info('📄 HTML del reporte generado correctamente.');

        // 📄 Intentar generar PDF
        const pdfFilePath = path.join(finalOutputDir, 'reporte_validaciones.pdf');
        const pdfOk = await tryGeneratePdfHybrid(htmlFilePath, pdfFilePath, logger);

        if (pdfOk) {
            logger.info(`✅ Reporte PDF generado en ${pdfFilePath}`);
        } else {
            logger.warn('⚠️ No se generó PDF (no se encontró motor compatible). Se deja solo HTML.');
        }

        return { htmlFilePath, pdfFilePath };

    } catch (error: any) {
        const msg = `Error generando reporte: ${error.message}`;
        logger.error(msg);
        vscode.window.showErrorMessage(msg);
        throw error;
    }
}

/**
 * Intenta generar PDF usando Puppeteer o wkhtmltopdf.
 */
async function tryGeneratePdfHybrid(htmlPath: string, pdfPath: string, logger: Logger): Promise<boolean> {
    // 1️⃣ Intentar Puppeteer
    try {
        const htmlPdf = await import('html-pdf-node');
        const file = { url: `file://${htmlPath}` };
        const options = { format: 'A4', printBackground: true };
        logger.info('🧩 Intentando generar PDF con Puppeteer...');
        const pdfBuffer = await htmlPdf.generatePdf(file, options);
        fs.writeFileSync(pdfPath, pdfBuffer);
        logger.info('🖨️ PDF generado correctamente con Puppeteer.');
        return true;
    } catch (e: any) {
        logger.warn(`⚠️ Puppeteer no disponible o sin navegador (${e.message}).`);
    }

    // 2️⃣ Intentar wkhtmltopdf
    try {
        const wkPath = await findWkhtmltopdfPath();
        if (!wkPath) {
            logger.warn('⚠️ wkhtmltopdf no encontrado en PATH.');
            return false;
        }

        logger.info(`🧩 Generando PDF con wkhtmltopdf (${wkPath})...`);
        await new Promise<void>((resolve, reject) => {
            child_process.execFile(wkPath, [htmlPath, pdfPath], (err) => (err ? reject(err) : resolve()));
        });
        logger.info('🖨️ PDF generado correctamente con wkhtmltopdf.');
        return true;
    } catch (e: any) {
        logger.warn(`⚠️ Error usando wkhtmltopdf: ${e.message}`);
    }

    // 3️⃣ Ninguno disponible
    return false;
}

/**
 * Busca wkhtmltopdf en el PATH (Windows y Linux/Mac).
 */
async function findWkhtmltopdfPath(): Promise<string | null> {
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execa(cmd, ['wkhtmltopdf']);
        const candidate = stdout.split(/\r?\n/)[0].trim();
        if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
        // no encontrado
    }
    return null;
}

/**
 * Convierte los resultados IA en un objeto agrupado por clase.
 */
function formatIAResults(iaResults: any[]): Record<string, any> {
    const map: Record<string, any> = {};
    for (const r of iaResults) {
        if (r.Clase) {
            map[r.Clase] = {
                resumenHtml: r.resumenHtml || `<p>${r.resumen || 'Sin resumen'}</p>`
            };
        }
    }
    return map;
}

