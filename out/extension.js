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
const dependenciesProvider_1 = require("./providers/dependenciesProvider");
const uavController_1 = require("./core/uavController");
const compareController_1 = require("./core/compareController");
const utils_1 = require("./core/utils");
const generateApexDocChunked_1 = require("./core/generateApexDocChunked");
const IAAnalisis_1 = require("./core/IAAnalisis");
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
    context.subscriptions.push(validateApexCmd, compareApexClassesCmd, generateApexDocChunkedCmd);
    vscode.window.showInformationMessage('Unified Apex Validator activado.');
}
/**
 * Opción de limpieza al desactivar la extensión.
 */
function deactivate() {
    vscode.window.showInformationMessage('Unified Apex Validator desactivado.');
}
