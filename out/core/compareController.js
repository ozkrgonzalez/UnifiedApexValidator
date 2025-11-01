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
exports.runCompareApexClasses = runCompareApexClasses;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const Diff = __importStar(require("diff"));
const execa_1 = require("execa");
const utils_1 = require("./utils");
const i18n_1 = require("../i18n");
const reportGenerator_1 = require("./reportGenerator");
function normalizeForComparison(source) {
    return source
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trim();
}
async function fallbackRetrieveApexClasses(classNames, orgAlias, fallbackDir, logger) {
    const retrievedNames = new Set();
    if (!classNames.length) {
        return retrievedNames;
    }
    await fs.ensureDir(fallbackDir);
    await fs.emptyDir(fallbackDir);
    const chunkSize = 100;
    for (let i = 0; i < classNames.length; i += chunkSize) {
        const chunk = classNames.slice(i, i + chunkSize);
        const inClause = chunk
            .map(name => `'${name.replace(/'/g, "\\'")}'`)
            .join(', ');
        const query = `SELECT Name, Body FROM ApexClass WHERE Name IN (${inClause})`;
        logger.info((0, i18n_1.localize)('log.compareController.fallbackQuery', '🪄 Fallback query (Tooling API): {0}', query)); // Localized string
        try {
            const { stdout } = await (0, execa_1.execa)('sf', ['data', 'query', '--query', query, '--target-org', orgAlias, '--use-tooling-api', '--json'], { env: { ...process.env, FORCE_COLOR: '0' } });
            const parsed = JSON.parse(stdout);
            const records = parsed?.result?.records;
            if (!Array.isArray(records) || records.length === 0) {
                logger.warn((0, i18n_1.localize)('log.compareController.fallbackNoResults', '⚠️ Fallback returned no results for this batch of classes.')); // Localized string
                continue;
            }
            for (const record of records) {
                const name = record?.Name;
                const body = record?.Body;
                if (typeof name !== 'string' || typeof body !== 'string') {
                    logger.warn((0, i18n_1.localize)('log.compareController.invalidApexRecord', '⚠️ ApexClass record missing a valid Name or Body, skipping.')); // Localized string
                    continue;
                }
                const targetPath = path.join(fallbackDir, `${name}.cls`);
                await fs.writeFile(targetPath, body, 'utf8');
                retrievedNames.add(name);
                logger.info((0, i18n_1.localize)('log.compareController.fallbackRetrievedClass', '✅ Class {0} retrieved via fallback.', name)); // Localized string
            }
        }
        catch (error) {
            logger.error((0, i18n_1.localize)('log.compareController.fallbackError', '❌ Error executing fallback query: {0}', error.message)); // Localized string
            if (error.stdout)
                logger.error((0, i18n_1.localize)('log.compareController.fallbackStdout', '📄 STDOUT: {0}', error.stdout)); // Localized string
            if (error.stderr)
                logger.error((0, i18n_1.localize)('log.compareController.fallbackStderr', '⚠️ STDERR: {0}', error.stderr)); // Localized string
        }
    }
    if (!retrievedNames.size) {
        logger.error((0, i18n_1.localize)('log.compareController.fallbackNoClasses', '❌ No classes could be retrieved via fallback ApexClass.Body.')); // Localized string
    }
    return retrievedNames;
}
async function runCompareApexClasses(uri) {
    const logger = new utils_1.Logger('compareController', true);
    logger.info((0, i18n_1.localize)('log.compareController.start', '🚀 Starting class comparison...')); // Localized string
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        vscode.window.showErrorMessage((0, i18n_1.localize)('error.compareController.noWorkspace', 'No workspace is open.')); // Localized string
        logger.error((0, i18n_1.localize)('log.compareController.noWorkspace', '❌ No active workspace detected.')); // Localized string
        return;
    }
    const baseDir = workspace.uri.fsPath;
    const settings = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const repoDir = settings.get('sfRepositoryDir') || '';
    const outputDir = settings.get('outputDir') || path.join(baseDir, 'output');
    logger.info((0, i18n_1.localize)('log.compareController.workspacePath', '📁 Workspace: {0}', baseDir)); // Localized string
    logger.info((0, i18n_1.localize)('log.compareController.repoPath', '📦 Configured repository: {0}', repoDir)); // Localized string
    logger.info((0, i18n_1.localize)('log.compareController.outputPath', '📂 Output folder: {0}', outputDir)); // Localized string
    // 🧩 Detectar archivo origen
    let classNames = [];
    if (uri && uri.fsPath.endsWith('.xml')) {
        logger.info((0, i18n_1.localize)('log.compareController.analyzingPackageXml', '🧩 Analyzing package.xml: {0}', uri.fsPath)); // Localized string
        const { testClasses, nonTestClasses } = await (0, utils_1.parseApexClassesFromPackage)(uri.fsPath, repoDir);
        classNames = [...testClasses, ...nonTestClasses];
    }
    else if (uri && uri.fsPath.endsWith('.cls')) {
        const className = path.basename(uri.fsPath, '.cls');
        logger.info((0, i18n_1.localize)('log.compareController.singleClass', '📘 Comparing a single class: {0}', className)); // Localized string
        classNames = [className];
    }
    else {
        vscode.window.showWarningMessage((0, i18n_1.localize)('warning.compareController.selectSource', 'Open a package.xml or .cls file to compare.')); // Localized string
        logger.warn((0, i18n_1.localize)('log.compareController.invalidSelection', '⚠️ Command executed without a valid .xml or .cls file.')); // Localized string
        return;
    }
    if (classNames.length === 0) {
        vscode.window.showWarningMessage((0, i18n_1.localize)('warning.compareController.noClassesFound', 'No Apex classes were found in the selected file.')); // Localized string
        logger.warn((0, i18n_1.localize)('log.compareController.noClassesFound', '⚠️ No Apex classes were found in the selected file.')); // Localized string
        return;
    }
    // 🔍 Listar orgs conectadas
    logger.info((0, i18n_1.localize)('log.compareController.listingOrgs', '🔍 Listing Salesforce CLI connected orgs...')); // Localized string
    const { stdout: orgListJson } = await (0, execa_1.execa)('sf', ['org', 'list', '--json'], {
        env: { ...process.env, FORCE_COLOR: '0' }
    });
    const orgList = JSON.parse(orgListJson).result.nonScratchOrgs
        .filter((o) => o.connectedStatus === 'Connected')
        .map((o) => o.alias || o.username);
    if (!orgList.length) {
        vscode.window.showErrorMessage((0, i18n_1.localize)('error.compareController.noConnectedOrgs', 'No connected orgs found.')); // Localized string
        logger.error((0, i18n_1.localize)('log.compareController.noConnectedOrgs', '❌ No connected orgs were found.')); // Localized string
        return;
    }
    const orgAlias = await vscode.window.showQuickPick(orgList, {
        placeHolder: (0, i18n_1.localize)('prompt.compareController.selectOrg', 'Select the organization to compare against'), // Localized string
    });
    if (!orgAlias) {
        logger.warn((0, i18n_1.localize)('log.compareController.orgSelectionCanceled', '⚠️ Comparison cancelled: no org was selected.')); // Localized string
        return;
    }
    // 📁 Carpeta temporal
    const tempDir = path.join((0, utils_1.getStorageRoot)(), 'temp', 'compare');
    await fs.ensureDir(tempDir);
    logger.info((0, i18n_1.localize)('log.compareController.tempDirCreated', '📂 Temporary folder created: {0}', tempDir)); // Localized string
    const fallbackDir = path.join(tempDir, 'fallback');
    let fallbackUsed = false;
    let fallbackAttempted = false;
    let fallbackWarned = false;
    let fallbackRetrievedNames = new Set();
    // 🧭 Retrieve desde la org seleccionada
    logger.info((0, i18n_1.localize)('log.compareController.retrievingClasses', '⬇️ Retrieving {0} classes from org "{1}"...', classNames.length, orgAlias)); // Localized string
    const retrieveCmd = [
        'project', 'retrieve', 'start',
        '--target-org', orgAlias,
        '--output-dir', tempDir,
        '--json'
    ];
    // 🔁 Agregar un --metadata por cada clase
    for (const cls of classNames) {
        retrieveCmd.push('--metadata', `ApexClass:${cls}`);
    }
    logger.info((0, i18n_1.localize)('log.compareController.executeRetrieve', '🧩 Running command: sf {0}', retrieveCmd.join(' '))); // Localized string
    try {
        const { stdout } = await (0, execa_1.execa)('sf', retrieveCmd, {
            env: { ...process.env, FORCE_COLOR: '0' }
        });
        const result = JSON.parse(stdout);
        logger.info((0, i18n_1.localize)('log.compareController.retrieveComplete', '✅ Retrieve completed ({0} files).', result.result.files?.length || 0)); // Localized string
    }
    catch (err) {
        logger.error((0, i18n_1.localize)('log.compareController.retrieveError', '❌ Error during retrieve: {0}', err.message)); // Localized string
        if (err.stdout)
            logger.error((0, i18n_1.localize)('log.compareController.retrieveStdout', '📄 STDOUT: {0}', err.stdout)); // Localized string
        if (err.stderr)
            logger.error((0, i18n_1.localize)('log.compareController.retrieveStderr', '⚠️ STDERR: {0}', err.stderr)); // Localized string
        fallbackAttempted = true;
        fallbackRetrievedNames = await fallbackRetrieveApexClasses(classNames, orgAlias, fallbackDir, logger);
        fallbackUsed = fallbackRetrievedNames.size > 0;
        if (fallbackUsed) {
            fallbackWarned = true;
            logger.warn((0, i18n_1.localize)('log.compareController.retrieveFallbackUsed', '⚠️ Fallback ApexClass.Body was used due to retrieve failure.')); // Localized string
            vscode.window.showWarningMessage((0, i18n_1.localize)('warning.compareController.retrieveFallbackUsed', 'Metadata could not be retrieved; ApexClass.Body was queried as an alternative.')); // Localized string
        }
        else {
            vscode.window.showErrorMessage((0, i18n_1.localize)('error.compareController.retrieveFailed', 'Error retrieving classes: {0}', err.message)); // Localized string
            return;
        }
    }
    // 🔬 Comparar clases
    logger.info((0, i18n_1.localize)('log.compareController.comparisonStart', '🔬 Starting comparison for {0} classes...', classNames.length)); // Localized string
    const results = [];
    const statusLabels = {
        match: (0, i18n_1.localize)('compare.status.match', 'Match'),
        mismatch: (0, i18n_1.localize)('compare.status.mismatch', 'Mismatch'),
        onlyOrg: (0, i18n_1.localize)('compare.status.onlyOrg', 'Only in Org'),
        onlyLocal: (0, i18n_1.localize)('compare.status.onlyLocal', 'Only in Local'),
        missingBoth: (0, i18n_1.localize)('compare.status.missingBoth', 'Missing in both')
    };
    for (const className of classNames) {
        const localPath = path.join(repoDir, `${className}.cls`);
        // 🔹 ruta estándar
        let retrievedPath = path.join(tempDir, 'force-app', 'main', 'default', 'classes', `${className}.cls`);
        // 🔹 si no existe, buscar en ruta alternativa (raíz de "classes")
        if (!(await fs.pathExists(retrievedPath))) {
            const altPath = path.join(tempDir, 'classes', `${className}.cls`);
            if (await fs.pathExists(altPath)) {
                logger.warn((0, i18n_1.localize)('log.compareController.altPathDetected', '📦 Retrieved file detected in alternate path: {0}', altPath)); // Localized string
                retrievedPath = altPath;
            }
        }
        let existsRemote = await fs.pathExists(retrievedPath);
        if (!existsRemote) {
            if (!fallbackAttempted) {
                fallbackAttempted = true;
                fallbackRetrievedNames = await fallbackRetrieveApexClasses(classNames, orgAlias, fallbackDir, logger);
                fallbackUsed = fallbackRetrievedNames.size > 0;
                if (fallbackUsed && !fallbackWarned) {
                    fallbackWarned = true;
                    logger.warn((0, i18n_1.localize)('log.compareController.fallbackUsedForMissing', '⚠️ Fallback ApexClass.Body was used to complete missing classes.')); // Localized string
                    vscode.window.showWarningMessage((0, i18n_1.localize)('warning.compareController.fallbackUsedForMissing', 'Some classes were queried using ApexClass.Body because they were not available via retrieve.')); // Localized string
                }
            }
            if (fallbackUsed && fallbackRetrievedNames.has(className)) {
                retrievedPath = path.join(fallbackDir, `${className}.cls`);
                existsRemote = await fs.pathExists(retrievedPath);
            }
        }
        const existsLocal = await fs.pathExists(localPath);
        logger.info((0, i18n_1.localize)('log.compareController.processingClass', '🧩 Processing class: {0}', className)); // Localized string
        const localIndicator = existsLocal ? '✅' : '❌';
        const remoteIndicator = existsRemote ? '✅' : '❌';
        logger.info((0, i18n_1.localize)('log.compareController.localPathStatus', '🔹 Local: {0} {1}', localIndicator, localPath)); // Localized string
        logger.info((0, i18n_1.localize)('log.compareController.remotePathStatus', '🔹 Remote: {0} {1}', remoteIndicator, retrievedPath)); // Localized string
        if (!existsLocal && !existsRemote) {
            logger.warn((0, i18n_1.localize)('log.compareController.missingEverywhere', '⚠️ {0} does not exist locally or in the org.', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.missingBoth, StatusKey: 'missingBoth' });
            continue;
        }
        if (!existsLocal) {
            logger.warn((0, i18n_1.localize)('log.compareController.onlyInOrg', '⚠️ {0} exists only in the org.', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.onlyOrg, StatusKey: 'onlyOrg' });
            continue;
        }
        if (!existsRemote) {
            logger.warn((0, i18n_1.localize)('log.compareController.onlyLocal', '⚠️ {0} exists only locally.', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.onlyLocal, StatusKey: 'onlyLocal' });
            continue;
        }
        const localBodyRaw = await fs.readFile(localPath, 'utf8');
        const remoteBodyRaw = await fs.readFile(retrievedPath, 'utf8');
        const localBody = normalizeForComparison(localBodyRaw);
        const remoteBody = normalizeForComparison(remoteBodyRaw);
        if (localBody === remoteBody) {
            logger.info((0, i18n_1.localize)('log.compareController.match', '✅ {0}: Match', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.match, StatusKey: 'match' });
        }
        else {
            logger.info((0, i18n_1.localize)('log.compareController.differencesFound', '⚡ {0}: Differences detected', className)); // Localized string
            const diff = Diff.diffLines(localBodyRaw, remoteBodyRaw)
                .map(part => {
                const sign = part.added ? '+' : part.removed ? '-' : ' ';
                return part.value
                    .split('\n')
                    .map(line => `${sign} ${line}`)
                    .join('\n');
            })
                .join('\n');
            results.push({
                ClassName: className,
                Status: statusLabels.mismatch,
                StatusKey: 'mismatch',
                Differences: diff,
                LocalVersion: localBodyRaw,
                SalesforceVersion: remoteBodyRaw
            });
        }
    }
    // 🧾 Generar reporte HTML
    logger.info((0, i18n_1.localize)('log.compareController.generatingHtmlReport', '📊 Generating comparison HTML report...')); // Localized string
    const htmlReport = await (0, reportGenerator_1.generateComparisonReport)(outputDir, orgAlias, results);
    // 🔹 Leer contenido del HTML generado
    const htmlContent = await fs.readFile(htmlReport, 'utf8');
    // 🧭 Crear un Webview dentro de VS Code
    const panelTitle = (0, i18n_1.localize)('ui.compareController.webviewTitle', 'Comparison - {0}', orgAlias); // Localized string
    const panel = vscode.window.createWebviewPanel('uavComparisonReport', // ID interno
    panelTitle, // título visible
    vscode.ViewColumn.One, // dónde se abre
    { enableScripts: true } // permitir JS (para el Monaco, etc.)
    );
    // 🔸 Insertar el contenido HTML directamente
    panel.webview.html = htmlContent;
    // 🔹 Notificar en la barra de estado, no como popup
    vscode.window.setStatusBarMessage((0, i18n_1.localize)('status.compareController.reportLoaded', '✅ Report loaded in VS Code: {0}', path.basename(htmlReport)), 5000); // Localized string
    logger.info((0, i18n_1.localize)('log.compareController.reportOpened', '✅ Report opened inside VS Code.')); // Localized string
}
