import * as vscode from 'vscode';
import * as path from 'path';
import { DependenciesProvider, FolderViewProvider, runUAV } from './core/uavController';
import { setExtensionContext } from './core/utils';

/**
 * Punto de entrada de la extensión Unified Apex Validator.
 * Se ejecuta al activar la extensión por comando.
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('[UAV][extension] Unified Apex Validator activado.');
    console.log('[UAV][extension] globalStorageUri:', context.globalStorageUri.fsPath);

    // 🧠 Dentro de activate()
    const dependenciesProvider = new DependenciesProvider(context);
    vscode.window.registerTreeDataProvider('uav.dependenciesView', dependenciesProvider);

    // Agrega también el comando de refresco (opcional)
    context.subscriptions.push(
        vscode.commands.registerCommand('uav.dependenciesView.refresh', () => dependenciesProvider.refresh())
    );

    // 📂 Rutas base
    const outputDir = vscode.workspace.getConfiguration('UnifiedApexValidator').get<string>('outputDir') || path.join(context.globalStorageUri.fsPath, 'output');
    const logDir = path.join(context.globalStorageUri.fsPath, '.uav', 'logs');

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(outputDir));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(logDir));

    // 📊 Reportes
    const reportsProvider = new FolderViewProvider(outputDir, 'html|pdf', 'Reportes');
    vscode.window.registerTreeDataProvider('uav.reportsView', reportsProvider);

    // 🪵 Logs
    const logsProvider = new FolderViewProvider(logDir, 'log', 'Logs');
    vscode.window.registerTreeDataProvider('uav.logsView', logsProvider);

    // 🔄 Comandos comunes
    context.subscriptions.push(
        vscode.commands.registerCommand('uav.reportsView.refresh', () => reportsProvider.refresh()),
        vscode.commands.registerCommand('uav.logsView.refresh', () => logsProvider.refresh()),
        vscode.commands.registerCommand('uav.reportsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(outputDir))),
        vscode.commands.registerCommand('uav.logsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(logDir))),
        vscode.commands.registerCommand('uav.openFile', (uri: vscode.Uri) => vscode.env.openExternal(uri))
    );

    setExtensionContext(context);
    console.log('[UAV][extension] Contexto registrado.');

    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        console.log('[UAV][extension] Carpeta global creada o existente.');
    } catch (err) {
        console.error('[UAV][extension] Error creando carpeta global:', err);
    }

    const disposable = vscode.commands.registerCommand(
        'UnifiedApexValidator.validateApex',
        async (uri: vscode.Uri) => {
            try {
                console.log('[UAV][extension] Ejecutando runUAV()...');
                await runUAV(uri);
            } catch (error: any) {
                console.error('[UAV][extension] Error ejecutando UAV:', error);
                vscode.window.showErrorMessage(`Error ejecutando UAV: ${error.message}`);
            }
        }
    );

    context.subscriptions.push(disposable);
    vscode.window.showInformationMessage('Unified Apex Validator activado.');
}

/**
 * Opción de limpieza al desactivar la extensión.
 */
export function deactivate() {
    vscode.window.showInformationMessage('Unified Apex Validator desactivado.');
}
