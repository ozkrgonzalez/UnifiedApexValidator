import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import { Logger, parseApexClassesFromPackage, getStorageRoot, cleanUpFiles, getGlobalChannel, ensureOrgAliasConnected, getDefaultConnectedOrg } from './utils';
import { runValidator } from './validator';
import { TestSuite } from './testSuite';
import { IAAnalisis, evaluateIaConfig } from './IAAnalisis';
import { generateReport } from './reportGenerator';
import { execa } from 'execa';
import { showReport } from './reportViewer';

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

        console.log(`[UAV][Controller] Limpieza previa completada en ${storageRoot}`);
    }
    catch (err)
    {
        console.warn('[UAV][Controller] ⚠️ No se pudo limpiar logs/temp antes de la ejecución:', err);
    }

    // 🚀 Ahora sí, crear el logger principal
    const logger = new Logger('UAVController', true);
    logger.info('🚀 Iniciando ejecución del Unified Apex Validator...');

    let tempPackagePath: string | undefined;
    let sourceUri: vscode.Uri | undefined;
    let packageUri: vscode.Uri | undefined;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Unified Apex Validator',
            cancellable: true
        },
        async (progress) =>
            {
            try
            {
                sourceUri = uri && uri.scheme === 'file' ? uri : vscode.window.activeTextEditor?.document?.uri;
                if (!sourceUri || sourceUri.scheme !== 'file')
                {
                    throw new Error('Selecciona un package.xml o una clase Apex (.cls) dentro del workspace.');
                }

                const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];

                if (!workspaceFolder) throw new Error('No se detectó carpeta de proyecto');

                const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
                let repoDir = config.get<string>('sfRepositoryDir')?.trim() || '';

                if (!repoDir)
                {
                    repoDir = workspaceFolder.uri.fsPath;
                    logger.warn('⚠️ sfRepositoryDir no configurado. Usando raíz del workspace.');
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
                if (!fs.existsSync(path.join(repoDir, 'sfdx-project.json')))
                {
                    logger.warn('⚠️ No se encontró sfdx-project.json. Ajustando repoDir al workspace raíz.');
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
                    const msg = '❌ No se encontraron clases Apex en este XML.';
                    logger.error(msg);
                    throw new Error(msg);
                }

                // Paso 1: Parsear package.xml
                progress.report({ message: 'Analizando package.xml...' });
                logger.info('📦 Analizando package.xml...');
                if (!repoDir)
                {
                    repoDir = path.join(workspaceFolder.uri.fsPath, 'force-app', 'main', 'default', 'classes');
                    logger.warn(`⚠️ sfRepositoryDir no configurado. Usando ruta por defecto: ${repoDir}`);
                }
                else
                {
                    logger.info(`📁 Repositorio configurado: ${repoDir}`);
                }

                const defaultOrg = await getDefaultConnectedOrg(logger);
                if (!defaultOrg)
                {
                    const message = 'No se detectó una org por defecto conectada en Salesforce CLI. Ejecuta "sf org login web" e intenta nuevamente.';
                    logger.error(message);
                    vscode.window.showErrorMessage(message);
                    return;
                }

                const targetOrg = defaultOrg.alias || defaultOrg.username;
                const aliasReady = await ensureOrgAliasConnected(targetOrg, logger);
                if (!aliasReady)
                {
                    logger.warn(`⚠️ Se cancela la ejecución: la org "${targetOrg}" no está conectada.`);
                    return;
                }

                const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(pkgPath, repoDir);

                // 2️⃣ Validación estática (Code Analyzer + PMD)
                logger.info('🧠 Llamando a runValidator...');
                const { codeAnalyzerResults, pmdResults } = await runValidator(packageUri!, progress, repoDir);

                // 3️⃣ Ejecución de pruebas Apex
                progress.report({ message: 'Ejecutando pruebas Apex...' });

                logger.info('🧪 Ejecutando pruebas Apex...');
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

                    progress.report({ message: 'Ejecutando analisis IA...' });
                    logger.info('Ejecutando analisis de IA con Einstein GPT...');
                    const ia = new IAAnalisis();

                    for (const cls of nonTestClasses)
                    {
                        const clsPath = path.join(repoDir, 'force-app', 'main', 'default', 'classes', `${cls}.cls`);

                        if (!fs.existsSync(clsPath))
                        {
                            logger.warn(`Clase no encontrada: ${clsPath}`);
                            continue;
                        }

                        try
                        {
                            logger.info(`Enviando clase a IA: ${cls}`);
                            const content = await fs.readFile(clsPath, 'utf8');

                            const truncated = content.length > sfGptMaxChar ? content.slice(0, sfGptMaxChar) : content;

                            if (content.length > sfGptMaxChar)
                            {
                                logger.warn(`Clase ${cls} truncada a ${sfGptMaxChar} caracteres para analisis.`);
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
                            logger.warn(`IA fallo para ${cls}: ${message}`);
                        }
                    }

                    logger.info(`Analisis IA finalizado - clases procesadas: ${iaResults.length}`);
                }
                else if (skipIASetting)
                {
                    logger.info('Analisis IA omitido por configuracion (skipIAAnalysis=true).');
                }
                else
                {
                    logger.info(`IA deshabilitada - faltan parametros: ${iaStatus.missing.join(', ')}`);
                }

                // 5️⃣ Generar reportes
                progress.report({ message: 'Generando reportes...' });
                logger.info('📊 Generando reportes...');
                const outputDir = config.get<string>('outputDir')?.trim() || path.join(storageRoot, 'output');
                await fs.ensureDir(outputDir);
                await generateReport(outputDir,
                {
                    codeAnalyzerResults,
                    pmdResults,
                    testResults,
                    iaResults
                });

                logger.info(`✅ UAV completado. Reporte generado en: ${outputDir}`);
                vscode.window.showInformationMessage(`✅ UAV completado. Reporte generado en ${outputDir}.`);

                // 👀 Abrir el reporte en vista integrada dentro de VS Code
                const htmlReport = path.join(outputDir, 'reporte_validaciones.html');
                if (fs.existsSync(htmlReport))
                {
                    showReport(htmlReport, 'Reporte de Validación Apex');
                }
                else
                {
                    logger.warn(`⚠️ No se encontró el reporte HTML en ${htmlReport}`);
                }

                // 🧹 Limpieza final si corresponde
                const keepLogFiles = config.get<boolean>('keepLogFiles') ?? false;
                if (!keepLogFiles)
                {
                    await cleanUpFiles([tempDir, logDir], logger);
                    logger.info('🧼 Archivos temporales y logs eliminados tras ejecución exitosa.');
                }
                else
                {
                    logger.info('✅ Ejecución exitosa. Se conservaron los logs por configuración.');
                }

            }
            catch (err: any)
            {
                if (err.message.includes('No se encontraron clases Apex'))
                {
                    vscode.window.showWarningMessage(err.message);
                    const failedPath = packageUri?.fsPath || sourceUri?.fsPath || 'N/A';
                    logger.warn(`⚠️ UAV finalizado sin ApexClass (${failedPath})`);
                }
                else
                {
                    logger.error(`❌ Error en proceso UAV: ${err.message}`);
                    vscode.window.showErrorMessage(`Error en UAV: ${err.message}`);
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
                        logger.warn(`No se pudo limpiar el package temporal (${tempPackagePath}): ${cleanupErr}`);
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

    constructor(
        private folderPath: string,
        private fileExtension: string,
        private label: string
    ) {}

    refresh(): void
    {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileItem): vscode.TreeItem
    {
        return element;
    }

    async getChildren(): Promise<FileItem[]>
    {
        try {
            if (!this.folderPath || !(await fs.pathExists(this.folderPath))) {
                return [new FileItem(`No se encontró carpeta: ${this.folderPath}`, '', false)];
            }

            const files = await fs.readdir(this.folderPath, { withFileTypes: true });

            const filtered = files
                .filter(f =>
                {
                    if (!f.isFile()) return false;
                    const ext = path.extname(f.name).toLowerCase();
                    return this.fileExtension.split('|').some(e => ext === `.${e.trim()}`);
                })
                .map(f => new FileItem(f.name, path.join(this.folderPath, f.name), true));

            if (!filtered.length) {
                return [new FileItem('Sin archivos disponibles', '', false)];
            }

            return filtered;
        }
        catch (err)
        {
            console.error(`[UAV][${this.label}] Error leyendo archivos:`, err);
            return [new FileItem('Error leyendo carpeta', '', false)];
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
                title: 'Abrir archivo',
                arguments: [vscode.Uri.file(filePath)]
            };
        }
    }
}



