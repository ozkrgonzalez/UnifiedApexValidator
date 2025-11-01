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
exports.parseSfJson = parseSfJson;
exports.getGlobalChannel = getGlobalChannel;
exports.getStorageRoot = getStorageRoot;
exports.parseApexClassesFromPackage = parseApexClassesFromPackage;
exports.cleanUpFiles = cleanUpFiles;
exports.getDefaultConnectedOrg = getDefaultConnectedOrg;
exports.resolveSfCliPath = resolveSfCliPath;
exports.ensureOrgAliasConnected = ensureOrgAliasConnected;
exports.formatGeneratedAt = formatGeneratedAt;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const fast_xml_parser_1 = require("fast-xml-parser");
const vscode = __importStar(require("vscode"));
const glob = __importStar(require("glob"));
const execa_1 = require("execa");
const i18n_1 = require("../i18n");
let _ctx;
function setExtensionContext(ctx) {
    _ctx = ctx;
}
let globalChannel = null;
let processHandlersRegistered = false;
const ignoredUnhandledPatterns = [/CreateEmbeddingSupplier/i];
const ANSI_ESCAPE_REGEX = /\x1B\[[0-?]*[ -/]*[@-~]/g;
function parseSfJson(output) {
    const text = (output || '').trim();
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        const cleaned = text.replace(ANSI_ESCAPE_REGEX, '');
        if (!cleaned || cleaned === text) {
            return undefined;
        }
        try {
            return JSON.parse(cleaned);
        }
        catch {
            return undefined;
        }
    }
}
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
        const channelName = (0, i18n_1.localize)('channel.uav', 'Unified Apex Validator'); // Localized string
        globalChannel = vscode.window.createOutputChannel(channelName);
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
        console.error((0, i18n_1.localize)('log.utils.storageRootError', '[UAV][getStorageRoot] Error creating directory'), err); // Localized string
    }
    return dir;
}
class Logger {
    logPath;
    outputChannel;
    prefix;
    constructor(prefix, autoShow = false, channelName = (0, i18n_1.localize)('channel.uav', 'Unified Apex Validator')) {
        this.prefix = prefix;
        const storageRoot = getStorageRoot();
        console.log((0, i18n_1.localize)('log.utils.loggerCreating', '[UAV][Logger] Creating logger for {0} at {1}', prefix, storageRoot)); // Localized string
        const logDir = path.join(storageRoot, 'logs');
        try {
            fs.ensureDirSync(logDir);
        }
        catch (err) {
            console.error((0, i18n_1.localize)('log.utils.loggerLogDirError', '[UAV][Logger] Error creating log directory:'), err); // Localized string
        }
        this.logPath = path.join(logDir, `${prefix}.log`);
        this.outputChannel = getGlobalChannel();
        if (!fs.existsSync(this.logPath)) {
            fs.writeFileSync(this.logPath, '\uFEFF', { encoding: 'utf8' });
        }
        if (autoShow) {
            this.outputChannel.show(true);
            console.log((0, i18n_1.localize)('log.utils.loggerShowingChannel', '[UAV][Logger] Showing channel: {0}', channelName)); // Localized string
        }
        // Confirmar rutas
        console.log((0, i18n_1.localize)('log.utils.loggerPath', '[UAV][Logger] logPath={0}', this.logPath)); // Localized string
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
        console.log((0, i18n_1.localize)('log.utils.loggerClearing', '[UAV][Logger] Clearing log: {0}', this.logPath)); // Localized string
        fs.writeFileSync(this.logPath, '\uFEFF', { encoding: 'utf8' });
    }
    write(level, msg) {
        const line = `${new Date().toISOString()} [${level}] [${this.prefix}] ${msg}`;
        try {
            fs.appendFileSync(this.logPath, line + '\n', { encoding: 'utf8' });
        }
        catch (err) {
            console.error((0, i18n_1.localize)('log.utils.loggerWriteError', '[UAV][Logger] Error writing log {0}:', this.logPath), err); // Localized string
        }
        this.outputChannel.appendLine(line);
    }
    debug(msg) { this.write('DEBUG', msg); }
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
        //logger.info(`📦 Leyendo package.xml desde: ${pkgPath}`);
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
        //logger.info(`📂 Buscando clases dentro de: ${repoDir}`);
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
        const noneLabel = (0, i18n_1.localize)('log.utils.none', 'None');
        const testList = testClasses.length ? testClasses.join(', ') : noneLabel;
        const nonTestList = nonTestClasses.length ? nonTestClasses.join(', ') : noneLabel;
        logger.info((0, i18n_1.localize)('log.utils.testClassesDetected', 'Test classes detected ({0}): {1}', testClasses.length, testList)); // Localized string
        logger.info((0, i18n_1.localize)('log.utils.nonTestClassesDetected', 'Non-test classes detected ({0}): {1}', nonTestClasses.length, nonTestList)); // Localized string
        return { testClasses, nonTestClasses };
    }
    catch (err) {
        console.error((0, i18n_1.localize)('log.utils.packageParseError', '[UAV][PackageParser] Error parsing package.xml:'), err);
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
                logger?.info((0, i18n_1.localize)('log.utils.folderCleaned', 'Folder cleaned: {0}', dir)); // Localized string
            }
            else {
                logger?.warn((0, i18n_1.localize)('log.utils.folderMissing', 'Folder not found: {0}', dir)); // Localized string
            }
        }
        catch (err) {
            logger?.warn((0, i18n_1.localize)('log.utils.folderCleanupFailed', 'Unable to clean {0}: {1}', dir, err.message)); // Localized string
        }
    }
}
async function getDefaultConnectedOrg(logger) {
    const sfPath = resolveSfCliPath();
    try {
        const { stdout, stderr } = await (0, execa_1.execa)(sfPath, ['org', 'list', '--json'], {
            env: { ...process.env, FORCE_COLOR: '0' }
        });
        const payload = parseSfJson(stdout) ?? parseSfJson(stderr);
        const result = payload?.result ?? payload;
        if (!result) {
            logger?.warn((0, i18n_1.localize)('log.utils.listOrgsParseFailed', 'Could not parse the output of "sf org list --json".')); // Localized string
            return null;
        }
        const candidates = [];
        if (Array.isArray(result.nonScratchOrgs))
            candidates.push(...result.nonScratchOrgs);
        if (Array.isArray(result.scratchOrgs))
            candidates.push(...result.scratchOrgs);
        const defaultUsername = typeof result.defaultUsername === 'string' ? result.defaultUsername :
            typeof result.defaultDevHubUsername === 'string' ? result.defaultDevHubUsername :
                undefined;
        let selected = candidates.find((org) => org?.isDefaultUsername) ||
            (defaultUsername ? candidates.find((org) => org?.username === defaultUsername) : undefined);
        if (!selected && defaultUsername) {
            selected = { username: defaultUsername };
        }
        if (!selected && candidates.length === 1) {
            selected = candidates[0];
        }
        const username = typeof selected?.username === 'string'
            ? selected.username.trim()
            : typeof defaultUsername === 'string'
                ? defaultUsername.trim()
                : '';
        if (!username) {
            logger?.warn((0, i18n_1.localize)('log.utils.noDefaultOrgFlag', 'No org with isDefaultUsername was detected in Salesforce CLI.')); // Localized string
            return null;
        }
        const alias = typeof selected?.alias === 'string' ? selected.alias.trim() : undefined;
        logger?.info((0, i18n_1.localize)('log.utils.usingDefaultOrg', 'Using Salesforce CLI default org: {0}.', alias || username)); // Localized string
        return {
            alias: alias || undefined,
            username,
            orgId: typeof selected?.orgId === 'string' ? selected.orgId : undefined,
            isDefault: Boolean(selected?.isDefaultUsername)
        };
    }
    catch (err) {
        const reason = err?.shortMessage || err?.stderr || err?.message || String(err);
        logger?.warn((0, i18n_1.localize)('log.utils.defaultOrgLookupFailed', 'Could not obtain the default org from Salesforce CLI: {0}', reason)); // Localized string
        return null;
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
    throw new Error((0, i18n_1.localize)('error.utils.sfCliNotFound', 'Unable to locate Salesforce CLI. Check UnifiedApexValidator.sfCliPath. Attempts: {0}', attempts.join('; ')));
}
async function ensureOrgAliasConnected(alias, logger) {
    const trimmed = (alias || '').trim();
    if (!trimmed) {
        vscode.window.showErrorMessage((0, i18n_1.localize)('error.utils.noDefaultOrgConnected', 'No default org is connected. Run "sf org login web" and try again.')); // Localized string
        return false;
    }
    const sfPath = resolveSfCliPath();
    const checkAlias = async () => {
        try {
            const { stdout, stderr } = await (0, execa_1.execa)(sfPath, ['org', 'display', '--json', '--target-org', trimmed], {
                env: { ...process.env, FORCE_COLOR: '0' }
            });
            const info = parseSfJson(stdout) ?? parseSfJson(stderr);
            if (!info) {
                logger.warn((0, i18n_1.localize)('log.utils.orgDisplayParseFailed', 'Could not parse Salesforce CLI response for org "{0}".', trimmed)); // Localized string
                return false;
            }
            const status = info?.result?.connectedStatus ??
                info?.result?.status ??
                info?.result?.connected;
            const isConnected = (typeof status === 'string' && status.toLowerCase() === 'connected') ||
                status === true ||
                info?.result?.connected === true;
            if (isConnected) {
                //logger.info(`Org "${trimmed}" detectada como conectada.`);
                return true;
            }
            const statusLabel = typeof status === 'string'
                ? status
                : typeof status === 'boolean'
                    ? (status ? (0, i18n_1.localize)('label.utils.connected', 'connected') : (0, i18n_1.localize)('label.utils.disconnected', 'disconnected'))
                    : (0, i18n_1.localize)('label.utils.unknown', 'unknown');
            logger.warn((0, i18n_1.localize)('log.utils.orgStatus', 'Org "{0}" status: {1}.', trimmed, statusLabel)); // Localized string
            return false;
        }
        catch (err) {
            const parsed = parseSfJson(err?.stdout) ?? parseSfJson(err?.stderr);
            if (parsed?.result?.connectedStatus || parsed?.result?.connected) {
                const status = parsed.result.connectedStatus ??
                    parsed.result.connected;
                if ((typeof status === 'string' && status.toLowerCase() === 'connected') || status === true) {
                    logger.info((0, i18n_1.localize)('log.utils.orgReportedConnected', 'Org "{0}" reported as connected.', trimmed)); // Localized string
                    return true;
                }
            }
            const reason = err?.shortMessage || err?.stderr || err?.message || String(err);
            logger.warn((0, i18n_1.localize)('log.utils.orgVerificationFailed', 'Could not verify org "{0}": {1}', trimmed, reason)); // Localized string
            return false;
        }
    };
    if (await checkAlias())
        return true;
    const connectNowOption = (0, i18n_1.localize)('prompt.utils.connectNow', 'Connect now');
    const cancelOption = (0, i18n_1.localize)('prompt.utils.cancel', 'Cancel');
    const warningMessage = (0, i18n_1.localize)('warning.utils.orgAliasNotConnected', 'The org alias "{0}" is not connected in Salesforce CLI. Do you want to connect now?', trimmed);
    const answer = await vscode.window.showWarningMessage(warningMessage, connectNowOption, cancelOption);
    if (answer !== connectNowOption) {
        logger.warn((0, i18n_1.localize)('log.utils.connectionCancelled', 'Validation cancelled because org "{0}" is not connected.', trimmed)); // Localized string
        return false;
    }
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: (0, i18n_1.localize)('progress.utils.connectingOrg', 'Connecting org "{0}"...', trimmed), // Localized string
            cancellable: false
        }, async () => {
            logger.info((0, i18n_1.localize)('log.utils.executingOrgLogin', 'Running "sf org login web --alias {0}". Complete the sign-in process in your browser.', trimmed)); // Localized string
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
        logger.error((0, i18n_1.localize)('log.utils.orgLoginFailed', 'Could not complete login for org "{0}": {1}', trimmed, reason)); // Localized string
        vscode.window.showErrorMessage((0, i18n_1.localize)('error.utils.orgConnectionFailed', 'Failed to connect org "{0}". Check the UAV Output for details.', trimmed)); // Localized string
        return false;
    }
    if (await checkAlias()) {
        vscode.window.showInformationMessage((0, i18n_1.localize)('info.utils.orgConnected', 'Org "{0}" connected successfully.', trimmed)); // Localized string
        return true;
    }
    vscode.window.showErrorMessage((0, i18n_1.localize)('error.utils.orgStillDisconnected', 'Alias "{0}" remains disconnected after the login attempt. Verify your permissions and try again.', trimmed));
    return false;
}
function formatGeneratedAt(date) {
    // Ejemplo: "Oct 19, 2025, 11:53 PM"
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).format(date);
}
