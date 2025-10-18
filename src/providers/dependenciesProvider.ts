import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execa } from 'execa';
import { evaluateIaConfig } from '../core/IAAnalisis';

export class DependenciesProvider implements vscode.TreeDataProvider<UavDependencyItem>
{
    private _onDidChangeTreeData: vscode.EventEmitter<UavDependencyItem | undefined | void> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<UavDependencyItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void
    {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: UavDependencyItem): vscode.TreeItem
    {
        return element;
    }

    async getChildren(): Promise<UavDependencyItem[]>
    {
        const dependencies: UavDependencyItem[] = [];

        const checks: DepCheck[] = [
            { label: 'Node.js', cmd: 'node --version', minVersion: '18.0.0', installCmd: 'npm install -g node' },
            { label: 'Salesforce CLI (sf)', cmd: 'sf --version', minVersion: '2.0.0', installCmd: 'npm install -g @salesforce/cli' },
            { label: 'Salesforce Code Analyzer', cmd: 'sf code-analyzer run --help', minVersion: '5.0.0', installCmd: 'sf plugins install @salesforce/sfdx-scanner' },
            {
                label: 'Prettier Apex Plugin',
                minVersion: '2.2.6',
                installCmd: 'npm install prettier prettier-plugin-apex',
                customCheck: (minVersion) => this.checkPrettierPlugin(minVersion)
            },
            { label: 'Java', cmd: 'java -version', minVersion: '11.0.0', installCmd: 'apt install openjdk-11-jdk' },
            { label: 'wkhtmltopdf', cmd: 'wkhtmltopdf --version', minVersion: '0.12.6', installCmd: 'brew install wkhtmltopdf' }
        ];

        for (const dep of checks)
        {
            const state = await this.checkCommand(dep);
            const item = new UavDependencyItem(dep.label, state);

            const iconMap = {
                ok: new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')),
                outdated: new vscode.ThemeIcon('triangle-right', new vscode.ThemeColor('editorWarning.foreground')),
                missing: new vscode.ThemeIcon('close', new vscode.ThemeColor('errorForeground'))
            };
            item.iconPath = iconMap[state];

            if (state !== 'ok' && dep.installCmd)
            {
                item.command = {
                    title: 'Actualizar dependencia',
                    command: 'uav.updateDependency',
                    arguments: [dep]
                };
                item.tooltip = `Actualizar ${dep.label}`;
            }

            dependencies.push(item);
        }

        const iaStatus = evaluateIaConfig();
        const iaItem = new UavDependencyItem('IA Configuracion', iaStatus.ready ? 'ok' : 'missing');
        iaItem.iconPath = iaStatus.ready
            ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('close', new vscode.ThemeColor('errorForeground'));
        if (iaStatus.ready)
        {
            iaItem.description = 'Actualizado';
            iaItem.tooltip = 'Credenciales IA configuradas.';
        }
        else
        {
            const missingList = iaStatus.missing.join(', ');
            iaItem.description = `Faltan: ${missingList}`;
            iaItem.tooltip = `Configura los siguientes campos: ${missingList}`;
        }
        dependencies.push(iaItem);

        return dependencies;
    }

    private async checkCommand(dep: DepCheck): Promise<'ok' | 'outdated' | 'missing'>
    {
        if (dep.customCheck)
        {
            try
            {
                return await dep.customCheck(dep.minVersion);
            }
            catch (error)
            {
                console.error('[UAV][dependencies] Error revisando dependencia personalizada:', error);
                return 'missing';
            }
        }

        try
        {
            if (!dep.cmd)
            {
                return 'missing';
            }
            const { stdout, stderr } = await execa(dep.cmd, { shell: true });
            const output = stdout || stderr || '';
            const match = output.match(/\d+(\.\d+)+/);
            if (match && dep.minVersion)
            {
                return this.compareVersions(match[0], dep.minVersion) >= 0 ? 'ok' : 'outdated';
            }
            return 'ok';
        }
        catch
        {
            return 'missing';
        }
    }

    private compareVersions(a: string, b: string): number
    {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++)
        {
            if ((pa[i] || 0) > (pb[i] || 0)) return 1;
            if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        }
        return 0;
    }

    private resolveModule(moduleName: string): string | null
    {
        const searchPaths: string[] = [];

        if (vscode.workspace.workspaceFolders)
        {
            for (const folder of vscode.workspace.workspaceFolders)
            {
                searchPaths.push(folder.uri.fsPath);
            }
        }

        searchPaths.push(this.context.extensionUri.fsPath);

        try
        {
            return require.resolve(moduleName, { paths: searchPaths });
        }
        catch (error)
        {
            console.warn(`[UAV][dependencies] No se pudo resolver ${moduleName} con rutas personalizadas.`, error);
            return null;
        }
    }

    private async checkPrettierPlugin(minVersion?: string): Promise<'ok' | 'outdated' | 'missing'>
    {
        try
        {
            let entryPath: string | null = null;

            try
            {
                entryPath = require.resolve('prettier-plugin-apex');
            }
            catch
            {
                entryPath = this.resolveModule('prettier-plugin-apex');
            }

            if (!entryPath)
            {
                return 'missing';
            }

            let pkgPath = entryPath.replace(/dist[\\/].*$/, 'package.json');
            if (!fs.existsSync(pkgPath))
            {
                pkgPath = path.join(path.dirname(entryPath), 'package.json');
            }

            if (!fs.existsSync(pkgPath))
            {
                console.warn('[UAV][dependencies] package.json no encontrado para prettier-plugin-apex:', pkgPath);
                return 'missing';
            }

            const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const version = packageJson.version as string | undefined;
            if (!version)
            {
                return 'missing';
            }

            if (minVersion)
            {
                return this.compareVersions(version, minVersion) >= 0 ? 'ok' : 'outdated';
            }

            return 'ok';
        }
        catch (error)
        {
            console.warn('[UAV][dependencies] No se pudo resolver prettier-plugin-apex:', error);
            return 'missing';
        }
    }
}

interface DepCheck
{
    label: string;
    cmd?: string;
    minVersion?: string;
    installCmd?: string;
    customCheck?: (minVersion?: string) => Promise<'ok' | 'outdated' | 'missing'>;
}

export class UavDependencyItem extends vscode.TreeItem
{
    constructor(public readonly label: string, public readonly state: 'ok' | 'outdated' | 'missing')
    {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = this.getDescription(state);
    }

    private getDescription(state: 'ok' | 'outdated' | 'missing'): string
    {
        switch (state)
        {
            case 'ok':
                return 'Actualizado';
            case 'outdated':
                return 'Desactualizado';
            case 'missing':
                return 'No instalado';
        }
    }
}

export function registerDependencyUpdater(context: vscode.ExtensionContext)
{
    context.subscriptions.push(
        vscode.commands.registerCommand('uav.updateDependency', async (dep: DepCheck) =>
        {
            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Actualizando ${dep.label}...` },
                async () =>
                {
                    try
                    {
                        await execa(dep.installCmd!, { shell: true });
                        vscode.window.showInformationMessage(`${dep.label} actualizado correctamente.`);
                    }
                    catch (err: any)
                    {
                        vscode.window.showErrorMessage(`Error actualizando ${dep.label}: ${err.message}`);
                    }
                }
            );
        })
    );
}
