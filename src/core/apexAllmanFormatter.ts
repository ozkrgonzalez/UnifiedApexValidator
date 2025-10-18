import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { pathToFileURL } from 'url';
import { Logger } from './utils';

const logger = new Logger('apexAllmanFormatter');

let prettierInstance: (typeof import('prettier')) | null = null;
let apexPluginPathCache: string | null = null;

async function loadPrettier(hints: string[] = []): Promise<typeof import('prettier')>
{
    if (prettierInstance)
    {
        return prettierInstance!;
    }

    const resolved = resolveModule('prettier', hints);
    if (!resolved)
    {
        logger.error('No se pudo resolver el modulo prettier en el workspace.');
        throw new Error('No se pudo cargar "prettier". Instala prettier en tu workspace.');
    }

    try
    {
        const mod = await import(pathToFileURL(resolved).href);
        prettierInstance = (mod as any).default ?? (mod as any);
        logger.info(`Prettier cargado desde ${resolved}.`);
        return prettierInstance!;
    }
    catch (err)
    {
        logger.error(`Error importando Prettier desde ${resolved}: ${err}`);
        throw new Error('No se pudo cargar "prettier". Instala prettier en tu workspace.');
    }
}

function resolveApexPlugin(hints: string[] = []): string
{
    if (apexPluginPathCache)
    {
        return apexPluginPathCache;
    }

    const resolved = resolveModule('prettier-plugin-apex', hints);
    if (!resolved)
    {
        logger.error('No se encontro prettier-plugin-apex en el workspace.');
        throw new Error('No se encontro "prettier-plugin-apex". Instala prettier prettier-plugin-apex.');
    }

    apexPluginPathCache = resolved;
    logger.info(`Plugin prettier-plugin-apex localizado en ${resolved}.`);
    return apexPluginPathCache;
}

function resolveModule(moduleName: string, additionalPaths: string[] = []): string | null
{
    const searchPaths = new Set<string>();

    for (const hint of additionalPaths)
    {
        searchPaths.add(hint);
        searchPaths.add(path.join(hint, 'node_modules'));
    }

    if (vscode.workspace.workspaceFolders)
    {
        for (const folder of vscode.workspace.workspaceFolders)
        {
            searchPaths.add(folder.uri.fsPath);
            searchPaths.add(path.join(folder.uri.fsPath, 'node_modules'));
        }
    }

    searchPaths.add(process.cwd());
    searchPaths.add(__dirname);

    try
    {
        return require.resolve(moduleName, { paths: Array.from(searchPaths) });
    }
    catch (error)
    {
        logger.debug(`No se pudo resolver ${moduleName} con rutas personalizadas: ${error}`);
        return null;
    }
}

async function formatWithPrettier(source: string, spacesPerTab: number, hints: string[]): Promise<string>
{
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

function convertToAllmanStyle(code: string): string
{
    const lines = code.replace(/\r\n/g, '\n').split('\n');
    const result: string[] = [];

    for (const rawLine of lines)
    {
        const line = rawLine.replace(/\s+$/, '');
        const trimmed = line.trim();

        if (trimmed.length === 0)
        {
            result.push('');
            continue;
        }

        const elseIfMatch = line.match(/^(\s*)\}\s+else\s+if\b(.*)\{\s*$/i);
        if (elseIfMatch)
        {
            const indent = elseIfMatch[1];
            const condition = elseIfMatch[2].replace(/\s*\{\s*$/, '').trimEnd();
            result.push(`${indent}}`);
            result.push(`${indent}else if${condition}`);
            result.push(`${indent}{`);
            continue;
        }

        const elseMatch = line.match(/^(\s*)\}\s+else\s*\{\s*$/i);
        if (elseMatch)
        {
            const indent = elseMatch[1];
            result.push(`${indent}}`);
            result.push(`${indent}else`);
            result.push(`${indent}{`);
            continue;
        }

        const catchMatch = line.match(/^(\s*)\}\s+(catch|finally)\b(.*)\{\s*$/i);
        if (catchMatch)
        {
            const indent = catchMatch[1];
            const keyword = catchMatch[2];
            const suffix = catchMatch[3].replace(/\s*\{\s*$/, '').trimEnd();
            result.push(`${indent}}`);
            result.push(`${indent}${keyword}${suffix}`);
            result.push(`${indent}{`);
            continue;
        }

        const openBraceMatch = line.match(/^(\s*)(.+?)\s*\{\s*$/);
        if (openBraceMatch)
        {
            const indent = openBraceMatch[1];
            const statement = openBraceMatch[2].replace(/\s+$/, '');
            if (statement.trim() === '{')
            {
                result.push(`${indent}{`);
            }
            else
            {
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

export async function applyAllmanStyleToCode(source: string, spacesPerTab = 4, hints: string[] = []): Promise<string>
{
    logger.info('Formateando codigo Apex en memoria.');
    const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const prettified = await formatWithPrettier(normalized, spacesPerTab, hints);
    return convertToAllmanStyle(prettified);
}

async function applyAllmanStyleToFile(filePath: string, hints: string[]): Promise<boolean>
{
    logger.info(`Procesando archivo ${filePath}.`);
    const original = await fs.promises.readFile(filePath, 'utf8');
    const localHints = [path.dirname(filePath), ...hints];
    const formatted = await applyAllmanStyleToCode(original, 4, localHints);
    if (formatted.trim().length === 0)
    {
        logger.warn(`El archivo ${filePath} quedo vacio tras el formateo. Se omite.`);
        return false;
    }

    const usesWindowsNewlines = /\r\n/.test(original);
    const finalOutput = usesWindowsNewlines ? formatted.replace(/\n/g, '\r\n') : formatted;
    if (finalOutput === original)
    {
        logger.debug(`El archivo ${filePath} no requiere cambios.`);
        return false;
    }

    await fs.promises.writeFile(filePath, finalOutput, 'utf8');
    return true;
}

function gatherTargets(target: vscode.Uri | undefined, selected: vscode.Uri[] | undefined): vscode.Uri[]
{
    if (selected && selected.length > 0)
    {
        return selected;
    }

    if (target)
    {
        return [target];
    }

    const editor = vscode.window.activeTextEditor;
    if (editor)
    {
        return [editor.document.uri];
    }

    return [];
}

function collectFilesFromUri(uri: vscode.Uri): string[]
{
    const files: string[] = [];
    const stats = fs.statSync(uri.fsPath);

    if (stats.isDirectory())
    {
        for (const entry of fs.readdirSync(uri.fsPath))
        {
            const childPath = path.join(uri.fsPath, entry);
            files.push(...collectFilesFromUri(vscode.Uri.file(childPath)));
        }
    }
    else if (uri.fsPath.endsWith('.cls') || uri.fsPath.endsWith('.trigger'))
    {
        files.push(uri.fsPath);
    }

    return files;
}

export async function formatApexAllman(
    target: vscode.Uri | undefined,
    selected: vscode.Uri[] | undefined
): Promise<void>
{
    logger.info('Comando de formateo Allman invocado.');

    const targets = gatherTargets(target, selected);
    if (targets.length === 0)
    {
        void vscode.window.showInformationMessage('Selecciona un archivo Apex o una carpeta para aplicar el formato.');
        return;
    }

    logger.debug(`Targets recibidos: ${targets.map((t) => t.fsPath).join(', ') || 'ninguno'}.`);

    const files = targets.flatMap(collectFilesFromUri);
    if (files.length === 0)
    {
        void vscode.window.showInformationMessage('No se encontraron archivos .cls o .trigger en la seleccion.');
        return;
    }

    logger.info(`Archivos a procesar: ${files.length}.`);

    const hintPaths = new Set<string>();
    for (const file of files)
    {
        const dir = path.dirname(file);
        hintPaths.add(dir);
    }

    const hints = Array.from(hintPaths);

    let updated = 0;
    for (const filePath of files)
    {
        try
        {
            const changed = await applyAllmanStyleToFile(filePath, hints);
            if (changed)
            {
                updated++;
                logger.info(`Archivo formateado: ${filePath}`);
            }
            else
            {
                logger.debug(`Sin cambios en: ${filePath}`);
            }
        }
        catch (err: any)
        {
            logger.error(`Error formateando ${filePath}: ${err?.message || err}`);
            void vscode.window.showErrorMessage(`Error formateando ${path.basename(filePath)}: ${err.message}`);
        }
    }

    if (updated === 0)
    {
        void vscode.window.showInformationMessage('No se realizaron cambios en los archivos seleccionados.');
        return;
    }

    void vscode.window.showInformationMessage(`Formato Allman aplicado a ${updated} archivo(s) Apex.`);
}
