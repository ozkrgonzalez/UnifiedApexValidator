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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const execa_1 = require("execa");
const IAAnalisis_1 = require("../core/IAAnalisis");
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
        const records = await this.collectDependencies();
        for (const { dep, status, info } of records) {
            const item = new UavDependencyItem(dep, status);
            const iconMap = {
                ok: new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')),
                outdated: new vscode.ThemeIcon('triangle-right', new vscode.ThemeColor('editorWarning.foreground')),
                missing: new vscode.ThemeIcon('close', new vscode.ThemeColor('errorForeground'))
            };
            item.iconPath = iconMap[status.state];
            if (status.state !== 'ok' && dep.installCmd) {
                item.command = {
                    title: 'Actualizar dependencia',
                    command: 'uav.updateDependency',
                    arguments: [dep]
                };
                item.tooltip = item.tooltip ? `${item.tooltip} | Actualizar ${dep.label}` : `Actualizar ${dep.label}`;
            }
            if (info?.type === 'ia') {
                if (info.ready) {
                    item.description = 'Actualizado';
                    item.tooltip = 'Credenciales IA configuradas.';
                }
                else {
                    const missingList = info.missing.join(', ');
                    item.description = `Faltan: ${missingList}`;
                    item.tooltip = `Configura los siguientes campos: ${missingList}`;
                }
            }
            dependencies.push(item);
        }
        return dependencies;
    }
    async getDependencySummary() {
        const records = await this.collectDependencies();
        const worstState = records.reduce((current, record) => this.getSeverityRank(record.status.state) > this.getSeverityRank(current)
            ? record.status.state
            : current, 'ok');
        return { state: worstState, records };
    }
    getSeverityRank(state) {
        switch (state) {
            case 'missing':
                return 3;
            case 'outdated':
                return 2;
            case 'ok':
            default:
                return 1;
        }
    }
    async collectDependencies() {
        const records = [];
        const checks = [
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
        for (const dep of checks) {
            const status = await this.checkCommand(dep);
            records.push({ dep, status });
        }
        const iaStatus = (0, IAAnalisis_1.evaluateIaConfig)();
        const iaDep = { label: 'IA Configuracion' };
        const iaItemStatus = { state: iaStatus.ready ? 'ok' : 'missing' };
        records.push({
            dep: iaDep,
            status: iaItemStatus,
            info: {
                type: 'ia',
                ready: iaStatus.ready,
                missing: iaStatus.missing
            }
        });
        return records;
    }
    async checkCommand(dep) {
        if (dep.customCheck) {
            try {
                return await dep.customCheck(dep.minVersion);
            }
            catch (error) {
                console.error('[UAV][dependencies] Error revisando dependencia personalizada:', error);
                return { state: 'missing' };
            }
        }
        try {
            if (!dep.cmd) {
                return { state: 'missing' };
            }
            const { stdout, stderr } = await (0, execa_1.execa)(dep.cmd, { shell: true });
            const output = stdout || stderr || '';
            const match = output.match(/\d+(\.\d+)+/);
            const detectedVersion = match ? match[0] : undefined;
            if (match && dep.minVersion) {
                const state = this.compareVersions(match[0], dep.minVersion) >= 0 ? 'ok' : 'outdated';
                return { state, detectedVersion };
            }
            return { state: 'ok', detectedVersion };
        }
        catch {
            return { state: 'missing' };
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
    resolveModule(moduleName) {
        const searchPaths = [];
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                searchPaths.push(folder.uri.fsPath);
            }
        }
        searchPaths.push(this.context.extensionUri.fsPath);
        try {
            return require.resolve(moduleName, { paths: searchPaths });
        }
        catch (error) {
            console.warn(`[UAV][dependencies] No se pudo resolver ${moduleName} con rutas personalizadas.`, error);
            return null;
        }
    }
    async checkPrettierPlugin(minVersion) {
        try {
            let entryPath = null;
            try {
                entryPath = require.resolve('prettier-plugin-apex');
            }
            catch {
                entryPath = this.resolveModule('prettier-plugin-apex');
            }
            if (!entryPath) {
                return { state: 'missing' };
            }
            let pkgPath = entryPath.replace(/dist[\\/].*$/, 'package.json');
            if (!fs.existsSync(pkgPath)) {
                pkgPath = path.join(path.dirname(entryPath), 'package.json');
            }
            if (!fs.existsSync(pkgPath)) {
                console.warn('[UAV][dependencies] package.json no encontrado para prettier-plugin-apex:', pkgPath);
                return { state: 'missing' };
            }
            const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const version = packageJson.version;
            if (!version) {
                return { state: 'missing' };
            }
            if (minVersion) {
                const state = this.compareVersions(version, minVersion) >= 0 ? 'ok' : 'outdated';
                return { state, detectedVersion: version };
            }
            return { state: 'ok', detectedVersion: version };
        }
        catch (error) {
            console.warn('[UAV][dependencies] No se pudo resolver prettier-plugin-apex:', error);
            return { state: 'missing' };
        }
    }
}
exports.DependenciesProvider = DependenciesProvider;
class UavDependencyItem extends vscode.TreeItem {
    dep;
    status;
    constructor(dep, status) {
        super(dep.label, vscode.TreeItemCollapsibleState.None);
        this.dep = dep;
        this.status = status;
        this.description = this.getDescription(status.state);
        this.tooltip = this.buildTooltip(dep, status);
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
    buildTooltip(dep, status) {
        const parts = [dep.label];
        if (status.detectedVersion) {
            parts.push(`Detectado ${status.detectedVersion}`);
        }
        if (dep.minVersion) {
            parts.push(`Minimo ${dep.minVersion}`);
        }
        switch (status.state) {
            case 'ok':
                parts.push('Actualizado');
                break;
            case 'outdated':
                parts.push('Desactualizado');
                break;
            case 'missing':
                parts.push('No instalado');
                break;
        }
        return parts.join(' | ');
    }
}
exports.UavDependencyItem = UavDependencyItem;
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
