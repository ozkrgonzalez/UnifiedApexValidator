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
/**
 * Punto de entrada de la extensión Unified Apex Validator.
 * Se ejecuta al activar la extensión por comando.
 */
async function activate(context) {
    console.log('[UAV][extension] Unified Apex Validator activado.');
    console.log('[UAV][extension] globalStorageUri:', context.globalStorageUri.fsPath);
    // 🧠 Dependencias
    const dependenciesProvider = new dependenciesProvider_1.DependenciesProvider(context);
    vscode.window.registerTreeDataProvider('uav.dependenciesView', dependenciesProvider);
    context.subscriptions.push(vscode.commands.registerCommand('uav.dependenciesView.refresh', () => dependenciesProvider.refresh()));
    // ⚙️ Habilita el comando “Actualizar dependencia”
    (0, dependenciesProvider_1.registerDependencyUpdater)(context);
    const syncIaContext = () => {
        const iaStatus = (0, IAAnalisis_1.evaluateIaConfig)();
        void vscode.commands.executeCommand('setContext', 'uav.iaReady', iaStatus.ready);
        if (!iaStatus.ready) {
            console.warn(`[UAV][extension] IA deshabilitada. Faltan parametros: ${iaStatus.missing.join(', ')}`);
        }
    };
    syncIaContext();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('UnifiedApexValidator')) {
            syncIaContext();
            dependenciesProvider.refresh();
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
    vscode.window.registerTreeDataProvider('uav.reportsView', reportsProvider);
    // 🪵 Logs
    const logsProvider = new uavController_1.FolderViewProvider(logDir, 'log', 'Logs');
    vscode.window.registerTreeDataProvider('uav.logsView', logsProvider);
    // 🔄 Comandos comunes
    context.subscriptions.push(vscode.commands.registerCommand('uav.reportsView.refresh', () => reportsProvider.refresh()), vscode.commands.registerCommand('uav.logsView.refresh', () => logsProvider.refresh()), vscode.commands.registerCommand('uav.reportsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(outputDir))), vscode.commands.registerCommand('uav.logsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(logDir))), vscode.commands.registerCommand('uav.openFile', (uri) => vscode.env.openExternal(uri)));
    (0, utils_1.setExtensionContext)(context);
    console.log('[UAV][extension] Contexto registrado.');
    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        console.log('[UAV][extension] Carpeta global creada o existente.');
    }
    catch (err) {
        console.error('[UAV][extension] Error creando carpeta global:', err);
    }
    // 🧪 Validación Apex
    const validateApexCmd = vscode.commands.registerCommand('UnifiedApexValidator.validateApex', async (uri) => {
        try {
            console.log('[UAV][extension] Ejecutando runUAV()...');
            await (0, uavController_1.runUAV)(uri);
        }
        catch (error) {
            console.error('[UAV][extension] Error ejecutando UAV:', error);
            vscode.window.showErrorMessage(`Error ejecutando UAV: ${error.message}`);
        }
    });
    // 🧭 Nueva funcionalidad: comparar clases Apex contra una org
    const compareApexClassesCmd = vscode.commands.registerCommand('UnifiedApexValidator.compareApexClasses', async (uri) => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Comparando clases Apex contra la organización seleccionada...',
            cancellable: false,
        }, async () => {
            try {
                await (0, compareController_1.runCompareApexClasses)(uri);
            }
            catch (err) {
                console.error('[UAV][extension] Error en comparación:', err);
                vscode.window.showErrorMessage(`❌ Error al comparar clases: ${err.message}`);
            }
        });
    });
    // 🧠 Generar ApexDoc con Einstein (modo chunked)
    const generateApexDocChunkedCmd = vscode.commands.registerCommand('UnifiedApexValidator.generateApexDocChunked', async () => {
        try {
            await (0, generateApexDocChunked_1.generateApexDocChunked)();
        }
        catch (error) {
            console.error('[UAV][extension] Error en generación de ApexDoc:', error);
            vscode.window.showErrorMessage(`❌ Error generando ApexDoc: ${error.message}`);
        }
    });
    const formatApexAllmanCmd = vscode.commands.registerCommand('UnifiedApexValidator.formatApexAllman', async (uri, uris) => {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        if (!(config.get('enableAllmanFormatter') ?? true)) {
            void vscode.window.showInformationMessage('El formateador Allman está deshabilitado en la configuración.');
            return;
        }
        await (0, apexAllmanFormatter_1.formatApexAllman)(uri, uris);
    });
    const whereIsUsedCmd = vscode.commands.registerCommand('UnifiedApexValidator.whereIsUsed', async (uri, uris) => {
        const logger = new utils_1.Logger('WhereIsUsed');
        const selectedUris = collectClsUris(uri, uris);
        if (!selectedUris.length) {
            vscode.window.showWarningMessage('Selecciona al menos una clase Apex (.cls) para analizar su uso.');
            return;
        }
        let success = false;
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Scanning project for class usage...',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Analizando referencias en Apex, Flows y LWC...' });
                const repoDir = await resolveWhereUsedRepoDir(logger);
                const workerPath = resolveWhereUsedWorkerPath(context);
                const targetPaths = selectedUris.map((item) => item.fsPath);
                const results = await runWhereIsUsedWorker(workerPath, {
                    repoDir,
                    classIdentifiers: targetPaths
                }, logger);
                progress.report({ message: 'Generando reporte visual...' });
                await (0, whereUsedPanel_1.showWhereUsedPanel)(results);
                success = true;
            });
        }
        catch (err) {
            const reason = err?.message || String(err);
            logger.error(`Error generando Where is Used: ${reason}`);
            vscode.window.showErrorMessage(`Error generando Where is Used: ${reason}`);
        }
        if (success) {
            vscode.window.showInformationMessage('Where is Used report generated.');
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
        throw new Error('No se detect� un workspace abierto.');
    }
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    let repoDir = config.get('sfRepositoryDir')?.trim() || '';
    if (!repoDir) {
        repoDir = workspaceFolder.uri.fsPath;
        logger.warn('sfRepositoryDir no configurado. Se usara la raiz del workspace.');
    }
    repoDir = path.resolve(repoDir);
    if (!fs.existsSync(repoDir)) {
        throw new Error('La ruta configurada no existe: ' + repoDir);
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
    throw new Error('No se encontro el componente whereUsedWorkerProcess.js.');
}
function runWhereIsUsedWorker(workerPath, payload, logger) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = (0, child_process_1.fork)(workerPath, [], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        const timeoutMs = 1000 * 60 * 10;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            child.kill();
            reject(new Error('Where is Used worker timeout tras 10 minutos.'));
        }, timeoutMs);
        const clearAll = () => {
            clearTimeout(timer);
            child.removeAllListeners();
            child.stdout?.removeAllListeners();
            child.stderr?.removeAllListeners();
        };
        child.stdout?.on('data', (data) => {
            const text = data.toString().trim();
            if (text) {
                logger.info(`[WhereIsUsedWorker] ${text}`);
            }
        });
        child.stderr?.on('data', (data) => {
            const text = data.toString().trim();
            if (text) {
                logger.warn(`[WhereIsUsedWorker] ${text}`);
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
                reject(new Error(message.message || 'Where is Used worker reporto un error.'));
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
                reject(new Error(`Where is Used worker finalizo con codigo ${code ?? 'desconocido'}.`));
            }
        });
        child.send(payload);
    });
}
/**
 * Opción de limpieza al desactivar la extensión.
 */
function deactivate() {
    vscode.window.showInformationMessage('Unified Apex Validator desactivado.');
}
