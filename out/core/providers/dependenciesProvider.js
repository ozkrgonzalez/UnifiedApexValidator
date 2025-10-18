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
exports.UavDependencyItem = exports.DependenciesProvider = void 0;
exports.registerDependencyUpdater = registerDependencyUpdater;
const vscode = __importStar(require("vscode"));
const execa_1 = require("execa");
// 🧩 Representa un proveedor del árbol de dependencias del UAV
class DependenciesProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(context) {
        this.context = context;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        const dependencies = [];
        const checks = [
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
    async checkCommand(dep) {
        try {
            const { stdout, stderr } = await (0, execa_1.execa)(dep.cmd, { shell: true });
            const output = stdout || stderr || '';
            const match = output.match(/\d+(\.\d+)+/);
            if (match && dep.minVersion) {
                return this.compareVersions(match[0], dep.minVersion) >= 0 ? 'ok' : 'outdated';
            }
            return 'ok';
        }
        catch {
            return 'missing';
        }
    }
    compareVersions(a, b) {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            if ((pa[i] || 0) > (pb[i] || 0))
                return 1;
            if ((pa[i] || 0) < (pb[i] || 0))
                return -1;
        }
        return 0;
    }
}
exports.DependenciesProvider = DependenciesProvider;
// 🧩 Elemento visual dentro del árbol de dependencias
class UavDependencyItem extends vscode.TreeItem {
    label;
    state;
    constructor(label, state) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.label = label;
        this.state = state;
        this.description = this.getDescription(state);
    }
    getDescription(state) {
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
exports.UavDependencyItem = UavDependencyItem;
// 🧩 Registro del comando de actualización
function registerDependencyUpdater(context) {
    context.subscriptions.push(vscode.commands.registerCommand('uav.updateDependency', async (dep) => {
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Actualizando ${dep.label}...` }, async () => {
            try {
                await (0, execa_1.execa)(dep.installCmd, { shell: true });
                vscode.window.showInformationMessage(`${dep.label} actualizado correctamente.`);
            }
            catch (err) {
                vscode.window.showErrorMessage(`Error actualizando ${dep.label}: ${err.message}`);
            }
        });
    }));
}
