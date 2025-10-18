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
exports.Logger = void 0;
exports.setExtensionContext = setExtensionContext;
exports.getGlobalChannel = getGlobalChannel;
exports.getStorageRoot = getStorageRoot;
exports.parseApexClassesFromPackage = parseApexClassesFromPackage;
exports.cleanUpFiles = cleanUpFiles;
exports.resolveSfCliPath = resolveSfCliPath;
exports.ensureOrgAliasConnected = ensureOrgAliasConnected;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const fast_xml_parser_1 = require("fast-xml-parser");
const vscode = __importStar(require("vscode"));
const glob = __importStar(require("glob"));
const execa_1 = require("execa");
let _ctx;
function setExtensionContext(ctx) {
    console.log('[UAV][setExtensionContext] ExtensionContext recibido:', !!ctx);
    console.log('[UAV][setExtensionContext] globalStorageUri:', ctx?.globalStorageUri?.fsPath);
    _ctx = ctx;
}
let globalChannel = null;
let processHandlersRegistered = false;
const ignoredUnhandledPatterns = [
    /CreateEmbeddingSupplier/i
];
function shouldIgnoreUnhandled(reason) {
    const message = typeof reason === 'string'
        ? reason
        : typeof reason?.message === 'string'
            ? reason.message
            : '';
    return ignoredUnhandledPatterns.some((pattern) => pattern.test(message));
}
function getGlobalChannel() {
    if (!globalChannel) {
        globalChannel = vscode.window.createOutputChannel('Unified Apex Validator');
        globalChannel.show(true);
    }
    return globalChannel;
}
function getStorageRoot() {
    const base = _ctx?.globalStorageUri?.fsPath || path.resolve(__dirname, '..', '..');
    const dir = path.join(base, '.uav');
    try {
        fs.ensureDirSync(dir);
    }
    catch (err) {
        console.error('[UAV][getStorageRoot] \u274C Error creando directorio', err);
    }
    return dir;
}
class Logger {
    logPath;
    outputChannel;
    prefix;
    constructor(prefix, autoShow = false, channelName = 'Unified Apex Validator') {
        this.prefix = prefix;
        const storageRoot = getStorageRoot();
        console.log(`[UAV][Logger] Creando logger para ${prefix} en ${storageRoot}`);
        const logDir = path.join(storageRoot, 'logs');
        try {
            fs.ensureDirSync(logDir);
        }
        catch (err) {
            console.error('[UAV][Logger] \u274C Error creando carpeta de logs:', err);
        }
        this.logPath = path.join(logDir, `${prefix}.log`);
        this.outputChannel = getGlobalChannel();
        if (!fs.existsSync(this.logPath)) {
            fs.writeFileSync(this.logPath, '\uFEFF', { encoding: 'utf8' });
        }
        if (autoShow) {
            this.outputChannel.show(true);
            console.log(`[UAV][Logger] Mostrando canal: ${channelName}`);
        }
        // Confirmar rutas
        console.log(`[UAV][Logger] logPath=${this.logPath}`);
        if (!processHandlersRegistered) {
            process.on('uncaughtException', (err) => this.error(`Uncaught Exception: ${err.message}`));
            process.on('unhandledRejection', (reason) => {
                if (shouldIgnoreUnhandled(reason))
                    return;
                this.error(`Unhandled Rejection: ${reason}`);
            });
            processHandlersRegistered = true;
        }
    }
    clear() {
        console.log(`[UAV][Logger] Limpiando log: ${this.logPath}`);
        fs.writeFileSync(this.logPath, '\uFEFF', { encoding: 'utf8' });
    }
    write(level, msg) {
        const line = `${new Date().toISOString()} [${level}] [${this.prefix}] ${msg}`;
        try {
            fs.appendFileSync(this.logPath, line + '\n', { encoding: 'utf8' });
        }
        catch (err) {
            console.error(`[UAV][Logger] \u274C Error escribiendo log ${this.logPath}:`, err);
        }
        this.outputChannel.appendLine(line);
    }
    info(msg) { this.write('INFO', msg); }
    warn(msg) { this.write('WARN', msg); }
    error(msg) { this.write('ERROR', msg); }
    pipe(childProcess) { }
}
exports.Logger = Logger;
/**
 * Lee un package.xml y devuelve las clases test y no-test encontradas.
 */
async function parseApexClassesFromPackage(pkgPath, repoDir) {
    const logger = new Logger('PackageParser');
    try {
        logger.info(`\u{1F4E6} Leyendo package.xml desde: ${pkgPath}`);
        const xml = await fs.readFile(pkgPath, 'utf8');
        const parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false });
        const json = parser.parse(xml);
        //logger.info(`Estructura JSON parseada: ${JSON.stringify(json?.Package?.types, null, 2)}`);
        const types = json?.Package?.types || [];
        const apexTypes = Array.isArray(types)
            ? types.find((t) => t.name === 'ApexClass')
            : types.name === 'ApexClass'
                ? types
                : null;
        const members = Array.isArray(apexTypes.members) ? apexTypes.members : [apexTypes.members];
        const testClasses = [];
        const nonTestClasses = [];
        logger.info(`\u{1F4C2} Buscando clases dentro de: ${repoDir}`);
        for (const cls of members) {
            const matches = glob.sync(`**/${cls}.cls`, { cwd: repoDir, absolute: true });
            if (!matches.length) {
                continue;
            }
            const content = await fs.readFile(matches[0], 'utf8');
            if (/@istest/i.test(content)) {
                testClasses.push(cls);
            }
            else {
                nonTestClasses.push(cls);
            }
        }
        logger.info(`\u{1F9EA} Clases de prueba detectadas (${testClasses.length}): ${testClasses.join(', ') || 'Ninguna'}`);
        logger.info(`\u{1F4D6} Clases normales detectadas (${nonTestClasses.length}): ${nonTestClasses.join(', ') || 'Ninguna'}`);
        return { testClasses, nonTestClasses };
    }
    catch (err) {
        console.error('[UAV][PackageParser] \u274C Error parseando package.xml:', err);
        throw err;
    }
}
/**
 * Elimina de forma segura los archivos y carpetas indicadas
 * @param paths Lista de rutas a limpiar
 * @param logger Logger opcional para registrar la limpieza
 */
async function cleanUpFiles(paths, logger) {
    for (const dir of paths) {
        try {
            if (await fs.pathExists(dir)) {
                await fs.emptyDir(dir);
                logger?.info(`\u{1F9F9} Carpeta limpiada: ${dir}`);
            }
            else {
                logger?.warn(`\u26A0\uFE0F Carpeta no encontrada: ${dir}`);
            }
        }
        catch (err) {
            logger?.warn(`\u274C No se pudo limpiar ${dir}: ${err.message}`);
        }
    }
}
function resolveSfCliPath() {
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const configured = config.get('sfCliPath')?.trim();
    const candidates = [];
    if (configured)
        candidates.push(configured);
    if (process.platform === 'win32') {
        candidates.push('sf.cmd', 'sf.CMD', 'sf');
    }
    else {
        candidates.push('sf');
    }
    const attempts = [];
    for (const cmd of candidates) {
        if (!cmd)
            continue;
        try {
            (0, execa_1.execaSync)(cmd, ['--version']);
            return cmd;
        }
        catch (err) {
            const reason = err?.shortMessage || err?.message || String(err);
            attempts.push(`${cmd}: ${reason}`);
        }
    }
    throw new Error(`No se pudo localizar Salesforce CLI. Revisa UnifiedApexValidator.sfCliPath. Intentos: ${attempts.join('; ')}`);
}
async function ensureOrgAliasConnected(alias, logger) {
    const trimmed = (alias || '').trim();
    if (!trimmed) {
        vscode.window.showErrorMessage('Configura UnifiedApexValidator.sfOrgAlias antes de ejecutar el validador.');
        return false;
    }
    const sfPath = resolveSfCliPath();
    const checkAlias = async () => {
        try {
            const { stdout } = await (0, execa_1.execa)(sfPath, ['org', 'display', '--json', '--target-org', trimmed], {
                env: { ...process.env, FORCE_COLOR: '0' }
            });
            const raw = stdout?.trim();
            if (!raw)
                return false;
            const info = JSON.parse(raw);
            const status = info?.result?.connectedStatus ||
                info?.result?.status ||
                info?.result?.connected;
            if (typeof status === 'string' && status.toLowerCase() === 'connected') {
                logger.info(`Org "${trimmed}" detectada como conectada.`);
                return true;
            }
            logger.warn(`Estado de la org "${trimmed}": ${status || 'desconocido'}.`);
            return false;
        }
        catch (err) {
            const reason = err?.shortMessage || err?.stderr || err?.message || String(err);
            logger.warn(`No se pudo verificar la org "${trimmed}": ${reason}`);
            return false;
        }
    };
    if (await checkAlias())
        return true;
    const answer = await vscode.window.showWarningMessage(`La org con alias "${trimmed}" no aparece conectada en Salesforce CLI. \u00BFQuieres iniciar sesion ahora?`, 'Conectar ahora', 'Cancelar');
    if (answer !== 'Conectar ahora') {
        logger.warn(`Se cancela la validacion porque la org "${trimmed}" no esta conectada.`);
        return false;
    }
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Conectando org "${trimmed}"...`,
            cancellable: false
        }, async () => {
            logger.info(`Ejecutando "sf org login web --alias ${trimmed}". Completa el inicio de sesion en el navegador.`);
            const child = (0, execa_1.execa)(sfPath, ['org', 'login', 'web', '--alias', trimmed], {
                stdout: 'pipe',
                stderr: 'pipe',
                env: { ...process.env, FORCE_COLOR: '0' }
            });
            child.stdout?.on('data', (data) => {
                const text = data.toString().trim();
                if (text)
                    logger.info(`[sf] ${text}`);
            });
            child.stderr?.on('data', (data) => {
                const text = data.toString().trim();
                if (text)
                    logger.warn(`[sf] ${text}`);
            });
            await child;
        });
    }
    catch (err) {
        const reason = err?.shortMessage || err?.message || String(err);
        logger.error(`No se pudo completar el login de la org "${trimmed}": ${reason}`);
        vscode.window.showErrorMessage(`No se pudo conectar la org "${trimmed}". Revisa el Output de UAV para mas detalles.`);
        return false;
    }
    if (await checkAlias()) {
        vscode.window.showInformationMessage(`Org "${trimmed}" conectada correctamente.`);
        return true;
    }
    vscode.window.showErrorMessage(`El alias "${trimmed}" sigue sin conexion tras el intento de login. Verifica tus permisos y repite el proceso.`);
    return false;
}
