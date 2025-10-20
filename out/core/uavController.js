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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderViewProvider = void 0;
exports.runUAV = runUAV;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const markdown_it_1 = __importDefault(require("markdown-it"));
const utils_1 = require("./utils");
const validator_1 = require("./validator");
const testSuite_1 = require("./testSuite");
const IAAnalisis_1 = require("./IAAnalisis");
const reportGenerator_1 = require("./reportGenerator");
const reportViewer_1 = require("./reportViewer");
async function runUAV(uri) {
    process.on('unhandledRejection', (reason) => {
        if (String(reason).includes('CreateEmbeddingSupplier')) {
            return;
        }
        console.error('[UAVController] Unhandled Rejection:', reason);
    });
    try {
        const channel = (0, utils_1.getGlobalChannel)();
        if (channel)
            channel.clear();
        const storageRoot = (0, utils_1.getStorageRoot)();
        const logDir = path.join(storageRoot, 'logs');
        const tempDir = path.join(storageRoot, 'temp');
        await fs.ensureDir(logDir);
        await fs.ensureDir(tempDir);
        await fs.emptyDir(tempDir);
        const mainLog = path.join(logDir, 'Validator.log');
        if (await fs.pathExists(mainLog))
            await fs.writeFile(mainLog, '');
        console.log(`[UAV][Controller] Limpieza previa completada en ${storageRoot}`);
    }
    catch (err) {
        console.warn('[UAV][Controller] ⚠️ No se pudo limpiar logs/temp antes de la ejecución:', err);
    }
    // 🚀 Ahora sí, crear el logger principal
    const logger = new utils_1.Logger('UAVController', true);
    logger.info('🚀 Iniciando ejecución del Unified Apex Validator...');
    let tempPackagePath;
    let sourceUri;
    let packageUri;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Unified Apex Validator',
        cancellable: true
    }, async (progress) => {
        try {
            sourceUri = uri && uri.scheme === 'file' ? uri : vscode.window.activeTextEditor?.document?.uri;
            if (!sourceUri || sourceUri.scheme !== 'file') {
                throw new Error('Selecciona un package.xml o una clase Apex (.cls) dentro del workspace.');
            }
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder)
                throw new Error('No se detectó carpeta de proyecto');
            const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
            let repoDir = config.get('sfRepositoryDir')?.trim() || '';
            if (!repoDir) {
                repoDir = workspaceFolder.uri.fsPath;
                logger.warn('⚠️ sfRepositoryDir no configurado. Usando raíz del workspace.');
            }
            packageUri = sourceUri;
            const ext = path.extname(sourceUri.fsPath).toLowerCase();
            if (ext === '.cls') {
                const className = path.basename(sourceUri.fsPath, '.cls');
                const tempDirWS = path.join(workspaceFolder.uri.fsPath, '.uav', 'temp');
                await fs.ensureDir(tempDirWS);
                const packageXml = [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
                    '    <types>',
                    `        <members>${className}</members>`,
                    '        <name>ApexClass</name>',
                    '    </types>',
                    '    <version>59.0</version>',
                    '</Package>',
                    ''
                ].join('\n');
                tempPackagePath = path.join(tempDirWS, `package-${className}-${Date.now()}.xml`);
                await fs.writeFile(tempPackagePath, packageXml, 'utf8');
                packageUri = vscode.Uri.file(tempPackagePath);
                logger.info(`Generado package.xml temporal para la clase ${className}: ${tempPackagePath}`);
            }
            // Validar estructura minima del repo
            if (!fs.existsSync(path.join(repoDir, 'sfdx-project.json'))) {
                logger.warn('⚠️ No se encontró sfdx-project.json. Ajustando repoDir al workspace raíz.');
                repoDir = workspaceFolder.uri.fsPath;
            }
            const pkgPath = packageUri.fsPath;
            const storageRoot = (0, utils_1.getStorageRoot)();
            const tempDir = path.join(storageRoot, 'temp');
            const logDir = path.join(storageRoot, 'logs');
            await fs.ensureDir(tempDir);
            await fs.ensureDir(logDir);
            const content = await fs.readFile(pkgPath, 'utf8');
            if (!content.includes('<name>ApexClass</name>')) {
                const msg = '❌ No se encontraron clases Apex en este XML.';
                logger.error(msg);
                throw new Error(msg);
            }
            // Paso 1: Parsear package.xml
            progress.report({ message: 'Analizando package.xml...' });
            logger.info('📦 Analizando package.xml...');
            if (!repoDir) {
                repoDir = path.join(workspaceFolder.uri.fsPath, 'force-app', 'main', 'default', 'classes');
                logger.warn(`⚠️ sfRepositoryDir no configurado. Usando ruta por defecto: ${repoDir}`);
            }
            else {
                logger.info(`📁 Repositorio configurado: ${repoDir}`);
            }
            const sfOrgAlias = config.get('sfOrgAlias')?.trim() || 'DEVSEGC';
            const aliasReady = await (0, utils_1.ensureOrgAliasConnected)(sfOrgAlias, logger);
            if (!aliasReady) {
                logger.warn(`⚠️ Se cancela la ejecución: la org "${sfOrgAlias}" no está conectada.`);
                return;
            }
            const { testClasses, nonTestClasses } = await (0, utils_1.parseApexClassesFromPackage)(pkgPath, repoDir);
            // 2️⃣ Validación estática (Code Analyzer + PMD)
            logger.info('🧠 Llamando a runValidator...');
            const { codeAnalyzerResults, pmdResults } = await (0, validator_1.runValidator)(packageUri, progress, repoDir);
            // 3️⃣ Ejecución de pruebas Apex
            progress.report({ message: 'Ejecutando pruebas Apex...' });
            logger.info('🧪 Ejecutando pruebas Apex...');
            const testSuite = new testSuite_1.TestSuite(workspaceFolder.uri.fsPath);
            const testResults = await testSuite.runTestSuite(testClasses, nonTestClasses);
            // 4) (Opcional) Analisis IA
            const skipIASetting = config.get('skipIAAnalysis') ?? false;
            const iaStatus = (0, IAAnalisis_1.evaluateIaConfig)();
            const skipIA = skipIASetting || !iaStatus.ready;
            let iaResults = [];
            if (!skipIA) {
                const sfGptPrompt = config.get('iaPromptTemplate') ?? 'Analiza la clase {class_name}:\n{truncated_body}';
                const sfGptMaxChar = config.get('maxIAClassChars') ?? 25000;
                progress.report({ message: 'Ejecutando analisis IA...' });
                logger.info('Ejecutando analisis de IA con Einstein GPT...');
                const ia = new IAAnalisis_1.IAAnalisis();
                for (const cls of nonTestClasses) {
                    const clsPath = path.join(repoDir, 'force-app', 'main', 'default', 'classes', `${cls}.cls`);
                    if (!fs.existsSync(clsPath)) {
                        logger.warn(`Clase no encontrada: ${clsPath}`);
                        continue;
                    }
                    try {
                        logger.info(`Enviando clase a IA: ${cls}`);
                        const content = await fs.readFile(clsPath, 'utf8');
                        const truncated = content.length > sfGptMaxChar ? content.slice(0, sfGptMaxChar) : content;
                        if (content.length > sfGptMaxChar) {
                            logger.warn(`Clase ${cls} truncada a ${sfGptMaxChar} caracteres para analisis.`);
                        }
                        const prompt = sfGptPrompt
                            .replace('{class_name}', cls)
                            .replace('{truncated_body}', truncated);
                        const analysis = await ia.generate(prompt);
                        const md = new markdown_it_1.default({
                            html: true,
                            linkify: true,
                            typographer: true
                        });
                        const resumenHtml = md.render(analysis.resumen || '');
                        iaResults.push({ Clase: cls, resumenHtml });
                    }
                    catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        logger.warn(`IA fallo para ${cls}: ${message}`);
                    }
                }
                logger.info(`Analisis IA finalizado - clases procesadas: ${iaResults.length}`);
            }
            else if (skipIASetting) {
                logger.info('Analisis IA omitido por configuracion (skipIAAnalysis=true).');
            }
            else {
                logger.info(`IA deshabilitada - faltan parametros: ${iaStatus.missing.join(', ')}`);
            }
            // 5️⃣ Generar reportes
            progress.report({ message: 'Generando reportes...' });
            logger.info('📊 Generando reportes...');
            const outputDir = config.get('outputDir')?.trim() || path.join(storageRoot, 'output');
            await fs.ensureDir(outputDir);
            await (0, reportGenerator_1.generateReport)(outputDir, {
                codeAnalyzerResults,
                pmdResults,
                testResults,
                iaResults
            });
            logger.info(`✅ UAV completado. Reporte generado en: ${outputDir}`);
            vscode.window.showInformationMessage(`✅ UAV completado. Reporte generado en ${outputDir}.`);
            // 👀 Abrir el reporte en vista integrada dentro de VS Code
            const htmlReport = path.join(outputDir, 'reporte_validaciones.html');
            if (fs.existsSync(htmlReport)) {
                (0, reportViewer_1.showReport)(htmlReport, 'Reporte de Validación Apex');
            }
            else {
                logger.warn(`⚠️ No se encontró el reporte HTML en ${htmlReport}`);
            }
            // 🧹 Limpieza final si corresponde
            const keepLogFiles = config.get('keepLogFiles') ?? false;
            if (!keepLogFiles) {
                await (0, utils_1.cleanUpFiles)([tempDir, logDir], logger);
                logger.info('🧼 Archivos temporales y logs eliminados tras ejecución exitosa.');
            }
            else {
                logger.info('✅ Ejecución exitosa. Se conservaron los logs por configuración.');
            }
        }
        catch (err) {
            if (err.message.includes('No se encontraron clases Apex')) {
                vscode.window.showWarningMessage(err.message);
                const failedPath = packageUri?.fsPath || sourceUri?.fsPath || 'N/A';
                logger.warn(`⚠️ UAV finalizado sin ApexClass (${failedPath})`);
            }
            else {
                logger.error(`❌ Error en proceso UAV: ${err.message}`);
                vscode.window.showErrorMessage(`Error en UAV: ${err.message}`);
            }
        }
        finally {
            if (tempPackagePath) {
                try {
                    await fs.remove(tempPackagePath);
                }
                catch (cleanupErr) {
                    logger.warn(`No se pudo limpiar el package temporal (${tempPackagePath}): ${cleanupErr}`);
                }
            }
        }
    });
}
class FolderViewProvider {
    folderPath;
    fileExtension;
    label;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(folderPath, fileExtension, label) {
        this.folderPath = folderPath;
        this.fileExtension = fileExtension;
        this.label = label;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        try {
            if (!this.folderPath || !(await fs.pathExists(this.folderPath))) {
                return [new FileItem(`No se encontró carpeta: ${this.folderPath}`, '', false)];
            }
            const files = await fs.readdir(this.folderPath, { withFileTypes: true });
            const filtered = files
                .filter(f => {
                if (!f.isFile())
                    return false;
                const ext = path.extname(f.name).toLowerCase();
                return this.fileExtension.split('|').some(e => ext === `.${e.trim()}`);
            })
                .map(f => new FileItem(f.name, path.join(this.folderPath, f.name), true));
            if (!filtered.length) {
                return [new FileItem('Sin archivos disponibles', '', false)];
            }
            return filtered;
        }
        catch (err) {
            console.error(`[UAV][${this.label}] Error leyendo archivos:`, err);
            return [new FileItem('Error leyendo carpeta', '', false)];
        }
    }
}
exports.FolderViewProvider = FolderViewProvider;
class FileItem extends vscode.TreeItem {
    label;
    filePath;
    clickable;
    constructor(label, filePath, clickable) {
        super(label);
        this.label = label;
        this.filePath = filePath;
        this.clickable = clickable;
        this.iconPath = new vscode.ThemeIcon('file');
        this.tooltip = filePath;
        if (clickable) {
            this.command = {
                command: 'uav.openFile',
                title: 'Abrir archivo',
                arguments: [vscode.Uri.file(filePath)]
            };
        }
    }
}
