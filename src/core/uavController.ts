import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import { Logger, parseApexClassesFromPackage, getStorageRoot, cleanUpFiles, getGlobalChannel } from './utils';
import { runValidator } from './validator';
import { TestSuite } from './testSuite';
import { IAAnalisis } from './IAAnalisis';
import { generateReport } from './reportGenerator';
import { execa } from 'execa';
import { showReport } from './reportViewer';

export async function runUAV(uri: vscode.Uri)
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
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];

                if (!workspaceFolder) throw new Error('No se detectó carpeta de proyecto');

                const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
                let repoDir = config.get<string>('sfRepositoryDir')?.trim() || '';

                if (!repoDir)
                {
                    repoDir = workspaceFolder.uri.fsPath;
                    logger.warn('⚠️ sfRepositoryDir no configurado. Usando raíz del workspace.');
                }

                // 🧩 Validar estructura mínima del repo
                if (!fs.existsSync(path.join(repoDir, 'sfdx-project.json')))
                {
                    logger.warn('⚠️ No se encontró sfdx-project.json. Ajustando repoDir al workspace raíz.');
                    repoDir = workspaceFolder.uri.fsPath;
                }

                const pkgPath = uri.fsPath;
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

                // 1️⃣ Parsear package.xml
                progress.report({ message: 'Analizando package.xml...' });
                logger.info('📦 Analizando package.xml...');;
                if (!repoDir)
                {
                    repoDir = path.join(workspaceFolder.uri.fsPath, 'force-app', 'main', 'default', 'classes');
                    logger.warn(`⚠️ sfRepositoryDir no configurado. Usando ruta por defecto: ${repoDir}`);
                }
                else
                {
                    logger.info(`📁 Repositorio configurado: ${repoDir}`);
                }

                const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(pkgPath, repoDir);

                // 2️⃣ Validación estática (Code Analyzer + PMD)
                logger.info('🧠 Llamando a runValidator...');
                const { codeAnalyzerResults, pmdResults } = await runValidator(uri, progress, repoDir);

                // 3️⃣ Ejecución de pruebas Apex
                progress.report({ message: 'Ejecutando pruebas Apex...' });

                logger.info('🧪 Ejecutando pruebas Apex...');
                const testSuite = new TestSuite(workspaceFolder.uri.fsPath);
                const testResults = await testSuite.runTestSuite(testClasses, nonTestClasses);

                // 4️⃣ (Opcional) Análisis IA
                const skipIA = config.get<boolean>('skipIAAnalysis') ?? false;
                let iaResults: any[] = [];

                if (!skipIA)
                {
                    const sfClientId = config.get<string>('sfClientId');
                    const sfClientSecret = config.get<string>('sfClientSecret');
                    const sfGptEndpoint = config.get<string>('sfGptEndpoint');
                    const sfGptPrompt = config.get<string>('iaPromptTemplate') ?? 'Analiza la clase {class_name}:\n{truncated_body}';
                    const sfGptMaxChar = config.get<number>('maxIAClassChars') ?? 25000;
                    const iaEnabled = !!sfClientId && !!sfClientSecret && !!sfGptEndpoint;

                    if (iaEnabled)
                    {
                        progress.report({ message: 'Ejecutando análisis IA...' });
                        logger.info('🤖 Ejecutando análisis de IA con Einstein GPT...');
                        const ia = new IAAnalisis();

                        for (const cls of nonTestClasses)
                        {
                            const clsPath = path.join(repoDir, 'force-app','main','default','classes', `${cls}.cls`);

                            if (!fs.existsSync(clsPath))
                            {
                                logger.warn(`⚠️ Clase no encontrada: ${clsPath}`);
                                continue;
                            }

                            try
                            {
                                logger.info(`📘 Enviando clase a IA: ${cls}`);
                                const content = await fs.readFile(clsPath, 'utf8');

                                // 🔹 Truncar si excede cierto tamaño (para no pasar textos enormes)
                                const truncated = content.length > sfGptMaxChar ? content.slice(0, sfGptMaxChar) : content;

                                if (content.length > sfGptMaxChar)
                                {
                                    logger.warn(`⚠️ Clase ${cls} truncada a ${sfGptMaxChar} caracteres para análisis.`);
                                }
                                // 🔹 Combinar con el prompt base de settings
                                if (!sfGptPrompt)
                                {
                                    logger.warn('⚠️ No hay plantilla de prompt configurada en settings (iaPromptTemplate).');
                                    continue;
                                }

                                const prompt = sfGptPrompt
                                .replace('{class_name}', cls)
                                .replace('{truncated_body}', truncated);

                                // 🔹 Enviar el prompt armado, no solo el código
                                const analysis = await ia.analizar(prompt);

                                //logger.info(`🧠 IA -> ${cls}: ${analysis.resumen.slice(0, 100)}...`);
                                const md = new MarkdownIt(
                                    {
                                        html: true,
                                        linkify: true,
                                        typographer: true
                                    });

                                const resumenHtml = md.render(analysis.resumen || '');
                                iaResults.push({ Clase: cls, resumenHtml });
                            }
                            catch (err: any)
                            {
                                logger.warn(`⚠️ IA falló para ${cls}: ${err.message}`);
                            }
                        }

                        logger.info(`🏁 Análisis IA finalizado — clases procesadas: ${iaResults.length}`);
                    }
                    else
                    {
                        logger.info('ℹ️ IA deshabilitada — faltan credenciales o endpoint.');
                    }
                }
                else
                {
                    logger.info('⏭️ Análisis IA omitido por configuración (skipIAAnalysis=true).');
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
                    logger.warn(`⚠️ UAV finalizado sin ApexClass (${uri.fsPath})`);
                }
                else
                {
                    logger.error(`❌ Error en proceso UAV: ${err.message}`);
                    vscode.window.showErrorMessage(`Error en UAV: ${err.message}`);
                }
            }
        }
    );
}

export class DependenciesProvider implements vscode.TreeDataProvider<DependencyItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DependencyItem | undefined | void> = new vscode.EventEmitter<DependencyItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<DependencyItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DependencyItem): vscode.TreeItem
    {
        return element;
    }

    async getChildren(): Promise<DependencyItem[]> {
        const dependencies: DependencyItem[] = [];

        const checks = [
            { label: 'Node.js', cmd: 'node --version' },
            { label: 'Salesforce CLI (sf)', cmd: 'sf --version' },
            { label: 'Salesforce Code Analyzer v5', cmd: 'sf code-analyzer run --help' },
            { label: 'Java', cmd: 'java -version' },
            { label: 'wkhtmltopdf', cmd: 'wkhtmltopdf --version' }
        ];

        for (const dep of checks)
        {
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

    private async checkCommand(command: string): Promise<boolean>
    {
        try
        {
            await execa(command, { shell: true });
            return true;
        }
        catch
        {
            return false;
        }
    }
}

class DependencyItem extends vscode.TreeItem
{
    constructor(
        public readonly label: string,
        private readonly ok: boolean
    )
    {
        super(label);
        this.iconPath = new vscode.ThemeIcon(ok ? 'check' : 'error', ok ? new vscode.ThemeColor('testing.iconPassed') : new vscode.ThemeColor('testing.iconFailed'));
        this.tooltip = ok ? 'Disponible' : 'No encontrado o no accesible';
        this.description = ok ? 'OK' : 'Falta';
    }
}

export class FolderViewProvider implements vscode.TreeDataProvider<FileItem>
{
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private folderPath: string,
        private fileExtension: string,  // puede ser .html, .pdf, .log, etc.
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