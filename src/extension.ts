import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { fork } from 'child_process';
import { DependenciesProvider, registerDependencyUpdater } from './providers/dependenciesProvider';
import { FolderViewProvider, runUAV } from './core/uavController';
import { runCompareApexClasses } from './core/compareController';
import { Logger, setExtensionContext } from './core/utils';
import { generateApexDocChunked } from './core/generateApexDocChunked';
import { evaluateIaConfig } from './core/IAAnalisis';
import { formatApexAllman } from './core/apexAllmanFormatter';
import { showWhereUsedPanel } from './core/whereUsedPanel';
import { WhereUsedEntry } from './core/whereUsedCore';
import { localize } from './i18n';


/**
 * Punto de entrada de la extensiÃ³n Unified Apex Validator.
 * Se ejecuta al activar la extensiÃ³n por comando.
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log(localize('log.extension.activated', '[UAV][extension] Unified Apex Validator activated.')); // Localized string
    console.log(localize('log.extension.storagePath', '[UAV][extension] globalStorageUri: {0}', context.globalStorageUri.fsPath)); // Localized string

    // ðŸ§  Dependencias
    const dependenciesProvider = new DependenciesProvider(context);
    vscode.window.registerTreeDataProvider('uav.dependenciesView', dependenciesProvider);

    const dependencyStatusItem = vscode.window.createStatusBarItem(
        'uav.dependencyStatus',
        vscode.StatusBarAlignment.Left,
        100
    );
    dependencyStatusItem.name = 'Unified Apex Validator';
    dependencyStatusItem.command = 'uav.dependenciesView.focus';
    context.subscriptions.push(dependencyStatusItem);

    const walkthroughId = `${context.extension.id}#uav.gettingStarted`;
    console.log(`[UAV][extension] Walkthrough Id: ${walkthroughId}`);

    const openGettingStarted = async () =>
    {
        console.log(`[UAV][extension] Opening walkthrough: ${walkthroughId}`);
        await vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, true);
    };

    const updateDependencyStatus = async () =>
    {
        try
        {
            const summary = await dependenciesProvider.getDependencySummary();
            const issues = summary.records.filter((record) => record.status.state !== 'ok');

            if (summary.state === 'ok')
            {
                dependencyStatusItem.text = 'UAV Ready $(pass)';
                dependencyStatusItem.tooltip = new vscode.MarkdownString(
                    'Todas las dependencias estÃ¡n actualizadas.\n\nHaz clic para abrir el panel de dependencias.'
                );
            }
            else
            {
                const lines = issues.length
                    ? issues.map((record) =>
                    {
                        const { dep, status } = record;

                        if (record.info?.type === 'ia' && !record.info.ready && record.info.missing.length)
                        {
                            return `- ${dep.label}: Configura ${record.info.missing.join(', ')}`;
                        }

                        const stateLabel = status.state === 'missing' ? 'No instalado' : 'Desactualizado';
                        const versionInfo = [
                            status.detectedVersion ? `Detectado ${status.detectedVersion}` : null,
                            dep.minVersion ? `MÃ­nimo ${dep.minVersion}` : null
                        ]
                            .filter(Boolean)
                            .join(' | ');

                        return `- ${dep.label}: ${stateLabel}${versionInfo ? ` (${versionInfo})` : ''}`;
                    })
                    : ['- Sin detalles disponibles'];

                const tooltip = new vscode.MarkdownString(
                    ['Dependencias pendientes:', ...lines, '', 'Haz clic para revisar el panel.'].join('\n')
                );
                dependencyStatusItem.text = 'UAV Ready $(warning)';
                dependencyStatusItem.tooltip = tooltip;
            }

            dependencyStatusItem.show();
        }
        catch (error)
        {
            console.error('[UAV][extension] Error evaluando dependencias:', error);
            dependencyStatusItem.text = 'UAV Ready $(warning)';
            dependencyStatusItem.tooltip = new vscode.MarkdownString(
                'No se pudo evaluar el estado de las dependencias.\n\nHaz clic para abrir el panel de dependencias.'
            );
            dependencyStatusItem.show();
        }
    };

    void updateDependencyStatus();
    context.subscriptions.push(dependenciesProvider.onDidChangeTreeData(() => { void updateDependencyStatus(); }));
    context.subscriptions.push(
        vscode.commands.registerCommand('uav.dependenciesView.refresh', () => dependenciesProvider.refresh())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('uav.showGettingStarted', async () => { await openGettingStarted(); })
    );

    // âš™ï¸ Habilita el comando â€œActualizar dependenciaâ€
    registerDependencyUpdater(context);

    const syncIaContext = () =>
    {
        const iaStatus = evaluateIaConfig();
        void vscode.commands.executeCommand('setContext', 'uav.iaReady', iaStatus.ready);
        if (!iaStatus.ready)
        {
            console.warn(localize('log.extension.aiDisabled', '[UAV][extension] AI disabled. Missing parameters: {0}', iaStatus.missing.join(', '))); // Localized string
        }
    };

    syncIaContext();
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) =>
        {
            if (event.affectsConfiguration('UnifiedApexValidator'))
            {
                syncIaContext();
                dependenciesProvider.refresh();
                void updateDependencyStatus();
            }
        })
    );

    // ðŸ“‚ Rutas base
    const outputDir = vscode.workspace.getConfiguration('UnifiedApexValidator').get<string>('outputDir') || path.join(context.globalStorageUri.fsPath, 'output');
    const logDir = path.join(context.globalStorageUri.fsPath, '.uav', 'logs');

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(outputDir));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(logDir));

    // ðŸ“Š Reportes
    const reportsProvider = new FolderViewProvider(outputDir, 'html|pdf', localize('ui.reportsView.label', 'Reports')); // Localized string
    const reportsView = vscode.window.createTreeView('uav.reportsView', { treeDataProvider: reportsProvider });
    context.subscriptions.push(reportsView);

    // ðŸªµ Logs
    const logsProvider = new FolderViewProvider(logDir, 'log', localize('ui.logsView.label', 'Logs')); // Localized string
    const logsView = vscode.window.createTreeView('uav.logsView', { treeDataProvider: logsProvider });
    context.subscriptions.push(logsView);

    const updateFolderBadges = async () =>
    {
        try
        {
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
            reportsView.description = reportsCount > 0 ? `${reportsCount}` : undefined;
            reportsView.message =
                reportsCount > 0
                    ? localize(
                          'ui.reportsView.message',
                          '{0} available',
                          `${reportsCount} reporte${reportsCount === 1 ? '' : 's'}`
                      )
                    : undefined;

            logsView.badge =
                logsCount > 0
                    ? {
                          value: logsCount,
                          tooltip: `${logsCount} log${logsCount === 1 ? '' : 's'} disponibles`
                      }
                    : undefined;
            logsView.description = logsCount > 0 ? `${logsCount}` : undefined;
            logsView.message =
                logsCount > 0
                    ? localize(
                          'ui.logsView.message',
                          '{0} available',
                          `${logsCount} log${logsCount === 1 ? '' : 's'}`
                      )
                    : undefined;
        }
        catch (error)
        {
            console.error('[UAV][extension] Error actualizando badges de vistas:', error);
        }
    };

    void updateFolderBadges();
    context.subscriptions.push(reportsProvider.onDidChangeTreeData(() => { void updateFolderBadges(); }), logsProvider.onDidChangeTreeData(() => { void updateFolderBadges(); })
    );

    // ðŸ”„ Comandos comunes
    context.subscriptions.push(
        vscode.commands.registerCommand('uav.reportsView.refresh', () => reportsProvider.refresh()),
        vscode.commands.registerCommand('uav.logsView.refresh', () => logsProvider.refresh()),
        vscode.commands.registerCommand('uav.reportsView.clearAll', () => reportsProvider.clearAll()),
        vscode.commands.registerCommand('uav.logsView.clearAll', () => logsProvider.clearAll()),
        vscode.commands.registerCommand('uav.reportsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(outputDir))),
        vscode.commands.registerCommand('uav.logsView.openFolder', () => vscode.env.openExternal(vscode.Uri.file(logDir))),
        vscode.commands.registerCommand('uav.openFile', (uri: vscode.Uri) => vscode.env.openExternal(uri))
    );

    setExtensionContext(context);
    console.log(localize('log.extension.contextRegistered', '[UAV][extension] Context registered.')); // Localized string

    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        console.log(localize('log.extension.globalFolderReady', '[UAV][extension] Global storage folder ready.')); // Localized string
    } catch (err) {
        console.error(localize('log.extension.globalFolderError', '[UAV][extension] Error creating global folder.'), err); // Localized string
    }

    const walkthroughCompleteKey = 'uav.walkthrough.completed';
    const hasCompletedWalkthrough = context.globalState.get<boolean>(walkthroughCompleteKey, false);
    if (!hasCompletedWalkthrough)
    {
        await openGettingStarted();
        await context.globalState.update(walkthroughCompleteKey, true);
    }

    // ðŸ§ª ValidaciÃ³n Apex
    const validateApexCmd = vscode.commands.registerCommand(
        'UnifiedApexValidator.validateApex',
        async (uri: vscode.Uri) => {
            try {
                console.log(localize('log.extension.runUav.start', '[UAV][extension] Running runUAV()...')); // Localized string
                await runUAV(uri);
            } catch (error: any) {
                console.error(localize('log.extension.runUav.error', '[UAV][extension] Error running UAV:'), error); // Localized string
                vscode.window.showErrorMessage(localize('command.validate.error', 'Error running UAV: {0}', error.message)); // Localized string
            }
        }
    );

    // ðŸ§­ Nueva funcionalidad: comparar clases Apex contra una org
    const compareApexClassesCmd = vscode.commands.registerCommand(
        'UnifiedApexValidator.compareApexClasses',
        async (uri?: vscode.Uri) => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize('progress.compareApex.title', 'Comparing Apex classes against the selected org...'), // Localized string
                    cancellable: false,
                },
                async () => {
                    try {
                        await runCompareApexClasses(uri);
                    } catch (err: any) {
                        console.error(localize('log.compare.error', '[UAV][extension] Error during comparison:'), err); // Localized string
                        vscode.window.showErrorMessage(localize('command.compare.error', 'âŒ Error comparing classes: {0}', err.message)); // Localized string
                    }
                }
            );
        }
    );

    // ðŸ§  Generar ApexDoc con Einstein (modo chunked)
    const generateApexDocChunkedCmd = vscode.commands.registerCommand(
        'UnifiedApexValidator.generateApexDocChunked',
        async () =>
        {
            try
            {
                await generateApexDocChunked();
            }
            catch (error: any)
            {
                console.error(localize('log.apexdoc.error', '[UAV][extension] Error generating ApexDoc:'), error); // Localized string
                vscode.window.showErrorMessage(localize('command.apexdoc.error', 'âŒ Error generating ApexDoc: {0}', error.message)); // Localized string
            }
        }
    );

    const formatApexAllmanCmd = vscode.commands.registerCommand(
        'UnifiedApexValidator.formatApexAllman',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        {
            const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
            if (!(config.get<boolean>('enableAllmanFormatter') ?? true))
            {
                void vscode.window.showInformationMessage(localize('info.allman.disabled', 'The Allman formatter is disabled in the settings.')); // Localized string
                return;
            }
            await formatApexAllman(uri, uris);
        }
    );

    const whereIsUsedCmd = vscode.commands.registerCommand(
        'UnifiedApexValidator.whereIsUsed',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        {
            const logger = new Logger('WhereIsUsed');
            const selectedUris = collectClsUris(uri, uris);

            if (!selectedUris.length)
            {
                vscode.window.showWarningMessage(localize('warning.whereUsed.selectClass', 'Select at least one Apex (.cls) file to analyze its usage.')); // Localized string
                return;
            }

            let success = false;

            try
            {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: localize('progress.whereUsed.title', 'Scanning project for class usage...'), // Localized string
                        cancellable: false
                    },
                    async (progress) =>
                    {
                        progress.report({ message: localize('progress.whereUsed.analyzing', 'Analyzing references across Apex, Flows, and LWC...') }); // Localized string
                        const repoDir = await resolveWhereUsedRepoDir(logger);
                        const workerPath = resolveWhereUsedWorkerPath(context);
                        const targetPaths = selectedUris.map((item) => item.fsPath);
                        const results = await runWhereIsUsedWorker(workerPath, {
                            repoDir,
                            classIdentifiers: targetPaths
                        }, logger);
                        progress.report({ message: localize('progress.whereUsed.rendering', 'Rendering visual report...') }); // Localized string
                        await showWhereUsedPanel(results);
                        success = true;
                    }
                );
            }
            catch (err: any)
            {
                const reason = err?.message || String(err);
                logger.error(localize('log.whereUsed.error', 'Error generating Where is Used report: {0}', reason)); // Localized string
                vscode.window.showErrorMessage(localize('error.whereUsed.failed', 'Error generating Where is Used: {0}', reason)); // Localized string
            }

            if (success)
            {
                vscode.window.showInformationMessage(localize('info.whereUsed.generated', 'Where is Used report generated.')); // Localized string
            }
        }
    );

    context.subscriptions.push(
        validateApexCmd,
        compareApexClassesCmd,
        generateApexDocChunkedCmd,
        formatApexAllmanCmd,
        whereIsUsedCmd
    );
    //vscode.window.showInformationMessage('Unified Apex Validator activado.');
}


function collectClsUris(primary?: vscode.Uri, multiSelect?: vscode.Uri[]): vscode.Uri[]
{
    const candidates = multiSelect && multiSelect.length ? multiSelect : (primary ? [primary] : []);
    const unique = new Map<string, vscode.Uri>();

    for (const uri of candidates)
    {
        if (!uri || uri.scheme !== 'file')
        {
            continue;
        }

        const lower = uri.fsPath.toLowerCase();
        if (!lower.endsWith('.cls'))
        {
            continue;
        }

        unique.set(lower, uri);
    }

    if (!unique.size)
    {
        const activeUri = vscode.window.activeTextEditor?.document?.uri;
        if (activeUri && activeUri.scheme === 'file')
        {
            const lower = activeUri.fsPath.toLowerCase();
            if (lower.endsWith('.cls'))
            {
                unique.set(lower, activeUri);
            }
        }
    }

    return Array.from(unique.values());
}

async function resolveWhereUsedRepoDir(logger: Logger): Promise<string>
{
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder)
    {
        throw new Error(localize('error.whereUsed.noWorkspace', 'No workspace folder detected.')); // Localized string
    }

    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    let repoDir = config.get<string>('sfRepositoryDir')?.trim() || '';

    if (!repoDir)
    {
        repoDir = workspaceFolder.uri.fsPath;
        logger.warn(localize('log.whereUsed.repoDirDefault', 'sfRepositoryDir not configured. Using workspace root.')); // Localized string
    }

    repoDir = path.resolve(repoDir);

    if (!fs.existsSync(repoDir))
    {
        throw new Error(localize('error.whereUsed.repoMissing', 'Configured repository path does not exist: {0}', repoDir)); // Localized string
    }

    return repoDir;
}

function resolveWhereUsedWorkerPath(context: vscode.ExtensionContext): string
{
    const candidates = [
        path.join(__dirname, 'core', 'whereUsedWorkerProcess.js'),
        path.join(context.extensionPath, 'out', 'core', 'whereUsedWorkerProcess.js'),
        path.join(context.extensionPath, 'dist', 'core', 'whereUsedWorkerProcess.js')
    ];

    for (const candidate of candidates)
    {
        if (fs.existsSync(candidate))
        {
            return candidate;
        }
    }

    throw new Error(localize('error.whereUsed.workerMissing', 'Could not find whereUsedWorkerProcess.js component.')); // Localized string
}

interface WhereIsUsedWorkerRequest
{
    repoDir: string;
    classIdentifiers: string[];
}

interface WhereIsUsedWorkerResponse
{
    type: 'result' | 'error';
    result?: WhereUsedEntry[];
    message?: string;
    stack?: string;
}

function runWhereIsUsedWorker(
    workerPath: string,
    payload: WhereIsUsedWorkerRequest,
    logger: Logger
): Promise<WhereUsedEntry[]>
{
    return new Promise((resolve, reject) =>
    {
        let settled = false;

        const child = fork(workerPath, [], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        // ðŸ’¡ Fuerza UTF-8 para stdout/stderr del worker
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');

        const timeoutMs = 1000 * 60 * 10;
        const timer = setTimeout(() =>
        {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error(localize('error.whereUsed.timeout', 'Where is Used worker timed out after 10 minutes.'))); // Localized string
        }, timeoutMs);

        const clearAll = () =>
        {
            clearTimeout(timer);
            child.removeAllListeners();
            child.stdout?.removeAllListeners();
            child.stderr?.removeAllListeners();
        };

        child.stdout?.on('data', (data: Buffer) =>
        {
            const lines = data.toString().split(/\r?\n/);
            for (const raw of lines)
            {
                const text = raw.trim();
                if (!text) continue;
                const message = text.startsWith('[WhereIsUsedWorker]') ? text : `[WhereIsUsedWorker] ${text}`;
                logger.info(message);
            }
        });

        child.stderr?.on('data', (data: Buffer) =>
        {
            const lines = data.toString().split(/\r?\n/);
            for (const raw of lines)
            {
                const text = raw.trim();
                if (!text) continue;
                const message = text.startsWith('[WhereIsUsedWorker]') ? text : `[WhereIsUsedWorker] ${text}`;
                logger.warn(message);
            }
        });

        child.on('message', (message: WhereIsUsedWorkerResponse) =>
        {
            if (settled) return;

            if (message.type === 'result' && message.result)
            {
                settled = true;
                clearAll();
                resolve(message.result);
            }
            else
            {
                settled = true;
                clearAll();
                const fallbackMessage = localize('error.whereUsed.workerGeneric', 'Where is Used worker reported an error.'); // Localized string
                reject(new Error(message.message || fallbackMessage));
            }
        });

        child.on('error', (err) =>
        {
            if (settled) return;
            settled = true;
            clearAll();
            reject(err);
        });

        child.on('exit', (code) =>
        {
            if (settled) return;
            settled = true;
            clearAll();

            if (code === 0)
            {
                resolve([]);
            }
            else
            {
                const exitCode = code ?? localize('common.unknown', 'unknown'); // Localized string
                reject(new Error(localize('error.whereUsed.workerExit', 'Where is Used worker exited with code {0}.', exitCode))); // Localized string
            }
        });

        child.send(payload);
    });
}

/**
 * OpciÃ³n de limpieza al desactivar la extensiÃ³n.
 */
export function deactivate() {
    vscode.window.showInformationMessage(localize('info.extension.deactivated', 'Unified Apex Validator deactivated.')); // Localized string
}


