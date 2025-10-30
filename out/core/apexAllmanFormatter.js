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
exports.applyAllmanStyleToCode = applyAllmanStyleToCode;
exports.formatApexAllman = formatApexAllman;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const url_1 = require("url");
const utils_1 = require("./utils");
const logger = new utils_1.Logger('apexAllmanFormatter');
patchWindowsBatSpawn();
let prettierInstance = null;
let apexPluginPathCache = null;
let windowsBatSpawnPatched = false;
function patchWindowsBatSpawn() {
    if (process.platform !== 'win32') {
        return;
    }
    const childProcess = require('child_process');
    if (windowsBatSpawnPatched) {
        return;
    }
    const originalSpawn = childProcess.spawn;
    const originalSpawnSync = childProcess.spawnSync;
    const spawnAny = originalSpawn;
    const spawnSyncAny = originalSpawnSync;
    const ensureShellTrue = (command, options) => typeof command === 'string' &&
        command.toLowerCase().endsWith('.bat') &&
        (!options || options.shell !== true);
    const patchedSpawn = function patchedSpawn(...spawnArgs) {
        const [command, maybeArgs, maybeOptions] = spawnArgs;
        if (Array.isArray(maybeArgs)) {
            if (ensureShellTrue(command, maybeOptions)) {
                const patchedOptions = { ...(maybeOptions ?? {}), shell: true };
                return spawnAny.call(this, command, maybeArgs, patchedOptions);
            }
        }
        else if (ensureShellTrue(command, maybeArgs)) {
            const patchedOptions = { ...(maybeArgs ?? {}), shell: true };
            return spawnAny.call(this, command, patchedOptions);
        }
        return spawnAny.apply(this, spawnArgs);
    };
    const patchedSpawnSync = function patchedSpawnSync(...spawnArgs) {
        const [command, maybeArgs, maybeOptions] = spawnArgs;
        if (Array.isArray(maybeArgs)) {
            if (ensureShellTrue(command, maybeOptions)) {
                const patchedOptions = { ...(maybeOptions ?? {}), shell: true };
                return spawnSyncAny.call(this, command, maybeArgs, patchedOptions);
            }
        }
        else if (ensureShellTrue(command, maybeArgs)) {
            const patchedOptions = { ...(maybeArgs ?? {}), shell: true };
            return spawnSyncAny.call(this, command, patchedOptions);
        }
        return spawnSyncAny.apply(this, spawnArgs);
    };
    childProcess.spawn = patchedSpawn;
    childProcess.spawnSync = patchedSpawnSync;
    windowsBatSpawnPatched = true;
    logger.info('Parche aplicado para ejecutar .bat con shell=true en child_process.');
}
async function loadPrettier(hints = []) {
    if (prettierInstance) {
        return prettierInstance;
    }
    const resolved = resolveModule('prettier', hints);
    if (!resolved) {
        logger.error('No se pudo resolver el modulo prettier en el workspace.');
        throw new Error('No se pudo cargar "prettier". Instala prettier en tu workspace.');
    }
    try {
        const mod = await Promise.resolve(`${(0, url_1.pathToFileURL)(resolved).href}`).then(s => __importStar(require(s)));
        prettierInstance = mod.default ?? mod;
        logger.info(`Prettier cargado desde ${resolved}.`);
        return prettierInstance;
    }
    catch (err) {
        logger.error(`Error importando Prettier desde ${resolved}: ${err}`);
        throw new Error('No se pudo cargar "prettier". Instala prettier en tu workspace.');
    }
}
function resolveApexPlugin(hints = []) {
    if (apexPluginPathCache) {
        return apexPluginPathCache;
    }
    const resolved = resolveModule('prettier-plugin-apex', hints);
    if (!resolved) {
        logger.error('No se encontro prettier-plugin-apex en el workspace.');
        throw new Error('No se encontro "prettier-plugin-apex". Instala prettier prettier-plugin-apex.');
    }
    apexPluginPathCache = resolved;
    logger.info(`Plugin prettier-plugin-apex localizado en ${resolved}.`);
    return apexPluginPathCache;
}
function resolveModule(moduleName, additionalPaths = []) {
    const searchPaths = new Set();
    for (const hint of additionalPaths) {
        searchPaths.add(hint);
        searchPaths.add(path.join(hint, 'node_modules'));
    }
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            searchPaths.add(folder.uri.fsPath);
            searchPaths.add(path.join(folder.uri.fsPath, 'node_modules'));
        }
    }
    searchPaths.add(process.cwd());
    searchPaths.add(__dirname);
    try {
        return require.resolve(moduleName, { paths: Array.from(searchPaths) });
    }
    catch (error) {
        logger.debug(`No se pudo resolver ${moduleName} con rutas personalizadas: ${error}`);
        return null;
    }
}
async function formatWithPrettier(source, spacesPerTab, hints) {
    const prettier = await loadPrettier(hints);
    const pluginPath = resolveApexPlugin(hints);
    return await prettier.format(source, {
        parser: 'apex',
        plugins: [pluginPath],
        tabWidth: spacesPerTab,
        useTabs: false,
        printWidth: 100
    });
}
function convertToAllmanStyle(code) {
    const lines = code.replace(/\r\n/g, '\n').split('\n');
    const result = [];
    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, '');
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            result.push('');
            continue;
        }
        const elseIfMatch = line.match(/^(\s*)\}\s+else\s+if\b(.*)\{\s*$/i);
        if (elseIfMatch) {
            const indent = elseIfMatch[1];
            const condition = elseIfMatch[2].replace(/\s*\{\s*$/, '').trimEnd();
            result.push(`${indent}}`);
            result.push(`${indent}else if${condition}`);
            result.push(`${indent}{`);
            continue;
        }
        const elseMatch = line.match(/^(\s*)\}\s+else\s*\{\s*$/i);
        if (elseMatch) {
            const indent = elseMatch[1];
            result.push(`${indent}}`);
            result.push(`${indent}else`);
            result.push(`${indent}{`);
            continue;
        }
        const catchMatch = line.match(/^(\s*)\}\s+(catch|finally)\b(.*)\{\s*$/i);
        if (catchMatch) {
            const indent = catchMatch[1];
            const keyword = catchMatch[2];
            const suffix = catchMatch[3].replace(/\s*\{\s*$/, '').trimEnd();
            result.push(`${indent}}`);
            result.push(`${indent}${keyword}${suffix}`);
            result.push(`${indent}{`);
            continue;
        }
        const openBraceMatch = line.match(/^(\s*)(.+?)\s*\{\s*$/);
        if (openBraceMatch) {
            const indent = openBraceMatch[1];
            const statement = openBraceMatch[2].replace(/\s+$/, '');
            if (statement.trim() === '{') {
                result.push(`${indent}{`);
            }
            else {
                result.push(`${indent}${statement}`);
                result.push(`${indent}{`);
            }
            continue;
        }
        result.push(line);
    }
    const formatted = result.join('\n').replace(/\n{3,}/g, '\n\n');
    return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
}
async function applyAllmanStyleToCode(source, spacesPerTab = 4, hints = []) {
    logger.info('Formateando codigo Apex en memoria.');
    const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const prettified = await formatWithPrettier(normalized, spacesPerTab, hints);
    return convertToAllmanStyle(prettified);
}
async function applyAllmanStyleToFile(filePath, hints) {
    logger.info(`Procesando archivo ${filePath}.`);
    const original = await fs.promises.readFile(filePath, 'utf8');
    const localHints = [path.dirname(filePath), ...hints];
    const formatted = await applyAllmanStyleToCode(original, 4, localHints);
    if (formatted.trim().length === 0) {
        logger.warn(`El archivo ${filePath} quedo vacio tras el formateo. Se omite.`);
        return false;
    }
    const usesWindowsNewlines = /\r\n/.test(original);
    const finalOutput = usesWindowsNewlines ? formatted.replace(/\n/g, '\r\n') : formatted;
    if (finalOutput === original) {
        logger.debug(`El archivo ${filePath} no requiere cambios.`);
        return false;
    }
    await fs.promises.writeFile(filePath, finalOutput, 'utf8');
    return true;
}
function gatherTargets(target, selected) {
    if (selected && selected.length > 0) {
        return selected;
    }
    if (target) {
        return [target];
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        return [editor.document.uri];
    }
    return [];
}
function collectFilesFromUri(uri) {
    const files = [];
    const stats = fs.statSync(uri.fsPath);
    if (stats.isDirectory()) {
        for (const entry of fs.readdirSync(uri.fsPath)) {
            const childPath = path.join(uri.fsPath, entry);
            files.push(...collectFilesFromUri(vscode.Uri.file(childPath)));
        }
    }
    else if (uri.fsPath.endsWith('.cls') || uri.fsPath.endsWith('.trigger')) {
        files.push(uri.fsPath);
    }
    return files;
}
async function formatApexAllman(target, selected) {
    logger.info('Comando de formateo Allman invocado.');
    const targets = gatherTargets(target, selected);
    if (targets.length === 0) {
        void vscode.window.showInformationMessage('Selecciona un archivo Apex o una carpeta para aplicar el formato.');
        return;
    }
    logger.debug(`Targets recibidos: ${targets.map((t) => t.fsPath).join(', ') || 'ninguno'}.`);
    const files = targets.flatMap(collectFilesFromUri);
    if (files.length === 0) {
        void vscode.window.showInformationMessage('No se encontraron archivos .cls o .trigger en la seleccion.');
        return;
    }
    logger.info(`Archivos a procesar: ${files.length}.`);
    const hintPaths = new Set();
    for (const file of files) {
        const dir = path.dirname(file);
        hintPaths.add(dir);
    }
    const hints = Array.from(hintPaths);
    let updated = 0;
    for (const filePath of files) {
        try {
            const changed = await applyAllmanStyleToFile(filePath, hints);
            if (changed) {
                updated++;
                logger.info(`Archivo formateado: ${filePath}`);
            }
            else {
                logger.debug(`Sin cambios en: ${filePath}`);
            }
        }
        catch (err) {
            logger.error(`Error formateando ${filePath}: ${err?.message || err}`);
            void vscode.window.showErrorMessage(`Error formateando ${path.basename(filePath)}: ${err.message}`);
        }
    }
    if (updated === 0) {
        void vscode.window.showInformationMessage('No se realizaron cambios en los archivos seleccionados.');
        return;
    }
    void vscode.window.showInformationMessage(`Formato Allman aplicado a ${updated} archivo(s) Apex.`);
}
