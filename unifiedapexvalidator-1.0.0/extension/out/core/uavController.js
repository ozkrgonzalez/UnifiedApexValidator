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
exports.runUAV = runUAV;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const utils_1 = require("./utils");
const validator_1 = require("./validator");
const testSuite_1 = require("./testSuite");
const IAAnalisis_1 = require("./IAAnalisis");
const reportGenerator_1 = require("./reportGenerator");
const utils_2 = require("./utils");
const logger = new utils_1.Logger('UAVController');
/**
 * Orquestador principal del Unified Apex Validator
 */
async function runUAV(uri) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Unified Apex Validator',
        cancellable: false
    }, async (progress) => {
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder)
                throw new Error('No se detectó carpeta de proyecto');
            const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
            const repoDir = path.dirname(uri.fsPath);
            const pkgPath = uri.fsPath;
            const tempDir = path.join(workspaceFolder.uri.fsPath, '.uav', 'temp');
            await fs.ensureDir(tempDir);
            // 1️⃣ Parsear package.xml para separar clases test / no test
            progress.report({ message: 'Analizando package.xml...' });
            const { testClasses, nonTestClasses } = await (0, utils_2.parseApexClassesFromPackage)(pkgPath, repoDir);
            // 2️⃣ Validación estática (Code Analyzer + PMD)
            progress.report({ message: 'Analizando código Apex...' });
            const { codeAnalyzerResults, pmdResults } = await (0, validator_1.runValidator)(uri, progress);
            // 3️⃣ Ejecución de pruebas Apex
            progress.report({ message: 'Ejecutando pruebas Apex...' });
            const testSuite = new testSuite_1.TestSuite(workspaceFolder.uri.fsPath);
            const testResults = await testSuite.runTestSuite(testClasses, nonTestClasses);
            // 4️⃣ (Opcional) Análisis IA
            const skipIA = config.get('skipIA') ?? false;
            let iaResults = [];
            if (!skipIA) {
                const iaEnabled = config.get('sfClientId') &&
                    config.get('sfClientSecret') &&
                    config.get('sfGptEndpoint');
                if (iaEnabled) {
                    progress.report({ message: 'Ejecutando análisis IA...' });
                    const ia = new IAAnalisis_1.IAAnalisis();
                    for (const cls of nonTestClasses) {
                        const clsPath = path.join(repoDir, `${cls}.cls`);
                        if (!fs.existsSync(clsPath))
                            continue;
                        try {
                            const content = await fs.readFile(clsPath, 'utf8');
                            const analysis = await ia.analizar(content);
                            iaResults.push({ Clase: cls, ...analysis });
                        }
                        catch (err) {
                            logger.warn(`IA falló para ${cls}: ${err.message}`);
                        }
                    }
                }
                else {
                    logger.info('IA deshabilitada — faltan credenciales o endpoint.');
                }
            }
            else {
                logger.info('⏭️ Análisis IA omitido por configuración (skipIA=true).');
            }
            // 5️⃣ Generar reportes
            progress.report({ message: 'Generando reportes...' });
            const outputDir = config.get('outputDir') || path.join(workspaceFolder.uri.fsPath, '.uav', 'output');
            await fs.ensureDir(outputDir);
            await (0, reportGenerator_1.generateReport)(outputDir, { codeAnalyzerResults, pmdResults, testResults, iaResults });
            vscode.window.showInformationMessage(`✅ UAV completado. Reporte generado en ${outputDir}.`);
        }
        catch (err) {
            logger.error(`Error en proceso UAV: ${err.message}`);
            vscode.window.showErrorMessage(`Error en UAV: ${err.message}`);
        }
    });
}
