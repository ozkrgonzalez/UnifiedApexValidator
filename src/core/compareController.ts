import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as Diff from 'diff';
import { execa } from 'execa';
import { parseApexClassesFromPackage, getStorageRoot, Logger } from './utils';
import { localize } from '../i18n';
import { generateComparisonReport } from './reportGenerator';

function normalizeForComparison(source: string): string
{
  return source
  .replace(/^\uFEFF/, '')
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+$/gm, '')
  .trim();
}

async function fallbackRetrieveApexClasses(
  classNames: string[],
  orgAlias: string,
  fallbackDir: string,
  logger: Logger
): Promise<Set<string>>
{
  const retrievedNames = new Set<string>();
  if (!classNames.length)
  {
    return retrievedNames;
  }

  await fs.ensureDir(fallbackDir);
  await fs.emptyDir(fallbackDir);

  const chunkSize = 100;
  for (let i = 0; i < classNames.length; i += chunkSize)
  {
    const chunk = classNames.slice(i, i + chunkSize);
    const inClause = chunk
    .map(name => `'${name.replace(/'/g, "\\'")}'`)
    .join(', ');
    const query = `SELECT Name, Body FROM ApexClass WHERE Name IN (${inClause})`;
    logger.info(localize('log.compareController.fallbackQuery', '🪄 Fallback query (Tooling API): {0}', query)); // Localized string

    try
    {
      const { stdout } = await execa('sf',
      ['data', 'query', '--query', query, '--target-org', orgAlias, '--use-tooling-api', '--json'],
      { env: { ...process.env, FORCE_COLOR: '0' } });
      const parsed = JSON.parse(stdout);
      const records = parsed?.result?.records;

      if (!Array.isArray(records) || records.length === 0)
      {
        logger.warn(localize('log.compareController.fallbackNoResults', '⚠️ Fallback returned no results for this batch of classes.')); // Localized string
        continue;
      }

      for (const record of records)
      {
        const name = record?.Name;
        const body = record?.Body;
        if (typeof name !== 'string' || typeof body !== 'string')
        {
          logger.warn(localize('log.compareController.invalidApexRecord', '⚠️ ApexClass record missing a valid Name or Body, skipping.')); // Localized string
          continue;
        }

        const targetPath = path.join(fallbackDir, `${name}.cls`);
        await fs.writeFile(targetPath, body, 'utf8');
        retrievedNames.add(name);
        logger.info(localize('log.compareController.fallbackRetrievedClass', '✅ Class {0} retrieved via fallback.', name)); // Localized string
      }
    }
    catch (error: any)
    {
      logger.error(localize('log.compareController.fallbackError', '❌ Error executing fallback query: {0}', error.message)); // Localized string
      if (error.stdout) logger.error(localize('log.compareController.fallbackStdout', '📄 STDOUT: {0}', error.stdout)); // Localized string
      if (error.stderr) logger.error(localize('log.compareController.fallbackStderr', '⚠️ STDERR: {0}', error.stderr)); // Localized string
    }
  }

  if (!retrievedNames.size)
  {
    logger.error(localize('log.compareController.fallbackNoClasses', '❌ No classes could be retrieved via fallback ApexClass.Body.')); // Localized string
  }

  return retrievedNames;
}

export async function runCompareApexClasses(uri?: vscode.Uri)
{
  const logger = new Logger('compareController', true);
  logger.info(localize('log.compareController.start', '🚀 Starting class comparison...')); // Localized string

  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace)
  {
    vscode.window.showErrorMessage(localize('error.compareController.noWorkspace', 'No workspace is open.')); // Localized string
    logger.error(localize('log.compareController.noWorkspace', '❌ No active workspace detected.')); // Localized string
    return;
  }

  const baseDir = workspace.uri.fsPath;
  const settings = vscode.workspace.getConfiguration('UnifiedApexValidator');
  const repoDir = settings.get<string>('sfRepositoryDir') || '';
  const outputDir = settings.get<string>('outputDir') || path.join(baseDir, 'output');

  logger.info(localize('log.compareController.workspacePath', '📁 Workspace: {0}', baseDir)); // Localized string
  logger.info(localize('log.compareController.repoPath', '📦 Configured repository: {0}', repoDir)); // Localized string
  logger.info(localize('log.compareController.outputPath', '📂 Output folder: {0}', outputDir)); // Localized string

  // 🧩 Detectar archivo origen
  let classNames: string[] = [];

  if (uri && uri.fsPath.endsWith('.xml'))
  {
    logger.info(localize('log.compareController.analyzingPackageXml', '🧩 Analyzing package.xml: {0}', uri.fsPath)); // Localized string
    const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(uri.fsPath, repoDir);
    classNames = [...testClasses, ...nonTestClasses];
  }
  else if (uri && uri.fsPath.endsWith('.cls'))
  {
    const className = path.basename(uri.fsPath, '.cls');
    logger.info(localize('log.compareController.singleClass', '📘 Comparing a single class: {0}', className)); // Localized string
    classNames = [className];
  }
  else
  {
    vscode.window.showWarningMessage(localize('warning.compareController.selectSource', 'Open a package.xml or .cls file to compare.')); // Localized string
    logger.warn(localize('log.compareController.invalidSelection', '⚠️ Command executed without a valid .xml or .cls file.')); // Localized string
    return;
  }

  if (classNames.length === 0)
  {
    vscode.window.showWarningMessage(localize('warning.compareController.noClassesFound', 'No Apex classes were found in the selected file.')); // Localized string
    logger.warn(localize('log.compareController.noClassesFound', '⚠️ No Apex classes were found in the selected file.')); // Localized string
    return;
  }

    // 🔍 Listar orgs conectadas
    logger.info(localize('log.compareController.listingOrgs', '🔍 Listing Salesforce CLI connected orgs...')); // Localized string
    const { stdout: orgListJson } = await execa('sf', ['org', 'list', '--json'], {
    env: { ...process.env, FORCE_COLOR: '0' }
    });
    const orgList = JSON.parse(orgListJson).result.nonScratchOrgs
    .filter((o: any) => o.connectedStatus === 'Connected')
    .map((o: any) => o.alias || o.username);

  if (!orgList.length)
  {
    vscode.window.showErrorMessage(localize('error.compareController.noConnectedOrgs', 'No connected orgs found.')); // Localized string
    logger.error(localize('log.compareController.noConnectedOrgs', '❌ No connected orgs were found.')); // Localized string
    return;
  }

  const orgAlias = await vscode.window.showQuickPick(orgList, {
    placeHolder: localize('prompt.compareController.selectOrg', 'Select the organization to compare against'), // Localized string
  });

  if (!orgAlias)
  {
    logger.warn(localize('log.compareController.orgSelectionCanceled', '⚠️ Comparison cancelled: no org was selected.')); // Localized string
    return;
  }

  // 📁 Carpeta temporal
  const tempDir = path.join(getStorageRoot(), 'temp', 'compare');
  await fs.ensureDir(tempDir);
  logger.info(localize('log.compareController.tempDirCreated', '📂 Temporary folder created: {0}', tempDir)); // Localized string

  const fallbackDir = path.join(tempDir, 'fallback');
  let fallbackUsed = false;
  let fallbackAttempted = false;
  let fallbackWarned = false;
  let fallbackRetrievedNames: Set<string> = new Set();

    // 🧭 Retrieve desde la org seleccionada
    logger.info(localize('log.compareController.retrievingClasses', '⬇️ Retrieving {0} classes from org "{1}"...', classNames.length, orgAlias)); // Localized string

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

    logger.info(localize('log.compareController.executeRetrieve', '🧩 Running command: sf {0}', retrieveCmd.join(' '))); // Localized string

    try {
    const { stdout } = await execa('sf', retrieveCmd, {
        env: { ...process.env, FORCE_COLOR: '0' }
    });
    const result = JSON.parse(stdout);
    logger.info(localize('log.compareController.retrieveComplete', '✅ Retrieve completed ({0} files).', result.result.files?.length || 0)); // Localized string
    } catch (err: any) {
    logger.error(localize('log.compareController.retrieveError', '❌ Error during retrieve: {0}', err.message)); // Localized string
    if (err.stdout) logger.error(localize('log.compareController.retrieveStdout', '📄 STDOUT: {0}', err.stdout)); // Localized string
    if (err.stderr) logger.error(localize('log.compareController.retrieveStderr', '⚠️ STDERR: {0}', err.stderr)); // Localized string

    fallbackAttempted = true;
    fallbackRetrievedNames = await fallbackRetrieveApexClasses(classNames, orgAlias, fallbackDir, logger);
    fallbackUsed = fallbackRetrievedNames.size > 0;

    if (fallbackUsed)
    {
      fallbackWarned = true;
      logger.warn(localize('log.compareController.retrieveFallbackUsed', '⚠️ Fallback ApexClass.Body was used due to retrieve failure.')); // Localized string
      vscode.window.showWarningMessage(localize('warning.compareController.retrieveFallbackUsed', 'Metadata could not be retrieved; ApexClass.Body was queried as an alternative.')); // Localized string
    }
    else
    {
      vscode.window.showErrorMessage(localize('error.compareController.retrieveFailed', 'Error retrieving classes: {0}', err.message)); // Localized string
      return;
    }
    }

  // 🔬 Comparar clases
  logger.info(localize('log.compareController.comparisonStart', '🔬 Starting comparison for {0} classes...', classNames.length)); // Localized string
  const results: {
    ClassName: string;
    Status: string;
    StatusKey: 'match' | 'mismatch' | 'onlyOrg' | 'onlyLocal' | 'missingBoth';
    Differences?: string;
    LocalVersion?: string;
    SalesforceVersion?: string;
  }[] = [];

  const statusLabels = {
    match: localize('compare.status.match', 'Match'),
    mismatch: localize('compare.status.mismatch', 'Mismatch'),
    onlyOrg: localize('compare.status.onlyOrg', 'Only in Org'),
    onlyLocal: localize('compare.status.onlyLocal', 'Only in Local'),
    missingBoth: localize('compare.status.missingBoth', 'Missing in both')
  };

    for (const className of classNames)
    {
        const localPath = path.join(repoDir, `${className}.cls`);

        // 🔹 ruta estándar
        let retrievedPath = path.join(tempDir, 'force-app', 'main', 'default', 'classes', `${className}.cls`);

        // 🔹 si no existe, buscar en ruta alternativa (raíz de "classes")
        if (!(await fs.pathExists(retrievedPath)))
        {
            const altPath = path.join(tempDir, 'classes', `${className}.cls`);
            if (await fs.pathExists(altPath)) {
                logger.warn(localize('log.compareController.altPathDetected', '📦 Retrieved file detected in alternate path: {0}', altPath)); // Localized string
                retrievedPath = altPath;
            }
        }

        let existsRemote = await fs.pathExists(retrievedPath);

        if (!existsRemote)
        {
            if (!fallbackAttempted)
            {
                fallbackAttempted = true;
                fallbackRetrievedNames = await fallbackRetrieveApexClasses(classNames, orgAlias, fallbackDir, logger);
                fallbackUsed = fallbackRetrievedNames.size > 0;

                if (fallbackUsed && !fallbackWarned)
                {
                    fallbackWarned = true;
                    logger.warn(localize('log.compareController.fallbackUsedForMissing', '⚠️ Fallback ApexClass.Body was used to complete missing classes.')); // Localized string
                    vscode.window.showWarningMessage(localize('warning.compareController.fallbackUsedForMissing', 'Some classes were queried using ApexClass.Body because they were not available via retrieve.')); // Localized string
                }
            }

            if (fallbackUsed && fallbackRetrievedNames.has(className))
            {
                retrievedPath = path.join(fallbackDir, `${className}.cls`);
                existsRemote = await fs.pathExists(retrievedPath);
            }
        }

        const existsLocal = await fs.pathExists(localPath);

        logger.info(localize('log.compareController.processingClass', '🧩 Processing class: {0}', className)); // Localized string
        const localIndicator = existsLocal ? '✅' : '❌';
        const remoteIndicator = existsRemote ? '✅' : '❌';
        logger.info(localize('log.compareController.localPathStatus', '🔹 Local: {0} {1}', localIndicator, localPath)); // Localized string
        logger.info(localize('log.compareController.remotePathStatus', '🔹 Remote: {0} {1}', remoteIndicator, retrievedPath)); // Localized string

        if (!existsLocal && !existsRemote) {
            logger.warn(localize('log.compareController.missingEverywhere', '⚠️ {0} does not exist locally or in the org.', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.missingBoth, StatusKey: 'missingBoth' });
            continue;
        }

        if (!existsLocal) {
            logger.warn(localize('log.compareController.onlyInOrg', '⚠️ {0} exists only in the org.', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.onlyOrg, StatusKey: 'onlyOrg' });
            continue;
        }

        if (!existsRemote) {
            logger.warn(localize('log.compareController.onlyLocal', '⚠️ {0} exists only locally.', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.onlyLocal, StatusKey: 'onlyLocal' });
            continue;
        }

        const localBodyRaw = await fs.readFile(localPath, 'utf8');
        const remoteBodyRaw = await fs.readFile(retrievedPath, 'utf8');
        const localBody = normalizeForComparison(localBodyRaw);
        const remoteBody = normalizeForComparison(remoteBodyRaw);

        if (localBody === remoteBody) {
            logger.info(localize('log.compareController.match', '✅ {0}: Match', className)); // Localized string
            results.push({ ClassName: className, Status: statusLabels.match, StatusKey: 'match' });
        } else {
            logger.info(localize('log.compareController.differencesFound', '⚡ {0}: Differences detected', className)); // Localized string
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
    logger.info(localize('log.compareController.generatingHtmlReport', '📊 Generating comparison HTML report...')); // Localized string
    const htmlReport = await generateComparisonReport(outputDir, orgAlias, results);

    // 🔹 Leer contenido del HTML generado
    const htmlContent = await fs.readFile(htmlReport, 'utf8');

    // 🧭 Crear un Webview dentro de VS Code
    const panelTitle = localize('ui.compareController.webviewTitle', 'Comparison - {0}', orgAlias); // Localized string
    const panel = vscode.window.createWebviewPanel(
    'uavComparisonReport',                       // ID interno
    panelTitle,                                  // título visible
    vscode.ViewColumn.One,                       // dónde se abre
    { enableScripts: true }                      // permitir JS (para el Monaco, etc.)
    );

    // 🔸 Insertar el contenido HTML directamente
    panel.webview.html = htmlContent;

    // 🔹 Notificar en la barra de estado, no como popup
    vscode.window.setStatusBarMessage(
        localize('status.compareController.reportLoaded', '✅ Report loaded in VS Code: {0}', path.basename(htmlReport)),
        5000
    ); // Localized string
    logger.info(localize('log.compareController.reportOpened', '✅ Report opened inside VS Code.')); // Localized string
}
