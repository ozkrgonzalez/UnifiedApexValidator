import * as vscode from 'vscode';
import { execa } from 'execa';

// 🧩 Representa un proveedor del árbol de dependencias del UAV
export class DependenciesProvider implements vscode.TreeDataProvider<UavDependencyItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<UavDependencyItem | undefined | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<UavDependencyItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: UavDependencyItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<UavDependencyItem[]> {
        const dependencies: UavDependencyItem[] = [];

        const checks: DepCheck[] = [
            { label: 'Node.js', cmd: 'node --version', minVersion: '18.0.0', installCmd: 'npm install -g node' },
            { label: 'Salesforce CLI (sf)', cmd: 'sf --version', minVersion: '2.0.0', installCmd: 'npm install -g @salesforce/cli' },
            { label: 'Salesforce Code Analyzer', cmd: 'sf code-analyzer run --help', minVersion: '5.0.0', installCmd: 'sf plugins install @salesforce/sfdx-scanner' },
            { label: 'Java', cmd: 'java -version', minVersion: '11.0.0', installCmd: 'apt install openjdk-11-jdk' },
            { label: 'wkhtmltopdf', cmd: 'wkhtmltopdf --version', minVersion: '0.12.6', installCmd: 'brew install wkhtmltopdf' }
        ];

        for (const dep of checks) {
            const state = await this.checkCommand(dep);
            const item = new UavDependencyItem(dep.label, state);

            const iconMap = {
                ok: new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')), // verde
                outdated: new vscode.ThemeIcon('triangle-right', new vscode.ThemeColor('editorWarning.foreground')), // amarillo
                missing: new vscode.ThemeIcon('close', new vscode.ThemeColor('errorForeground')) // rojo
            };
            item.iconPath = iconMap[state];

            if (state !== 'ok' && dep.installCmd) {
                item.command = {
                    title: 'Actualizar dependencia',
                    command: 'uav.updateDependency',
                    arguments: [dep]
                };
                item.tooltip = `Actualizar ${dep.label}`;
            }

            dependencies.push(item);
        }

        // IA config (desde settings)
        const cfg = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const iaFields = [
            cfg.get('sfGptEndpoint'),
            cfg.get('sfGptModel'),
            cfg.get('iaPromptTemplate')
        ];
        const iaConfigured = iaFields.every(v => typeof v === 'string' && v.trim() !== '');
        const iaItem = new UavDependencyItem('IA Configuración', iaConfigured ? 'ok' : 'missing');
        iaItem.iconPath = iaConfigured
            ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('close', new vscode.ThemeColor('errorForeground'));
        dependencies.push(iaItem);

        return dependencies;
    }

    private async checkCommand(dep: DepCheck): Promise<'ok' | 'outdated' | 'missing'> {
        try {
            const { stdout, stderr } = await execa(dep.cmd, { shell: true });
            const output = stdout || stderr || '';
            const match = output.match(/\d+(\.\d+)+/);
            if (match && dep.minVersion) {
                return this.compareVersions(match[0], dep.minVersion) >= 0 ? 'ok' : 'outdated';
            }
            return 'ok';
        } catch {
            return 'missing';
        }
    }

    private compareVersions(a: string, b: string): number {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            if ((pa[i] || 0) > (pb[i] || 0)) return 1;
            if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        }
        return 0;
    }
}

// 🧩 Estructura base de cada dependencia
interface DepCheck {
    label: string;
    cmd: string;
    minVersion?: string;
    installCmd?: string;
}

// 🧩 Elemento visual dentro del árbol de dependencias
export class UavDependencyItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly state: 'ok' | 'outdated' | 'missing'
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = this.getDescription(state);
    }

    private getDescription(state: 'ok' | 'outdated' | 'missing'): string {
        switch (state) {
            case 'ok':
                return 'Actualizado';
            case 'outdated':
                return 'Desactualizado';
            case 'missing':
                return 'No instalado';
        }
    }
}

// 🧩 Registro del comando de actualización
export function registerDependencyUpdater(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('uav.updateDependency', async (dep: DepCheck) => {
            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Actualizando ${dep.label}...` },
                async () => {
                    try {
                        await execa(dep.installCmd!, { shell: true });
                        vscode.window.showInformationMessage(`${dep.label} actualizado correctamente.`);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Error actualizando ${dep.label}: ${err.message}`);
                    }
                }
            );
        })
    );
}
