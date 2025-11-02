import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import { Logger, parseApexClassesFromPackage, getStorageRoot, cleanUpFiles, getGlobalChannel, ensureOrgAliasConnected, getDefaultConnectedOrg } from './utils';
import { runValidator } from './validator';
import { TestSuite } from './testSuite';
import { IAAnalisis, evaluateIaConfig } from './IAAnalisis';
import { generateReport } from './reportGenerator';
import { showReport } from './reportViewer';
import { localize } from '../i18n';

export async function runUAV(uri?: vscode.Uri)
{
    process.on('unhandledRejection', (reason: any) =>
    {
    if (String(reason).includes('CreateEmbeddingSupplier'))
        {
            return;
        }
        console.error('[UAVController] Unhandled Rejection:', reason);
    });

    try
    {
        const channel = getGlobalChannel();
        if (channel) channel.clear();

        const storageRoot = getStorageRoot();
        const logDir = path.join(storageRoot, 'logs');
        const tempDir = path.join(storageRoot, 'temp');

        await fs.ensureDir(logDir);
        await fs.ensureDir(tempDir);
        await fs.emptyDir(tempDir);

        const mainLog = path.join(logDir, 'Validator.log');
        if (await fs.pathExists(mainLog)) await fs.writeFile(mainLog, '');

        console.log(localize('log.uavController.preCleanupDone', '[UAV][Controller] Pre-run cleanup completed at {0}', storageRoot)); // Localized string
    }
    catch (err)
    {
        console.warn(localize('log.uavController.preCleanupFailed', '[UAV][Controller] ⚠️ Could not clean logs/temp before execution.'), err); // Localized string
    }

    // 🚀 Ahora sí, crear el logger principal
    const logger = new Logger('UAVController', true);
    logger.info(localize('log.uavController.start', '🚀 Starting Unified Apex Validator run...')); // Localized string

    let tempPackagePath: string | undefined;
    let sourceUri: vscode.Uri | undefined;
    let packageUri: vscode.Uri | undefined;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: localize('progress.uavController.title', 'Unified Apex Validator'), // Localized string
            cancellable: true
        },
        async (progress) =>
            {
            try
            {
                sourceUri = uri && uri.scheme === 'file' ? uri : vscode.window.activeTextEditor?.document?.uri;
                if (!sourceUri || sourceUri.scheme !== 'file')
                {
                    throw new Error(localize('error.uavController.selectSource', 'Select a package.xml or Apex (.cls) file within the workspace.')); // Localized string
                }

                const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];

                if (!workspaceFolder) throw new Error(localize('error.uavController.noWorkspace', 'No workspace folder detected.')); // Localized string

                const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
                let repoDir = config.get<string>('sfRepositoryDir')?.trim() || '';

                if (!repoDir)
                {
                    repoDir = workspaceFolder.uri.fsPath;
                    logger.warn(localize('log.uavController.repoDirFallbackWorkspace', '⚠️ sfRepositoryDir not configured. Using workspace root.')); // Localized string
                }

                packageUri = sourceUri;
                const ext = path.extname(sourceUri.fsPath).toLowerCase();
                if (ext === '.cls')
                {
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
                    logger.info(localize('log.uavController.tempPackageCreated', 'Generated temporary package.xml for class {0}: {1}', className, tempPackagePath)); // Localized string
                }

                // Validar estructura minima del repo
                if (!fs.existsSync(path.join(repoDir, 'sfdx-project.json')))
                {
                    logger.warn(localize('log.uavController.noSfdxProject', '⚠️ sfdx-project.json not found. Falling back to workspace root for repoDir.')); // Localized string
                    repoDir = workspaceFolder.uri.fsPath;
                }

                const pkgPath = packageUri!.fsPath;
                const storageRoot = getStorageRoot();
                const tempDir = path.join(storageRoot, 'temp');
                const logDir = path.join(storageRoot, 'logs');
                await fs.ensureDir(tempDir);
                await fs.ensureDir(logDir);

                const content = await fs.readFile(pkgPath, 'utf8');

                if (!content.includes('<name>ApexClass</name>'))
                {
                    const msg = localize('error.uavController.noApexClasses', '❌ No Apex classes were found in this XML.'); // Localized string
                    logger.error(msg);
                    throw new Error(msg);
                }

                // Paso 1: Parsear package.xml
                progress.report({ message: localize('progress.uavController.analyzingPackage', 'Analyzing package.xml...') }); // Localized string
                logger.info(localize('log.uavController.analyzingPackage', '📦 Analyzing package.xml...')); // Localized string
                if (!repoDir)
                {
                    repoDir = path.join(workspaceFolder.uri.fsPath, 'force-app', 'main', 'default', 'classes');
                    logger.warn(localize('log.uavController.repoDirFallbackDefault', '⚠️ sfRepositoryDir not configured. Using default path: {0}', repoDir)); // Localized string
                }
                else
                {
                    logger.info(localize('log.uavController.repoDirConfigured', '📁 Repository configured: {0}', repoDir)); // Localized string
                }

                const defaultOrg = await getDefaultConnectedOrg(logger);
                if (!defaultOrg)
                {
                    const message = localize('error.uavController.noDefaultOrg', 'No default org connected in Salesforce CLI. Run "sf org login web" and try again.'); // Localized string
                    logger.error(message);
                    vscode.window.showErrorMessage(message);
                    return;
                }

                const targetOrg = defaultOrg.alias || defaultOrg.username;
                const aliasReady = await ensureOrgAliasConnected(targetOrg, logger);
                if (!aliasReady)
                {
                    logger.warn(localize('log.uavController.orgNotConnected', '⚠️ Execution cancelled: org "{0}" is not connected.', targetOrg)); // Localized string
                    return;
                }

                const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(pkgPath, repoDir);

                // 2️⃣ Validación estática (Code Analyzer + PMD)
                logger.info(localize('log.uavController.runValidator', '🧠 Invoking runValidator...')); // Localized string
                const { codeAnalyzerResults, pmdResults } = await runValidator(packageUri!, progress, repoDir);

                // 3️⃣ Ejecución de pruebas Apex
                progress.report({ message: localize('progress.uavController.runningTests', 'Running Apex tests...') }); // Localized string

                logger.info(localize('log.uavController.runningTests', '🧪 Executing Apex tests...')); // Localized string
                const testSuite = new TestSuite(workspaceFolder.uri.fsPath);
                const testResults = await testSuite.runTestSuite(testClasses, nonTestClasses);

                // 4) (Opcional) Analisis IA
                const skipIASetting = config.get<boolean>('skipIAAnalysis') ?? false;
                const iaStatus = evaluateIaConfig();
                const skipIA = skipIASetting || !iaStatus.ready;
                let iaResults: any[] = [];

                if (!skipIA)
                {
                    const sfGptPrompt = config.get<string>('iaPromptTemplate') ?? 'Analiza la clase {class_name}:\n{truncated_body}';
                    const sfGptMaxChar = config.get<number>('maxIAClassChars') ?? 25000;

                    progress.report({ message: localize('progress.uavController.runningAi', 'Running AI analysis...') }); // Localized string
                    logger.info(localize('log.uavController.runningAi', 'Running AI analysis with Einstein GPT...')); // Localized string
                    const ia = new IAAnalisis();

                    for (const cls of nonTestClasses)
                    {
                        const clsPath = path.join(repoDir, 'force-app', 'main', 'default', 'classes', `${cls}.cls`);

                        if (!fs.existsSync(clsPath))
                        {
                            logger.warn(localize('log.uavController.classMissing', 'Class not found: {0}', clsPath)); // Localized string
                            continue;
                        }

                        try
                        {
                            logger.info(localize('log.uavController.sendingClassToAi', 'Sending class to AI: {0}', cls)); // Localized string
                            const content = await fs.readFile(clsPath, 'utf8');

                            const truncated = content.length > sfGptMaxChar ? content.slice(0, sfGptMaxChar) : content;

                            if (content.length > sfGptMaxChar)
                            {
                                logger.warn(localize('log.uavController.classTruncated', 'Class {0} truncated to {1} characters for analysis.', cls, sfGptMaxChar)); // Localized string
                            }

                            const prompt = sfGptPrompt
                                .replace('{class_name}', cls)
                                .replace('{truncated_body}', truncated);

                            const analysis = await ia.generate(prompt);

                            const md = new MarkdownIt({
                                html: true,
                                linkify: true,
                                typographer: true
                            });

                            const resumenHtml = md.render(analysis.resumen || '');
                            iaResults.push({ Clase: cls, resumenHtml });
                        }
                        catch (err)
                        {
                            const message = err instanceof Error ? err.message : String(err);
                            logger.warn(localize('log.uavController.aiFailed', 'AI analysis failed for {0}: {1}', cls, message)); // Localized string
                        }
                    }

                    logger.info(localize('log.uavController.aiCompleted', 'AI analysis finished - classes processed: {0}', iaResults.length)); // Localized string
                }
                else if (skipIASetting)
                {
                    logger.info(localize('log.uavController.aiSkippedSetting', 'AI analysis skipped by configuration (skipIAAnalysis=true).')); // Localized string
                }
                else
                {
                    logger.info(localize('log.uavController.aiDisabledParams', 'AI analysis disabled - missing parameters: {0}', iaStatus.missing.join(', '))); // Localized string
                }

                // 5️⃣ Generar reportes
                progress.report({ message: localize('progress.uavController.generatingReports', 'Generating reports...') }); // Localized string
                logger.info(localize('log.uavController.generatingReports', '📊 Generating reports...')); // Localized string
                const outputDir = config.get<string>('outputDir')?.trim() || path.join(storageRoot, 'output');
                await fs.ensureDir(outputDir);
                await generateReport(outputDir,
                {
                    codeAnalyzerResults,
                    pmdResults,
                    testResults,
                    iaResults
                });

                logger.info(localize('log.uavController.runCompleted', '✅ UAV completed. Report saved at: {0}', outputDir)); // Localized string
                vscode.window.showInformationMessage(localize('info.uavController.runCompleted', '✅ UAV completed. Report generated in {0}.', outputDir)); // Localized string

                // 👀 Abrir el reporte en vista integrada dentro de VS Code
                const htmlReport = path.join(outputDir, 'reporte_validaciones.html');
                if (fs.existsSync(htmlReport))
                {
                    showReport(htmlReport, localize('ui.reportViewer.validationTitle', 'Apex Validation Report')); // Localized string
                }
                else
                {
                    logger.warn(localize('log.uavController.reportMissing', '⚠️ HTML report not found at {0}', htmlReport)); // Localized string
                }

                // 🧹 Limpieza final si corresponde
                const keepLogFiles = config.get<boolean>('keepLogFiles') ?? false;
                if (!keepLogFiles)
                {
                    await cleanUpFiles([tempDir, logDir], logger);
                    logger.info(localize('log.uavController.cleanupDone', '🧼 Temporary files and logs removed after successful execution.')); // Localized string
                }
                else
                {
                    logger.info(localize('log.uavController.logsKept', '✅ Successful execution. Logs kept per configuration.')); // Localized string
                }

            }
            catch (err: any)
            {
                const noApexMessage = localize('error.uavController.noApexClasses', '❌ No Apex classes were found in this XML.'); // Localized string
                if (err.message.includes(noApexMessage))
                {
                    vscode.window.showWarningMessage(err.message);
                    const failedPath = packageUri?.fsPath || sourceUri?.fsPath || 'N/A';
                    logger.warn(localize('log.uavController.noApexInPackage', '⚠️ UAV finished without ApexClass ({0})', failedPath)); // Localized string
                }
                else
                {
                    logger.error(localize('log.uavController.runFailed', '❌ Error during UAV run: {0}', err.message)); // Localized string
                    vscode.window.showErrorMessage(localize('error.uavController.runFailed', 'Error in UAV: {0}', err.message)); // Localized string
                }
            }
            finally
            {
                if (tempPackagePath)
                {
                    try
                    {
                        await fs.remove(tempPackagePath);
                    }
                    catch (cleanupErr)
                    {
                        logger.warn(localize('log.uavController.tempPackageCleanupFailed', 'Could not clean temporary package ({0}): {1}', tempPackagePath, String(cleanupErr))); // Localized string
                    }
                }
            }
        }
    );
}

export class FolderViewProvider implements vscode.TreeDataProvider<FileItem>
{
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly normalizedExtensions: string[];

    constructor(
        private folderPath: string,
        private fileExtension: string,
        private label: string
    )
    {
        this.normalizedExtensions = fileExtension
            .split('|')
            .map((ext) => ext.trim().toLowerCase())
            .filter(Boolean);
    }

    refresh(): void
    {
        this._onDidChangeTreeData.fire();
    }

    async getItemCount(): Promise<number>
    {
        const result = await this.collectFiles();
        return result.kind === 'files' ? result.files.length : 0;
    }

    async clearAll(): Promise<void>
    {
        const action = await vscode.window.showWarningMessage(
            `Eliminar todos los ${this.label.toLowerCase()}?`,
            'Eliminar',
            'Cancelar'
        );
        if (action !== 'Eliminar')
        {
            return;
        }

        try
        {
            const result = await this.collectFiles();

            if (result.kind === 'missing')
            {
                vscode.window.showInformationMessage(`Carpeta de ${this.label.toLowerCase()} no encontrada.`);
                this.refresh();
                return;
            }

            if (result.kind === 'error')
            {
                vscode.window.showErrorMessage(`No se pudieron eliminar los ${this.label.toLowerCase()}.`);
                this.refresh();
                return;
            }

            if (!result.files.length)
            {
                vscode.window.showInformationMessage(`${this.label}: sin archivos para eliminar.`);
                this.refresh();
                return;
            }

            await Promise.all(
                result.files.map((fileName) => fs.remove(path.join(this.folderPath, fileName)))
            );

            this.refresh();
            vscode.window.showInformationMessage(`${this.label}: archivos eliminados.`);
        }
        catch (error)
        {
            console.error(`[UAV][${this.label}] Error eliminando archivos:`, error);
            vscode.window.showErrorMessage(`No se pudieron eliminar los ${this.label.toLowerCase()}.`);
        }
    }

    getTreeItem(element: FileItem): vscode.TreeItem
    {
        return element;
    }

    async getChildren(): Promise<FileItem[]>
    {
        const result = await this.collectFiles();

        if (result.kind === 'missing')
        {
            return [
                new FileItem(
                    localize('ui.folderView.notFound', 'Folder not found: {0}', this.folderPath),
                    '',
                    false
                )
            ];
        }

        if (result.kind === 'error')
        {
            console.error(
                localize('log.folderView.readError', '[UAV][{0}] Error reading files:', this.label),
                result.error
            );
            return [new FileItem(localize('ui.folderView.error', 'Error reading folder'), '', false)];
        }

        if (!result.files.length)
        {
            return [new FileItem(localize('ui.folderView.empty', 'No files available'), '', false)];
        }

        return result.files.map(
            (name) => new FileItem(name, path.join(this.folderPath, name), true)
        );
    }

    private async collectFiles(): Promise<
        | { kind: 'missing' }
        | { kind: 'files'; files: string[] }
        | { kind: 'error'; error: unknown }
    >
    {
        if (!this.folderPath || !(await fs.pathExists(this.folderPath)))
        {
            return { kind: 'missing' };
        }

        try
        {
            const entries = await fs.readdir(this.folderPath, { withFileTypes: true });
            const files = entries
                .filter((entry) =>
                {
                    if (!entry.isFile()) return false;
                    if (!this.normalizedExtensions.length) return true;
                    const ext = path.extname(entry.name).toLowerCase();
                    return this.normalizedExtensions.some((value) => `.${value}` === ext);
                })
                .map((entry) => entry.name)
                .sort((a, b) => a.localeCompare(b));

            return { kind: 'files', files };
        }
        catch (error)
        {
            console.error(`[UAV][${this.label}] Error leyendo archivos:`, error);
            return { kind: 'error', error };
        }
    }
}

class FileItem extends vscode.TreeItem
{
    constructor(
        public readonly label: string,
        private readonly filePath: string,
        private readonly clickable: boolean
    )
    {
        super(label);
        this.iconPath = new vscode.ThemeIcon('file');
        this.tooltip = filePath;

        if (clickable)
        {
            this.command = {
                command: 'uav.openFile',
                title: localize('command.openFile.title', 'Open file'), // Localized string
                arguments: [vscode.Uri.file(filePath)]
            };
        }
    }
}



