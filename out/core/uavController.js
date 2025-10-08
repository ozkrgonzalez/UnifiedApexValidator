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
exports.FolderViewProvider = exports.DependenciesProvider = void 0;
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
const execa_1 = require("execa");
const reportViewer_1 = require("./reportViewer");
async function runUAV(uri) {
    const logger = new utils_1.Logger('UAVController', true);
    logger.info('🚀 Iniciando ejecución del Unified Apex Validator...');
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Unified Apex Validator',
        cancellable: true
    }, async (progress) => {
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder)
                throw new Error('No se detectó carpeta de proyecto');
            const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
            let repoDir = config.get('sfRepositoryDir')?.trim() || '';
            if (!repoDir) {
                repoDir = workspaceFolder.uri.fsPath;
                logger.warn('⚠️ sfRepositoryDir no configurado. Usando raíz del workspace.');
            }
            // 🧩 Validar estructura mínima del repo
            if (!fs.existsSync(path.join(repoDir, 'sfdx-project.json'))) {
                logger.warn('⚠️ No se encontró sfdx-project.json. Ajustando repoDir al workspace raíz.');
                repoDir = workspaceFolder.uri.fsPath;
            }
            const pkgPath = uri.fsPath;
            const storageRoot = (0, utils_1.getStorageRoot)();
            const tempDir = path.join(storageRoot, 'temp');
            const logDir = path.join(storageRoot, 'logs');
            await fs.ensureDir(tempDir);
            await fs.ensureDir(logDir);
            // 1️⃣ Parsear package.xml
            progress.report({ message: 'Analizando package.xml...' });
            logger.info('📦 Analizando package.xml...');
            ;
            if (!repoDir) {
                repoDir = path.join(workspaceFolder.uri.fsPath, 'force-app', 'main', 'default', 'classes');
                logger.warn(`⚠️ sfRepositoryDir no configurado. Usando ruta por defecto: ${repoDir}`);
            }
            else {
                logger.info(`📁 Repositorio configurado: ${repoDir}`);
            }
            // ahora sí: usar ese repoDir correcto
            const { testClasses, nonTestClasses } = await (0, utils_1.parseApexClassesFromPackage)(pkgPath, repoDir);
            // 2️⃣ Validación estática (Code Analyzer + PMD)
            logger.info('🧠 Llamando a runValidator...');
            // ahora también obtenemos pmdResults del runValidator
            const { codeAnalyzerResults, pmdResults } = await (0, validator_1.runValidator)(uri, progress, repoDir);
            logger.info(`🧩 runValidator finalizó → CodeAnalyzer=${codeAnalyzerResults?.length || 0}, CPD=${pmdResults?.length || 0}`);
            // 3️⃣ Ejecución de pruebas Apex
            progress.report({ message: 'Ejecutando pruebas Apex...' });
            logger.info(`🧩 Clases de prueba detectadas: ${testClasses.join(', ') || 'NINGUNA'}`);
            logger.info('🧪 Ejecutando pruebas Apex...');
            const testSuite = new testSuite_1.TestSuite(workspaceFolder.uri.fsPath);
            const testResults = await testSuite.runTestSuite(testClasses, nonTestClasses);
            // 4️⃣ (Opcional) Análisis IA
            const skipIA = config.get('skipIAAnalysis') ?? false;
            let iaResults = [];
            logger.info(`🧩 Config skipIAAnalysis=${skipIA}`);
            if (!skipIA) {
                const sfClientId = config.get('sfClientId');
                const sfClientSecret = config.get('sfClientSecret');
                const sfGptEndpoint = config.get('sfGptEndpoint');
                const sfGptPrompt = config.get('iaPromptTemplate') ?? 'Analiza la clase {class_name}:\n{truncated_body}';
                const sfGptMaxChar = config.get('maxIAClassChars') ?? 25000;
                /*logger.info(`🔍 Validando parámetros IA:`);
                logger.info(`   sfClientId=${sfClientId ? '[OK]' : '[FALTA]'}`);
                logger.info(`   sfClientSecret=${sfClientSecret ? '[OK]' : '[FALTA]'}`);
                logger.info(`   sfGptEndpoint=${sfGptEndpoint ? sfGptEndpoint : '[NO DEFINIDO]'}`);*/
                const iaEnabled = !!sfClientId && !!sfClientSecret && !!sfGptEndpoint;
                if (iaEnabled) {
                    progress.report({ message: 'Ejecutando análisis IA...' });
                    logger.info('🤖 Ejecutando análisis de IA con Einstein GPT...');
                    const ia = new IAAnalisis_1.IAAnalisis();
                    for (const cls of nonTestClasses) {
                        const clsPath = path.join(repoDir, 'force-app', 'main', 'default', 'classes', `${cls}.cls`);
                        if (!fs.existsSync(clsPath)) {
                            logger.warn(`⚠️ Clase no encontrada: ${clsPath}`);
                            continue;
                        }
                        try {
                            logger.info(`📘 Enviando clase a IA: ${cls}`);
                            const content = await fs.readFile(clsPath, 'utf8');
                            // 🔹 Truncar si excede cierto tamaño (para no pasar textos enormes)
                            const truncated = content.length > sfGptMaxChar ? content.slice(0, sfGptMaxChar) : content;
                            if (content.length > sfGptMaxChar) {
                                logger.warn(`⚠️ Clase ${cls} truncada a ${sfGptMaxChar} caracteres para análisis.`);
                            }
                            // 🔹 Combinar con el prompt base de settings
                            if (!sfGptPrompt) {
                                logger.warn('⚠️ No hay plantilla de prompt configurada en settings (iaPromptTemplate).');
                                continue;
                            }
                            const prompt = sfGptPrompt
                                .replace('{class_name}', cls)
                                .replace('{truncated_body}', truncated);
                            // 🔹 Enviar el prompt armado, no solo el código
                            const analysis = await ia.analizar(prompt);
                            logger.info(`🧠 IA -> ${cls}: ${analysis.resumen.slice(0, 100)}...`);
                            const md = new markdown_it_1.default({
                                html: true,
                                linkify: true,
                                typographer: true
                            });
                            const resumenHtml = md.render(analysis.resumen || '');
                            logger.info(`MD Analisys: ${resumenHtml}`);
                            iaResults.push({ Clase: cls, resumenHtml });
                        }
                        catch (err) {
                            logger.warn(`⚠️ IA falló para ${cls}: ${err.message}`);
                        }
                    }
                    logger.info(`🏁 Análisis IA finalizado — clases procesadas: ${iaResults.length}`);
                }
                else {
                    logger.info('ℹ️ IA deshabilitada — faltan credenciales o endpoint.');
                }
            }
            else {
                logger.info('⏭️ Análisis IA omitido por configuración (skipIAAnalysis=true).');
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
            logger.error(`❌ Error en proceso UAV: ${err.message}`);
            vscode.window.showErrorMessage(`Error en UAV: ${err.message}`);
        }
    });
}
class DependenciesProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(context) {
        this.context = context;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        const dependencies = [];
        const checks = [
            { label: 'Node.js', cmd: 'node --version' },
            { label: 'Salesforce CLI (sf)', cmd: 'sf --version' },
            { label: 'Salesforce Code Analyzer v5', cmd: 'sf code-analyzer run --help' },
            { label: 'Java', cmd: 'java -version' },
            { label: 'PMD', cmd: 'pmd --version' },
            { label: 'wkhtmltopdf', cmd: 'wkhtmltopdf --version' }
        ];
        for (const dep of checks) {
            const ok = await this.checkCommand(dep.cmd);
            dependencies.push(new DependencyItem(dep.label, ok));
        }
        // IA config (desde settings)
        const cfg = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const iaFields = [
            cfg.get('sfGptEndpoint'),
            cfg.get('sfGptModel'),
            cfg.get('iaPromptTemplate')
        ];
        const iaConfigured = iaFields.every(v => typeof v === 'string' && v.trim() !== '');
        dependencies.push(new DependencyItem('IA Configuración', iaConfigured));
        return dependencies;
    }
    async checkCommand(command) {
        try {
            await (0, execa_1.execa)(command, { shell: true });
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.DependenciesProvider = DependenciesProvider;
class DependencyItem extends vscode.TreeItem {
    label;
    ok;
    constructor(label, ok) {
        super(label);
        this.label = label;
        this.ok = ok;
        this.iconPath = new vscode.ThemeIcon(ok ? 'check' : 'error', ok ? new vscode.ThemeColor('testing.iconPassed') : new vscode.ThemeColor('testing.iconFailed'));
        this.tooltip = ok ? 'Disponible' : 'No encontrado o no accesible';
        this.description = ok ? 'OK' : 'Falta';
    }
}
class FolderViewProvider {
    folderPath;
    fileExtension;
    label;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(folderPath, fileExtension, // puede ser .html, .pdf, .log, etc.
    label) {
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
