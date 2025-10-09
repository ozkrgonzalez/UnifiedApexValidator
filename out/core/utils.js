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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.setExtensionContext = setExtensionContext;
exports.getGlobalChannel = getGlobalChannel;
exports.getStorageRoot = getStorageRoot;
exports.parseApexClassesFromPackage = parseApexClassesFromPackage;
exports.cleanUpFiles = cleanUpFiles;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const fast_xml_parser_1 = require("fast-xml-parser");
const vscode = __importStar(require("vscode"));
const glob_1 = __importDefault(require("glob"));
let _ctx;
function setExtensionContext(ctx) {
    console.log('[UAV][setExtensionContext] ExtensionContext recibido:', !!ctx);
    console.log('[UAV][setExtensionContext] globalStorageUri:', ctx?.globalStorageUri?.fsPath);
    _ctx = ctx;
}
let globalChannel = null;
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
    console.log('[UAV][getStorageRoot] Base path:', base);
    console.log('[UAV][getStorageRoot] Dir path:', dir);
    try {
        fs.ensureDirSync(dir);
    }
    catch (err) {
        console.error('[UAV][getStorageRoot] ❌ Error creando directorio', err);
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
            console.error('[UAV][Logger] ❌ Error creando carpeta de logs:', err);
        }
        this.logPath = path.join(logDir, `${prefix}.log`);
        //this.outputChannel = vscode.window.createOutputChannel(channelName);
        this.outputChannel = getGlobalChannel();
        if (autoShow) {
            this.outputChannel.show(true);
            console.log(`[UAV][Logger] Mostrando canal: ${channelName}`);
        }
        // Confirmar rutas
        console.log(`[UAV][Logger] logPath=${this.logPath}`);
        process.on('uncaughtException', (err) => this.error(`Uncaught Exception: ${err.message}`));
        process.on('unhandledRejection', (reason) => this.error(`Unhandled Rejection: ${reason}`));
    }
    clear() {
        console.log(`[UAV][Logger] Limpiando log: ${this.logPath}`);
        fs.writeFileSync(this.logPath, '');
    }
    write(level, msg) {
        const line = `${new Date().toISOString()} [${level}] [${this.prefix}] ${msg}`;
        try {
            fs.appendFileSync(this.logPath, line + '\n');
        }
        catch (err) {
            console.error(`[UAV][Logger] ❌ Error escribiendo log ${this.logPath}:`, err);
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
        logger.info(`📦 Leyendo package.xml desde: ${pkgPath}`);
        const xml = await fs.readFile(pkgPath, 'utf8');
        const parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false });
        const json = parser.parse(xml);
        //logger.info(`🧩 Estructura JSON parseada: ${JSON.stringify(json?.Package?.types, null, 2)}`);
        const types = json?.Package?.types || [];
        const apexTypes = Array.isArray(types)
            ? types.find((t) => t.name === 'ApexClass')
            : types.name === 'ApexClass'
                ? types
                : null;
        /*if (!apexTypes)
          {
          logger.warn('❌ No se encontraron tipos ApexClass en package.xml');
          throw new Error('No se encontraron clases Apex en package.xml');
        }*/
        const members = Array.isArray(apexTypes.members) ? apexTypes.members : [apexTypes.members];
        logger.info(`📄 Miembros detectados (${members.length}): ${members.join(', ')}`);
        const testClasses = [];
        const nonTestClasses = [];
        logger.info(`📁 Buscando clases dentro de: ${repoDir}`);
        for (const cls of members) {
            const matches = glob_1.default.sync(`**/${cls}.cls`, { cwd: repoDir, absolute: true });
            logger.info(`🔍 Buscando ${cls}.cls → encontrados: ${matches.length}`);
            if (!matches.length)
                continue;
            const content = await fs.readFile(matches[0], 'utf8');
            if (/@istest/i.test(content)) {
                logger.info(`✅ ${cls} marcada como clase de prueba`);
                testClasses.push(cls);
            }
            else {
                logger.info(`ℹ️ ${cls} no es clase de prueba`);
                nonTestClasses.push(cls);
            }
        }
        logger.info(`🧪 Clases de prueba detectadas (${testClasses.length}): ${testClasses.join(', ') || 'Ninguna'}`);
        logger.info(`📘 Clases normales detectadas (${nonTestClasses.length}): ${nonTestClasses.join(', ') || 'Ninguna'}`);
        return { testClasses, nonTestClasses };
    }
    catch (err) {
        console.error('[UAV][PackageParser] ❌ Error parseando package.xml:', err);
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
                logger?.info(`🧹 Carpeta limpiada: ${dir}`);
            }
            else {
                logger?.warn(`⚠️ Carpeta no encontrada: ${dir}`);
            }
        }
        catch (err) {
            logger?.warn(`❌ No se pudo limpiar ${dir}: ${err.message}`);
        }
    }
}
