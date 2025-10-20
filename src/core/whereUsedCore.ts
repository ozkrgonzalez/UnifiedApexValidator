import * as path from 'path';
import * as fs from 'fs';

export interface TraceLogger
{
    info(message: string): void;
    warn(message: string): void;
}

export interface WhereUsedEntry
{
    class: string;
    usedBy: {
        Apex: string[];
        Flows: string[];
        LWC: string[];
        Triggers: string[];
        Metadata: string[];
    };
}

export interface WhereUsedCoreOptions
{
    repoDir: string;
    classIdentifiers: string[];
    logger?: TraceLogger;
}

interface UsageBuckets
{
    Apex: Set<string>;
    Flows: Set<string>;
    LWC: Set<string>;
    Triggers: Set<string>;
    Metadata: Set<string>;
}

const IGNORE_DIRECTORIES = new Set([
    'node_modules',
    '.sfdx',
    '.sf',
    'dist',
    'out',
    '.vscode'
]);

const fsPromises = fs.promises;

const silentLogger: TraceLogger = {
    info: () => undefined,
    warn: () => undefined
};

export function collectClassNames(targets: string[]): Set<string>
{
    const names = new Set<string>();

    for (const raw of targets)
    {
        if (!raw) continue;

        const trimmed = raw.trim();
        if (!trimmed) continue;

        const ext = path.extname(trimmed).toLowerCase();
        if (ext === '.cls')
        {
            names.add(path.basename(trimmed, ext));
            continue;
        }

        const segments = trimmed.split(/[\\/]/);
        const last = segments[segments.length - 1];
        if (last.toLowerCase().endsWith('.cls'))
        {
            names.add(last.slice(0, -4));
        }
        else if (last.length)
        {
            names.add(last.replace(/\.\w+$/, ''));
        }
    }

    return names;
}

export async function analyzeWhereUsedCore(options: WhereUsedCoreOptions): Promise<WhereUsedEntry[]>
{
    const logger = options.logger ?? silentLogger;
    const repoDir = path.resolve(options.repoDir);

    if (!options.classIdentifiers?.length)
    {
        throw new Error('No se recibieron clases Apex para analizar.');
    }

    if (!(await pathExists(repoDir)))
    {
        throw new Error(`La ruta configurada no existe: ${repoDir}`);
    }

    const classNames = collectClassNames(options.classIdentifiers);
    if (!classNames.size)
    {
        throw new Error('No fue posible determinar los nombres de clase Apex a partir de la selección.');
    }

    //logger.info(`Clases objetivo: ${Array.from(classNames).join(', ')}`);
    //logger.info(`Repositorio analizado: ${repoDir}`);

    const usageMap = new Map<string, UsageBuckets>();
    for (const cls of classNames)
    {
        usageMap.set(cls, {
            Apex: new Set<string>(),
            Flows: new Set<string>(),
            LWC: new Set<string>(),
            Triggers: new Set<string>(),
            Metadata: new Set<string>()
        });
    }

    const searchRoot = findDefaultRoot(repoDir);

    await scanApexUsage(repoDir, classNames, usageMap, logger);
    await scanTriggerUsage(searchRoot, classNames, usageMap, logger);
    await scanFlowUsage(searchRoot, classNames, usageMap, logger);
    await scanLwcUsage(searchRoot, classNames, usageMap, logger);
    await scanMetadataUsage(searchRoot, classNames, usageMap, logger);

    logger.info('Análisis completado. Preparando resultados.');

    const results: WhereUsedEntry[] = [];
    for (const cls of classNames)
    {
        const buckets = usageMap.get(cls);
        if (!buckets)
        {
            continue;
        }

        results.push({
            class: cls,
            usedBy: {
                Apex: toSortedArray(buckets.Apex),
                Flows: toSortedArray(buckets.Flows),
                LWC: toSortedArray(buckets.LWC),
                Triggers: toSortedArray(buckets.Triggers),
                Metadata: toSortedArray(buckets.Metadata)
            }
        });
    }

    return results;
}

async function scanApexUsage(
    repoDir: string,
    classNames: Set<string>,
    usageMap: Map<string, UsageBuckets>,
    logger: TraceLogger
): Promise<void>
{
    const apexFiles = await collectMatchingFiles(repoDir, (relative) => relative.endsWith('.cls'));

    logger.info(`Escaneando ${apexFiles.length} clases Apex en busca de referencias.`);

    for (const filePath of apexFiles)
    {
        let content: string;
        try
        {
            content = await fsPromises.readFile(filePath, 'utf8');
        }
        catch (err)
        {
            logger.warn(`No se pudo leer ${filePath}: ${(err as Error).message}`);
            continue;
        }

        const normalized = content.replace(/\r\n/g, '\n');

        const referencingName = path.basename(filePath, '.cls');
        const referencingNameLower = referencingName.toLowerCase();
        for (const cls of classNames)
        {
            if (referencingNameLower === cls.toLowerCase())
            {
                continue;
            }

            if (referencesInApex(normalized, cls))
            {
                usageMap.get(cls)?.Apex.add(referencingName);
            }
        }
    }
}

function referencesInApex(body: string, className: string): boolean
{
    const lowerBody = body.toLowerCase();
    const lowerClass = className.toLowerCase();

    if (lowerBody.includes(`extends ${lowerClass}`))
    {
        return true;
    }

    if (lowerBody.includes(`implements ${lowerClass}`)
        || new RegExp(`implements[^;{]*\\b${escapeRegExp(className)}\\b`, 'i').test(body))
    {
        return true;
    }

    const newRegex = new RegExp(`\\bnew\\s+${escapeRegExp(className)}\\b`, 'i');
    const staticCallRegex = new RegExp(`\\b${escapeRegExp(className)}\\s*\\.\\s*[A-Za-z_]\\w*`, 'i');

    return newRegex.test(body) || staticCallRegex.test(body);
}

async function scanTriggerUsage(
    searchRoot: string,
    classNames: Set<string>,
    usageMap: Map<string, UsageBuckets>,
    logger: TraceLogger
): Promise<void>
{
    const triggerFiles = await collectMatchingFiles(searchRoot, (relative) =>
    {
        const normalized = relative.replace(/\\/g, '/');
        if (!normalized.includes('/triggers/'))
        {
            return false;
        }
        return normalized.endsWith('.trigger');
    });

    logger.info(`Escaneando ${triggerFiles.length} triggers.`);

    for (const filePath of triggerFiles)
    {
        let content: string;
        try
        {
            content = await fsPromises.readFile(filePath, 'utf8');
        }
        catch (err)
        {
            logger.warn(`No se pudo leer ${filePath}: ${(err as Error).message}`);
            continue;
        }

        const normalized = content.replace(/\r\n/g, '\n');
        const referencingName = path.basename(filePath, '.trigger');

        for (const cls of classNames)
        {
            if (referencesInTrigger(normalized, cls))
            {
                usageMap.get(cls)?.Triggers.add(referencingName);
            }
        }
    }
}

function referencesInTrigger(body: string, className: string): boolean
{
    const newRegex = new RegExp(`\\bnew\\s+${escapeRegExp(className)}\\b`, 'i');
    const staticCallRegex = new RegExp(`\\b${escapeRegExp(className)}\\s*\\.\\s*[A-Za-z_]\\w*`, 'i');
    return newRegex.test(body) || staticCallRegex.test(body);
}

async function scanFlowUsage(
    searchRoot: string,
    classNames: Set<string>,
    usageMap: Map<string, UsageBuckets>,
    logger: TraceLogger
): Promise<void>
{
    const flowFiles = await collectMatchingFiles(searchRoot, (relative) => relative.endsWith('.flow-meta.xml'));

    if (!flowFiles.length)
    {
        return;
    }

    logger.info(`Escaneando ${flowFiles.length} Flows.`);

    for (const filePath of flowFiles)
    {
        let xml: string;
        try
        {
            xml = await fsPromises.readFile(filePath, 'utf8');
        }
        catch (err)
        {
            logger.warn(`No se pudo leer ${filePath}: ${(err as Error).message}`);
            continue;
        }

        const flowName =
            extractFlowLabel(xml) ||
            stripSuffix(path.basename(filePath), '.flow-meta.xml');

        const lowerXml = xml.toLowerCase();

        for (const cls of classNames)
        {
            if (flowReferencesClass(lowerXml, cls))
            {
                usageMap.get(cls)?.Flows.add(flowName);
            }
        }
    }
}

function extractFlowLabel(xml: string): string | null
{
    const match = xml.match(/<label>([^<]+)<\/label>/i);
    return match ? match[1].trim() : null;
}

function flowReferencesClass(xmlLower: string, className: string): boolean
{
    const lowerClass = className.toLowerCase();
    if (xmlLower.includes(`<apexclass>${lowerClass}</apexclass>`))
    {
        return true;
    }

    if (xmlLower.includes(`apexclass="${lowerClass}"`))
    {
        return true;
    }

    const apexActionPattern = new RegExp(`apexaction[^>]*${escapeRegExp(lowerClass)}`, 'i');
    return apexActionPattern.test(xmlLower);
}

async function scanLwcUsage(
    searchRoot: string,
    classNames: Set<string>,
    usageMap: Map<string, UsageBuckets>,
    logger: TraceLogger
): Promise<void>
{
    //logger.info(`Raíz para búsqueda LWC/Aura: ${searchRoot}`);

    const lwcFiles = await collectMatchingFiles(
        searchRoot,
        (relative) =>
        {
            const normalized = relative.replace(/\\/g, '/');
            const lower = normalized.toLowerCase();
            const inLwc = lower.startsWith('lwc/') || lower.includes('/lwc/');
            const inAura = lower.startsWith('aura/') || lower.includes('/aura/');
            const isLwcController = inLwc && (lower.endsWith('.js') || lower.endsWith('.ts'));
            const isAuraController = inAura && lower.endsWith('.js');

            return isLwcController || isAuraController;
        }
    );
    if (!lwcFiles.length)
    {
        await logLwcDirectories(searchRoot, logger);
        logger.info('Escaneando 0 archivos LWC/Aura.');
        return;
    }

    logger.info(`Escaneando ${lwcFiles.length} archivos LWC/Aura.`);
    const samplePaths = lwcFiles.slice(0, Math.min(lwcFiles.length, 5))
        .map((file) => path.relative(searchRoot, file) || path.basename(file));
    //logger.info(`Ejemplos LWC/Aura: ${samplePaths.join(', ')}`);

    for (const filePath of lwcFiles)
    {
        let content: string;
        try
        {
            content = await fsPromises.readFile(filePath, 'utf8');
        }
        catch (err)
        {
            logger.warn(`No se pudo leer ${filePath}: ${(err as Error).message}`);
            continue;
        }

        const relativePath = path.relative(searchRoot, filePath) || path.basename(filePath);
        const importMatches = content.match(/@salesforce\/apex\/[A-Za-z0-9_.]+\.[A-Za-z_]\w*/g);
        if (importMatches?.length)
        {
            logger.info(`LWC "${relativePath}" contiene imports Apex: ${importMatches.join(', ')}`);
        }

        const componentName = deriveLwcComponentName(filePath);
        if (!componentName)
        {
            continue;
        }

        for (const cls of classNames)
        {
            if (referencesInLwc(content, cls))
            {
                usageMap.get(cls)?.LWC.add(componentName);
                logger.info(`LWC "${componentName}" referencia ${cls}.`);
            }
        }
    }
}

function deriveLwcComponentName(filePath: string): string | null
{
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    const lwcIndex = segments.lastIndexOf('lwc');
    if (lwcIndex === -1 || lwcIndex + 1 >= segments.length)
    {
        return null;
    }

    return segments[lwcIndex + 1];
}

function referencesInLwc(content: string, className: string): boolean
{
    const apexImport = new RegExp(`@salesforce/apex/(?:[A-Za-z0-9_]+\\.)?${escapeRegExp(className)}\\.[A-Za-z_]\\w*`, 'i');

    if (apexImport.test(content))
    {
        return true;
    }

    const auraAction = new RegExp(`c\\.${escapeRegExp(className)}\\b`, 'i');
    return auraAction.test(content);
}

async function scanMetadataUsage(
    searchRoot: string,
    classNames: Set<string>,
    usageMap: Map<string, UsageBuckets>,
    logger: TraceLogger
): Promise<void>
{
    const metadataFiles = await collectMatchingFiles(
        searchRoot,
        (relative) =>
            relative.endsWith('.flexipage-meta.xml') || relative.endsWith('.permissionset-meta.xml')
    );

    if (!metadataFiles.length)
    {
        return;
    }

    logger.info(`Escaneando ${metadataFiles.length} archivos de metadatos.`);

    for (const filePath of metadataFiles)
    {
        let content: string;
        try
        {
            content = await fsPromises.readFile(filePath, 'utf8');
        }
        catch (err)
        {
            logger.warn(`No se pudo leer ${filePath}: ${(err as Error).message}`);
            continue;
        }

        const displayName = path.basename(filePath);
        const lowerContent = content.toLowerCase();

        for (const cls of classNames)
        {
            const lowerClass = cls.toLowerCase();
            if (
                lowerContent.includes(`<apexclass>${lowerClass}</apexclass>`) ||
                lowerContent.includes(`apexclass="${lowerClass}"`)
            )
            {
                usageMap.get(cls)?.Metadata.add(displayName);
            }
        }
    }
}

function toSortedArray(set: Set<string>): string[]
{
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value: string): string
{
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSuffix(value: string, suffix: string): string
{
    if (value.endsWith(suffix))
    {
        return value.slice(0, value.length - suffix.length);
    }
    return value;
}

async function pathExists(targetPath: string): Promise<boolean>
{
    try
    {
        await fsPromises.access(targetPath, fs.constants.F_OK);
        return true;
    }
    catch
    {
        return false;
    }
}

async function collectMatchingFiles(
    baseDir: string,
    predicate: (relativePath: string) => boolean
): Promise<string[]>
{
    const results: string[] = [];
    await walkDirectory(baseDir, '', predicate, results);
    return results;
}

async function walkDirectory(
    baseDir: string,
    relativeDir: string,
    predicate: (relativePath: string) => boolean,
    results: string[]
): Promise<void>
{
    const currentDir = relativeDir ? path.join(baseDir, relativeDir) : baseDir;
    let entries: fs.Dirent[];

    try
    {
        entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    }
    catch
    {
        return;
    }

    for (const entry of entries)
    {
        const entryRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
        const fullPath = path.join(baseDir, entryRelative);

        if (entry.isDirectory())
        {
            if (IGNORE_DIRECTORIES.has(entry.name))
            {
                continue;
            }
            await walkDirectory(baseDir, entryRelative, predicate, results);
        }
        else if (entry.isFile())
        {
            if (predicate(entryRelative))
            {
                results.push(fullPath);
            }
        }
    }
}

async function logLwcDirectories(baseDir: string, logger: TraceLogger): Promise<void>
{
    const lwcRoot = path.join(baseDir, 'lwc');
    const auraRoot = path.join(baseDir, 'aura');

    const lwcExists = await pathExists(lwcRoot);
    const auraExists = await pathExists(auraRoot);

    //logger.warn(`Directorio LWC esperado: ${lwcRoot} (${lwcExists ? 'existe' : 'no existe'})`);
    //logger.warn(`Directorio Aura esperado: ${auraRoot} (${auraExists ? 'existe' : 'no existe'})`);

    if (lwcExists)
    {
        const samples = await listSubdirectories(lwcRoot, 5);
        if (samples.length)
        {
            logger.warn(`Componentes LWC detectados: ${samples.join(', ')}`);
        }
    }

    if (auraExists)
    {
        const samples = await listSubdirectories(auraRoot, 5);
        if (samples.length)
        {
            logger.warn(`Bundles Aura detectados: ${samples.join(', ')}`);
        }
    }
}

async function listSubdirectories(dir: string, limit: number): Promise<string[]>
{
    try
    {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .slice(0, limit)
            .map((entry) => entry.name);
    }
    catch
    {
        return [];
    }
}

function findDefaultRoot(classesDir: string): string
{
    const dir = path.resolve(classesDir);
    const parent = path.dirname(dir);
    return parent;
}



