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
const i18n_1 = require("../i18n");
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
        console.log((0, i18n_1.localize)('log.uavController.preCleanupDone', '[UAV][Controller] Pre-run cleanup completed at {0}', storageRoot)); // Localized string
    }
    catch (err) {
        console.warn((0, i18n_1.localize)('log.uavController.preCleanupFailed', '[UAV][Controller] ⚠️ Could not clean logs/temp before execution.'), err); // Localized string
    }
    // 🚀 Ahora sí, crear el logger principal
    const logger = new utils_1.Logger('UAVController', true);
    logger.info((0, i18n_1.localize)('log.uavController.start', '🚀 Starting Unified Apex Validator run...')); // Localized string
    let tempPackagePath;
    let sourceUri;
    let packageUri;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: (0, i18n_1.localize)('progress.uavController.title', 'Unified Apex Validator'), // Localized string
        cancellable: true
    }, async (progress) => {
        try {
            sourceUri = uri && uri.scheme === 'file' ? uri : vscode.window.activeTextEditor?.document?.uri;
            if (!sourceUri || sourceUri.scheme !== 'file') {
                throw new Error((0, i18n_1.localize)('error.uavController.selectSource', 'Select a package.xml or Apex (.cls) file within the workspace.')); // Localized string
            }
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder)
                throw new Error((0, i18n_1.localize)('error.uavController.noWorkspace', 'No workspace folder detected.')); // Localized string
            const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
            let repoDir = config.get('sfRepositoryDir')?.trim() || '';
            if (!repoDir) {
                repoDir = workspaceFolder.uri.fsPath;
                logger.warn((0, i18n_1.localize)('log.uavController.repoDirFallbackWorkspace', '⚠️ sfRepositoryDir not configured. Using workspace root.')); // Localized string
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
                    '    <version>64.0</version>',
                    '</Package>',
                    ''
                ].join('\n');
                tempPackagePath = path.join(tempDirWS, `package-${className}-${Date.now()}.xml`);
                await fs.writeFile(tempPackagePath, packageXml, 'utf8');
                packageUri = vscode.Uri.file(tempPackagePath);
                logger.info((0, i18n_1.localize)('log.uavController.tempPackageCreated', 'Generated temporary package.xml for class {0}: {1}', className, tempPackagePath)); // Localized string
            }
            // Validar estructura minima del repo
            if (!fs.existsSync(path.join(repoDir, 'sfdx-project.json'))) {
                logger.warn((0, i18n_1.localize)('log.uavController.noSfdxProject', '⚠️ sfdx-project.json not found. Falling back to workspace root for repoDir.')); // Localized string
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
                const msg = (0, i18n_1.localize)('error.uavController.noApexClasses', '❌ No Apex classes were found in this XML.'); // Localized string
                logger.error(msg);
                throw new Error(msg);
            }
            // Paso 1: Parsear package.xml
            progress.report({ message: (0, i18n_1.localize)('progress.uavController.analyzingPackage', 'Analyzing package.xml...') }); // Localized string
            logger.info((0, i18n_1.localize)('log.uavController.analyzingPackage', '📦 Analyzing package.xml...')); // Localized string
            if (!repoDir) {
                repoDir = path.join(workspaceFolder.uri.fsPath, 'force-app', 'main', 'default', 'classes');
                logger.warn((0, i18n_1.localize)('log.uavController.repoDirFallbackDefault', '⚠️ sfRepositoryDir not configured. Using default path: {0}', repoDir)); // Localized string
            }
            else {
                logger.info((0, i18n_1.localize)('log.uavController.repoDirConfigured', '📁 Repository configured: {0}', repoDir)); // Localized string
            }
            const defaultOrg = await (0, utils_1.getDefaultConnectedOrg)(logger);
            if (!defaultOrg) {
                const message = (0, i18n_1.localize)('error.uavController.noDefaultOrg', 'No default org connected in Salesforce CLI. Run "sf org login web" and try again.'); // Localized string
                logger.error(message);
                vscode.window.showErrorMessage(message);
                return;
            }
            const targetOrg = defaultOrg.alias || defaultOrg.username;
            const aliasReady = await (0, utils_1.ensureOrgAliasConnected)(targetOrg, logger);
            if (!aliasReady) {
                logger.warn((0, i18n_1.localize)('log.uavController.orgNotConnected', '⚠️ Execution cancelled: org "{0}" is not connected.', targetOrg)); // Localized string
                return;
            }
            const { testClasses, nonTestClasses } = await (0, utils_1.parseApexClassesFromPackage)(pkgPath, repoDir);
            // 2️⃣ Validación estática (Code Analyzer + PMD)
            logger.info((0, i18n_1.localize)('log.uavController.runValidator', '🧠 Invoking runValidator...')); // Localized string
            const { codeAnalyzerResults, pmdResults } = await (0, validator_1.runValidator)(packageUri, progress, repoDir);
            // 3️⃣ Ejecución de pruebas Apex
            progress.report({ message: (0, i18n_1.localize)('progress.uavController.runningTests', 'Running Apex tests...') }); // Localized string
            logger.info((0, i18n_1.localize)('log.uavController.runningTests', '🧪 Executing Apex tests...')); // Localized string
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
                progress.report({ message: (0, i18n_1.localize)('progress.uavController.runningAi', 'Running AI analysis...') }); // Localized string
                logger.info((0, i18n_1.localize)('log.uavController.runningAi', 'Running AI analysis with Einstein GPT...')); // Localized string
                const ia = new IAAnalisis_1.IAAnalisis();
                for (const cls of nonTestClasses) {
                    const clsPath = path.join(repoDir, 'force-app', 'main', 'default', 'classes', `${cls}.cls`);
                    if (!fs.existsSync(clsPath)) {
                        logger.warn((0, i18n_1.localize)('log.uavController.classMissing', 'Class not found: {0}', clsPath)); // Localized string
                        continue;
                    }
                    try {
                        logger.info((0, i18n_1.localize)('log.uavController.sendingClassToAi', 'Sending class to AI: {0}', cls)); // Localized string
                        const content = await fs.readFile(clsPath, 'utf8');
                        const truncated = content.length > sfGptMaxChar ? content.slice(0, sfGptMaxChar) : content;
                        if (content.length > sfGptMaxChar) {
                            logger.warn((0, i18n_1.localize)('log.uavController.classTruncated', 'Class {0} truncated to {1} characters for analysis.', cls, sfGptMaxChar)); // Localized string
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
                        logger.warn((0, i18n_1.localize)('log.uavController.aiFailed', 'AI analysis failed for {0}: {1}', cls, message)); // Localized string
                    }
                }
                logger.info((0, i18n_1.localize)('log.uavController.aiCompleted', 'AI analysis finished - classes processed: {0}', iaResults.length)); // Localized string
            }
            else if (skipIASetting) {
                logger.info((0, i18n_1.localize)('log.uavController.aiSkippedSetting', 'AI analysis skipped by configuration (skipIAAnalysis=true).')); // Localized string
            }
            else {
                logger.info((0, i18n_1.localize)('log.uavController.aiDisabledParams', 'AI analysis disabled - missing parameters: {0}', iaStatus.missing.join(', '))); // Localized string
            }
            // 5️⃣ Generar reportes
            progress.report({ message: (0, i18n_1.localize)('progress.uavController.generatingReports', 'Generating reports...') }); // Localized string
            logger.info((0, i18n_1.localize)('log.uavController.generatingReports', '📊 Generating reports...')); // Localized string
            const outputDir = config.get('outputDir')?.trim() || path.join(storageRoot, 'output');
            await fs.ensureDir(outputDir);
            await (0, reportGenerator_1.generateReport)(outputDir, {
                codeAnalyzerResults,
                pmdResults,
                testResults,
                iaResults
            });
            logger.info((0, i18n_1.localize)('log.uavController.runCompleted', '✅ UAV completed. Report saved at: {0}', outputDir)); // Localized string
            vscode.window.showInformationMessage((0, i18n_1.localize)('info.uavController.runCompleted', '✅ UAV completed. Report generated in {0}.', outputDir)); // Localized string
            // 👀 Abrir el reporte en vista integrada dentro de VS Code
            const htmlReport = path.join(outputDir, 'reporte_validaciones.html');
            if (fs.existsSync(htmlReport)) {
                (0, reportViewer_1.showReport)(htmlReport, (0, i18n_1.localize)('ui.reportViewer.validationTitle', 'Apex Validation Report')); // Localized string
            }
            else {
                logger.warn((0, i18n_1.localize)('log.uavController.reportMissing', '⚠️ HTML report not found at {0}', htmlReport)); // Localized string
            }
            // 🧹 Limpieza final si corresponde
            const keepLogFiles = config.get('keepLogFiles') ?? false;
            if (!keepLogFiles) {
                await (0, utils_1.cleanUpFiles)([tempDir, logDir], logger);
                logger.info((0, i18n_1.localize)('log.uavController.cleanupDone', '🧼 Temporary files and logs removed after successful execution.')); // Localized string
            }
            else {
                logger.info((0, i18n_1.localize)('log.uavController.logsKept', '✅ Successful execution. Logs kept per configuration.')); // Localized string
            }
        }
        catch (err) {
            const noApexMessage = (0, i18n_1.localize)('error.uavController.noApexClasses', '❌ No Apex classes were found in this XML.'); // Localized string
            if (err.message.includes(noApexMessage)) {
                vscode.window.showWarningMessage(err.message);
                const failedPath = packageUri?.fsPath || sourceUri?.fsPath || 'N/A';
                logger.warn((0, i18n_1.localize)('log.uavController.noApexInPackage', '⚠️ UAV finished without ApexClass ({0})', failedPath)); // Localized string
            }
            else {
                logger.error((0, i18n_1.localize)('log.uavController.runFailed', '❌ Error during UAV run: {0}', err.message)); // Localized string
                vscode.window.showErrorMessage((0, i18n_1.localize)('error.uavController.runFailed', 'Error in UAV: {0}', err.message)); // Localized string
            }
        }
        finally {
            if (tempPackagePath) {
                try {
                    await fs.remove(tempPackagePath);
                }
                catch (cleanupErr) {
                    logger.warn((0, i18n_1.localize)('log.uavController.tempPackageCleanupFailed', 'Could not clean temporary package ({0}): {1}', tempPackagePath, String(cleanupErr))); // Localized string
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
                return [new FileItem((0, i18n_1.localize)('ui.folderView.notFound', 'Folder not found: {0}', this.folderPath), '', false)]; // Localized string
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
                return [new FileItem((0, i18n_1.localize)('ui.folderView.empty', 'No files available'), '', false)]; // Localized string
            }
            return filtered;
        }
        catch (err) {
            console.error((0, i18n_1.localize)('log.folderView.readError', '[UAV][{0}] Error reading files:', this.label), err); // Localized string
            return [new FileItem((0, i18n_1.localize)('ui.folderView.error', 'Error reading folder'), '', false)]; // Localized string
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
                title: (0, i18n_1.localize)('command.openFile.title', 'Open file'), // Localized string
                arguments: [vscode.Uri.file(filePath)]
            };
        }
    }
}
