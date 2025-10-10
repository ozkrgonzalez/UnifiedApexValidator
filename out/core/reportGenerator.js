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
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const nunjucks = __importStar(require("nunjucks"));
const child_process = __importStar(require("child_process"));
const execa_1 = require("execa");
const utils_1 = require("./utils");
const logger = new utils_1.Logger('ReportGenerator', false);
/**
 * Genera el reporte HTML y PDF consolidado del UAV.
 * Intenta wkhtmltopdf; si ninguno, deja solo HTML.
 */
async function generateReport(outputDir, data) {
    try {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const outputSetting = config.get('outputDir')?.trim();
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
        const coverageData = (data.testResults?.coverage_data || []).map((c) => ({
            ...c,
            isLowCoverage: (c.CoveragePercentageInt ?? 0) < 75
        }));
        // 🔹 Calcular cuántas clases tienen cobertura < 75 %
        const lowCoverageCount = coverageData.filter((c) => c.isLowCoverage).length;
        // 🔹 Transformar resultados IA
        const iaFormatted = formatIAResults(data.iaResults || []);
        // 🔹 Contar clases únicas con duplicados detectados
        const duplicatedClasses = new Set();
        for (const dup of data.pmdResults || []) {
            const classes = (dup.clases || '')
                .split(',')
                .map((c) => c.trim())
                .filter((c) => c.length > 0);
            classes.forEach((c) => duplicatedClasses.add(c));
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
        if (!pdfOk) {
            logger.warn('⚠️ No se generó PDF (no se encontró motor compatible). Se deja solo HTML.');
        }
        return { htmlFilePath, pdfFilePath };
    }
    catch (error) {
        const msg = `Error generando reporte: ${error.message}`;
        logger.error(msg);
        vscode.window.showErrorMessage(msg);
        throw error;
    }
}
/**
 * Intenta generar PDF usando Puppeteer o wkhtmltopdf.
 */
async function tryGeneratePdfHybrid(htmlPath, pdfPath, logger) {
    //Intentar wkhtmltopdf
    try {
        const wkPath = await findWkhtmltopdfPath();
        if (!wkPath) {
            logger.warn('⚠️ wkhtmltopdf no encontrado en PATH.');
            return false;
        }
        logger.info(`🧩 Generando PDF con wkhtmltopdf (${wkPath})...`);
        await new Promise((resolve, reject) => {
            child_process.execFile(wkPath, [htmlPath, pdfPath], (err) => (err ? reject(err) : resolve()));
        });
        logger.info('🖨️ PDF generado correctamente con wkhtmltopdf.');
        return true;
    }
    catch (e) {
        logger.warn(`⚠️ Error usando wkhtmltopdf: ${e.message}`);
    }
    return false;
}
/**
 * Busca wkhtmltopdf en el PATH (Windows y Linux/Mac).
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
        logger.warn(`⚠️ wkhtmltopdf no encontrado`);
    }
    return null;
}
/**
 * Convierte los resultados IA en un objeto agrupado por clase.
 */
function formatIAResults(iaResults) {
    const map = {};
    for (const r of iaResults) {
        if (r.Clase) {
            map[r.Clase] = {
                resumenHtml: r.resumenHtml || `<p>${r.resumen || 'Sin resumen'}</p>`
            };
        }
    }
    return map;
}
