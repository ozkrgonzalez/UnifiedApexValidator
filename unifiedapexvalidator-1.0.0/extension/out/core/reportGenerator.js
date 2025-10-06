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
const utils_1 = require("./utils");
const pdfGenerator_1 = require("./pdfGenerator");
const logger = new utils_1.Logger('ReportGenerator');
/**
 * Genera el reporte HTML y PDF consolidado del UAV.
 * Lanza error si no está configurado "UnifiedApexValidator.outputDir".
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
        const templatePath = path.join(extensionPath, 'resources', 'templates', 'reportTemplate.html');
        if (!fs.existsSync(templatePath)) {
            throw new Error(`No se encontró el template empaquetado en ${templatePath}`);
        }
        // 🔹 Marcar cobertura baja
        const coverageData = (data.testResults?.coverage_data || []).map((c) => ({
            ...c,
            isLowCoverage: (c.CoveragePercentageInt ?? 0) < 75
        }));
        // 🔹 Transformar resultados IA
        const iaFormatted = formatIAResults(data.iaResults || []);
        // 🔹 Contexto para el template
        const context = {
            apex_results: data.codeAnalyzerResults || [],
            pmd_results: data.pmdResults || [],
            test_results: data.testResults?.test_results || [],
            test_coverage: coverageData,
            einsteinAnalysis: iaFormatted
        };
        // 🧩 Render con Nunjucks
        const env = nunjucks.configure(path.dirname(templatePath), { autoescape: true });
        const html = env.render('reportTemplate.html', context);
        // 📝 Guardar HTML
        const htmlFilePath = path.join(finalOutputDir, 'reporte_validaciones.html');
        await fs.writeFile(htmlFilePath, html, 'utf8');
        // 📄 Generar PDF
        const pdfPath = path.join(finalOutputDir, 'reporte_validaciones.pdf');
        await (0, pdfGenerator_1.createPdf)(html, pdfPath);
        logger.info(`✅ Reporte generado correctamente en ${finalOutputDir}`);
        return { htmlFilePath, pdfPath };
    }
    catch (error) {
        const msg = `Error generando reporte: ${error.message}`;
        logger.error(msg);
        vscode.window.showErrorMessage(msg);
        throw error;
    }
}
/**
 * Convierte los resultados IA en un objeto agrupado por clase.
 */
function formatIAResults(iaResults) {
    const map = {};
    for (const r of iaResults) {
        if (r.Clase) {
            map[r.Clase] = `
                <h3>Resumen</h3>
                <p>${r.resumen || 'Sin resumen'}</p>
                <h3>Hallazgos</h3>
                <ul>${(r.hallazgos || []).map((h) => `<li>${h}</li>`).join('')}</ul>
                <h3>Sugerencias</h3>
                <ul>${(r.sugerencias || []).map((s) => `<li>${s}</li>`).join('')}</ul>
            `;
        }
    }
    return map;
}
