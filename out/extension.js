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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const child_process_1 = require("child_process");
const dependenciesProvider_1 = require("./providers/dependenciesProvider");
const uavController_1 = require("./core/uavController");
const compareController_1 = require("./core/compareController");
const utils_1 = require("./core/utils");
const generateApexDocChunked_1 = require("./core/generateApexDocChunked");
const IAAnalisis_1 = require("./core/IAAnalisis");
const apexAllmanFormatter_1 = require("./core/apexAllmanFormatter");
const whereUsedPanel_1 = require("./core/whereUsedPanel");
const i18n_1 = require("./i18n");
/**
 * Punto de entrada de la extensión Unified Apex Validator.
 * Se ejecuta al activar la extensión por comando.
 */
async function activate(context) {
    console.log((0, i18n_1.localize)('log.extension.activated', '[UAV][extension] Unified Apex Validator activated.')); // Localized string
    console.log((0, i18n_1.localize)('log.extension.storagePath', '[UAV][extension] globalStorageUri: {0}', context.globalStorageUri.fsPath)); // Localized string
    // 🧠 Dependencias
    const dependenciesProvider = new dependenciesProvider_1.DependenciesProvider(context);
    vscode.window.registerTreeDataProvider('uav.dependenciesView', dependenciesProvider);
    const dependencyStatusItem = vscode.window.createStatusBarItem('uav.dependencyStatus', vscode.StatusBarAlignment.Left, 100);
    dependencyStatusItem.name = 'Unified Apex Validator';
    dependencyStatusItem.command = 'uav.dependenciesView.focus';
    context.subscriptions.push(dependencyStatusItem);
    const updateDependencyStatus = async () => {
        try {
            const summary = await dependenciesProvider.getDependencySummary();
            const issues = summary.records.filter((record) => record.status.state !== 'ok');
            if (summary.state === 'ok') {
                dependencyStatusItem.text = 'UAV Ready $(pass)';
                dependencyStatusItem.tooltip = new vscode.MarkdownString('Todas las dependencias están actualizadas.\n\nHaz clic para abrir el panel de dependencias.');
            }
            else {
                const lines = issues.length
                    ? issues.map((record) => {
                        const { dep, status } = record;
                        if (record.info?.type === 'ia' && !record.info.ready && record.info.missing.length) {
                            return `- ${dep.label}: Configura ${record.info.missing.join(', ')}`;
                        }
                        const stateLabel = status.state === 'missing' ? 'No instalado' : 'Desactualizado';
                        const versionInfo = [
                            status.detectedVersion ? `Detectado ${status.detectedVersion}` : null,
                            dep.minVersion ? `Mínimo ${dep.minVersion}` : null
                        ]
                            .filter(Boolean)
                            .join(' | ');
                        return `- ${dep.label}: ${stateLabel}${versionInfo ? ` (${versionInfo})` : ''}`;
                    })
                    : ['- Sin detalles disponibles'];
                const tooltip = new vscode.MarkdownString(['Dependencias pendientes:', ...lines, '', 'Haz clic para revisar el panel.'].join('\n'));
                dependencyStatusItem.text = 'UAV Ready $(warning)';
                dependencyStatusItem.tooltip = tooltip;
            }
            dependencyStatusItem.show();
        }
        catch (error) {
            console.error('[UAV][extension] Error evaluando dependencias:', error);
            dependencyStatusItem.text = 'UAV Ready $(warning)';
            dependencyStatusItem.tooltip = new vscode.MarkdownString('No se pudo evaluar el estado de las dependencias.\n\nHaz clic para abrir el panel de dependencias.');
            dependencyStatusItem.show();
        }
    };
    void updateDependencyStatus();
    context.subscriptions.push(dependenciesProvider.onDidChangeTreeData(() => { void updateDependencyStatus(); }));
    context.subscriptions.push(vscode.commands.registerCommand('uav.dependenciesView.refresh', () => dependenciesProvider.refresh()));
    // ⚙️ Habilita el comando “Actualizar dependencia”
    (0, dependenciesProvider_1.registerDependencyUpdater)(context);
    const syncIaContext = () => {
        const iaStatus = (0, IAAnalisis_1.evaluateIaConfig)();
        void vscode.commands.executeCommand('setContext', 'uav.iaReady', iaStatus.ready);
        if (!iaStatus.ready) {
            console.warn((0, i18n_1.localize)('log.extension.aiDisabled', '[UAV][extension] AI disabled. Missing parameters: {0}', iaStatus.missing.join(', '))); // Localized string
        }
    };
    syncIaContext();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('UnifiedApexValidator')) {
            syncIaContext();
            dependenciesProvider.refresh();
            void updateDependencyStatus();
        }
    }));
    // 📂 Rutas base
    const outputDir = vscode.workspace.getConfiguration('UnifiedApexValidator').get('outputDir') ||
        path.join(context.globalStorageUri.fsPath, 'output');
    const logDir = path.join(context.globalStorageUri.fsPath, '.uav', 'logs');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(outputDir));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(logDir));
    // 📊 Reportes
    const reportsProvider = new uavController_1.FolderViewProvider(outputDir, 'html|pdf', 'Reportes');
    const reportsView = vscode.window.createTreeView('uav.reportsView', { treeDataProvider: reportsProvider });
    context.subscriptions.push(reportsView);
    // 🪵 Logs
    const logsProvider = new uavController_1.FolderViewProvider(logDir, 'log', 'Logs');
    const logsView = vscode.window.createTreeView('uav.logsView', { treeDataProvider: logsProvider });
    context.subscriptions.push(logsView);
    const updateFolderBadges = async () => {
        try {
            const [reportsCount, logsCount] = await Promise.all([
                reportsProvider.getItemCount(),
                logsProvider.getItemCount()
            ]);
            reportsView.badge =
                reportsCount > 0
                    ? {
                        value: reportsCount,
                        tooltip: `${reportsCount} reporte${reportsCount === 1 ? '' : 's'} disponibles`
                    }
                    : undefined;
            logsView.badge =
                logsCount > 0
                    ? {
                        value: logsCount,
                        tooltip: `${logsCount} log${logsCount === 1 ? '' : 's'} disponibles`
                    }
                    : undefined;
        }
        catch (error) {
            console.error('[UAV][extension] Error actualizando badges de vistas:', error);
        }
    };
    void updateFolderBadges();
    context.subscriptions.push(reportsProvider.onDidChangeTreeData(() => { void updateFolderBadges(); }), logsProvider.onDidChangeTreeData(() => { void updateFolderBadges(); }));
    // 🔄 Comandos comunes
    context.subscriptions.push(vscode.commands.registerCommand('uav.reportsView.refresh', () => reportsProvider.refresh()), vscode.commands.registerCommand('uav.logsView.refresh', () => logsProvider.refresh()), vscode.commands.registerCommand('uav.reportsView.clearAll', () => reportsProvider.clearAll()), vscode.commands.registerCommand('uav.logsView.clearAll', () => logsProvider.clearAll()), vscode.commands.registerCommand('uav.reportsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(outputDir))), vscode.commands.registerCommand('uav.logsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(logDir))), vscode.commands.registerCommand('uav.openFile', (uri) => vscode.env.openExternal(uri)));
    (0, utils_1.setExtensionContext)(context);
    console.log((0, i18n_1.localize)('log.extension.contextRegistered', '[UAV][extension] Context registered.')); // Localized string
    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        console.log((0, i18n_1.localize)('log.extension.globalFolderReady', '[UAV][extension] Global storage folder ready.')); // Localized string
    }
    catch (err) {
        console.error((0, i18n_1.localize)('log.extension.globalFolderError', '[UAV][extension] Error creating global folder.'), err); // Localized string
    }
    // 🧪 Validación Apex
    const validateApexCmd = vscode.commands.registerCommand('UnifiedApexValidator.validateApex', async (uri) => {
        try {
            console.log((0, i18n_1.localize)('log.extension.runUav.start', '[UAV][extension] Running runUAV()...')); // Localized string
            await (0, uavController_1.runUAV)(uri);
        }
        catch (error) {
            console.error((0, i18n_1.localize)('log.extension.runUav.error', '[UAV][extension] Error running UAV:'), error); // Localized string
            vscode.window.showErrorMessage((0, i18n_1.localize)('command.validate.error', 'Error running UAV: {0}', error.message)); // Localized string
        }
    });
    // 🧭 Nueva funcionalidad: comparar clases Apex contra una org
    const compareApexClassesCmd = vscode.commands.registerCommand('UnifiedApexValidator.compareApexClasses', async (uri) => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: (0, i18n_1.localize)('progress.compareApex.title', 'Comparing Apex classes against the selected org...'), // Localized string
            cancellable: false,
        }, async () => {
            try {
                await (0, compareController_1.runCompareApexClasses)(uri);
            }
            catch (err) {
                console.error((0, i18n_1.localize)('log.compare.error', '[UAV][extension] Error during comparison:'), err); // Localized string
                vscode.window.showErrorMessage((0, i18n_1.localize)('command.compare.error', '❌ Error comparing classes: {0}', err.message)); // Localized string
            }
        });
    });
    // 🧠 Generar ApexDoc con Einstein (modo chunked)
    const generateApexDocChunkedCmd = vscode.commands.registerCommand('UnifiedApexValidator.generateApexDocChunked', async () => {
        try {
            await (0, generateApexDocChunked_1.generateApexDocChunked)();
        }
        catch (error) {
            console.error((0, i18n_1.localize)('log.apexdoc.error', '[UAV][extension] Error generating ApexDoc:'), error); // Localized string
            vscode.window.showErrorMessage((0, i18n_1.localize)('command.apexdoc.error', '❌ Error generating ApexDoc: {0}', error.message)); // Localized string
        }
    });
    const formatApexAllmanCmd = vscode.commands.registerCommand('UnifiedApexValidator.formatApexAllman', async (uri, uris) => {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        if (!(config.get('enableAllmanFormatter') ?? true)) {
            void vscode.window.showInformationMessage((0, i18n_1.localize)('info.allman.disabled', 'The Allman formatter is disabled in the settings.')); // Localized string
            return;
        }
        await (0, apexAllmanFormatter_1.formatApexAllman)(uri, uris);
    });
    const whereIsUsedCmd = vscode.commands.registerCommand('UnifiedApexValidator.whereIsUsed', async (uri, uris) => {
        const logger = new utils_1.Logger('WhereIsUsed');
        const selectedUris = collectClsUris(uri, uris);
        if (!selectedUris.length) {
            vscode.window.showWarningMessage((0, i18n_1.localize)('warning.whereUsed.selectClass', 'Select at least one Apex (.cls) file to analyze its usage.')); // Localized string
            return;
        }
        let success = false;
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: (0, i18n_1.localize)('progress.whereUsed.title', 'Scanning project for class usage...'), // Localized string
                cancellable: false
            }, async (progress) => {
                progress.report({ message: (0, i18n_1.localize)('progress.whereUsed.analyzing', 'Analyzing references across Apex, Flows, and LWC...') }); // Localized string
                const repoDir = await resolveWhereUsedRepoDir(logger);
                const workerPath = resolveWhereUsedWorkerPath(context);
                const targetPaths = selectedUris.map((item) => item.fsPath);
                const results = await runWhereIsUsedWorker(workerPath, {
                    repoDir,
                    classIdentifiers: targetPaths
                }, logger);
                progress.report({ message: (0, i18n_1.localize)('progress.whereUsed.rendering', 'Rendering visual report...') }); // Localized string
                await (0, whereUsedPanel_1.showWhereUsedPanel)(results);
                success = true;
            });
        }
        catch (err) {
            const reason = err?.message || String(err);
            logger.error((0, i18n_1.localize)('log.whereUsed.error', 'Error generating Where is Used report: {0}', reason)); // Localized string
            vscode.window.showErrorMessage((0, i18n_1.localize)('error.whereUsed.failed', 'Error generating Where is Used: {0}', reason)); // Localized string
        }
        if (success) {
            vscode.window.showInformationMessage((0, i18n_1.localize)('info.whereUsed.generated', 'Where is Used report generated.')); // Localized string
        }
    });
    context.subscriptions.push(validateApexCmd, compareApexClassesCmd, generateApexDocChunkedCmd, formatApexAllmanCmd, whereIsUsedCmd);
    //vscode.window.showInformationMessage('Unified Apex Validator activado.');
}
function collectClsUris(primary, multiSelect) {
    const candidates = multiSelect && multiSelect.length ? multiSelect : (primary ? [primary] : []);
    const unique = new Map();
    for (const uri of candidates) {
        if (!uri || uri.scheme !== 'file') {
            continue;
        }
        const lower = uri.fsPath.toLowerCase();
        if (!lower.endsWith('.cls')) {
            continue;
        }
        unique.set(lower, uri);
    }
    if (!unique.size) {
        const activeUri = vscode.window.activeTextEditor?.document?.uri;
        if (activeUri && activeUri.scheme === 'file') {
            const lower = activeUri.fsPath.toLowerCase();
            if (lower.endsWith('.cls')) {
                unique.set(lower, activeUri);
            }
        }
    }
    return Array.from(unique.values());
}
async function resolveWhereUsedRepoDir(logger) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error((0, i18n_1.localize)('error.whereUsed.noWorkspace', 'No workspace folder detected.')); // Localized string
    }
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    let repoDir = config.get('sfRepositoryDir')?.trim() || '';
    if (!repoDir) {
        repoDir = workspaceFolder.uri.fsPath;
        logger.warn((0, i18n_1.localize)('log.whereUsed.repoDirDefault', 'sfRepositoryDir not configured. Using workspace root.')); // Localized string
    }
    repoDir = path.resolve(repoDir);
    if (!fs.existsSync(repoDir)) {
        throw new Error((0, i18n_1.localize)('error.whereUsed.repoMissing', 'Configured repository path does not exist: {0}', repoDir)); // Localized string
    }
    return repoDir;
}
function resolveWhereUsedWorkerPath(context) {
    const candidates = [
        path.join(__dirname, 'core', 'whereUsedWorkerProcess.js'),
        path.join(context.extensionPath, 'out', 'core', 'whereUsedWorkerProcess.js'),
        path.join(context.extensionPath, 'dist', 'core', 'whereUsedWorkerProcess.js')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error((0, i18n_1.localize)('error.whereUsed.workerMissing', 'Could not find whereUsedWorkerProcess.js component.')); // Localized string
}
function runWhereIsUsedWorker(workerPath, payload, logger) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = (0, child_process_1.fork)(workerPath, [], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        // 💡 Fuerza UTF-8 para stdout/stderr del worker
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        const timeoutMs = 1000 * 60 * 10;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            child.kill();
            reject(new Error((0, i18n_1.localize)('error.whereUsed.timeout', 'Where is Used worker timed out after 10 minutes.'))); // Localized string
        }, timeoutMs);
        const clearAll = () => {
            clearTimeout(timer);
            child.removeAllListeners();
            child.stdout?.removeAllListeners();
            child.stderr?.removeAllListeners();
        };
        child.stdout?.on('data', (data) => {
            const lines = data.toString().split(/\r?\n/);
            for (const raw of lines) {
                const text = raw.trim();
                if (!text)
                    continue;
                const message = text.startsWith('[WhereIsUsedWorker]') ? text : `[WhereIsUsedWorker] ${text}`;
                logger.info(message);
            }
        });
        child.stderr?.on('data', (data) => {
            const lines = data.toString().split(/\r?\n/);
            for (const raw of lines) {
                const text = raw.trim();
                if (!text)
                    continue;
                const message = text.startsWith('[WhereIsUsedWorker]') ? text : `[WhereIsUsedWorker] ${text}`;
                logger.warn(message);
            }
        });
        child.on('message', (message) => {
            if (settled)
                return;
            if (message.type === 'result' && message.result) {
                settled = true;
                clearAll();
                resolve(message.result);
            }
            else {
                settled = true;
                clearAll();
                const fallbackMessage = (0, i18n_1.localize)('error.whereUsed.workerGeneric', 'Where is Used worker reported an error.'); // Localized string
                reject(new Error(message.message || fallbackMessage));
            }
        });
        child.on('error', (err) => {
            if (settled)
                return;
            settled = true;
            clearAll();
            reject(err);
        });
        child.on('exit', (code) => {
            if (settled)
                return;
            settled = true;
            clearAll();
            if (code === 0) {
                resolve([]);
            }
            else {
                const exitCode = code ?? (0, i18n_1.localize)('common.unknown', 'unknown'); // Localized string
                reject(new Error((0, i18n_1.localize)('error.whereUsed.workerExit', 'Where is Used worker exited with code {0}.', exitCode))); // Localized string
            }
        });
        child.send(payload);
    });
}
/**
 * Opción de limpieza al desactivar la extensión.
 */
function deactivate() {
    vscode.window.showInformationMessage((0, i18n_1.localize)('info.extension.deactivated', 'Unified Apex Validator deactivated.')); // Localized string
}
