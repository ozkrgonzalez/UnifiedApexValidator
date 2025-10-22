import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as Diff from 'diff';
import { execa } from 'execa';
import { parseApexClassesFromPackage, getStorageRoot, Logger } from './utils';
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
    logger.info(`🪄 Consulta fallback (Tooling API): ${query}`);

    try
    {
      const { stdout } = await execa('sf',
      ['data', 'query', '--query', query, '--target-org', orgAlias, '--use-tooling-api', '--json'],
      { env: { ...process.env, FORCE_COLOR: '0' } });
      const parsed = JSON.parse(stdout);
      const records = parsed?.result?.records;

      if (!Array.isArray(records) || records.length === 0)
      {
        logger.warn('⚠️ Fallback sin resultados para este bloque de clases.');
        continue;
      }

      for (const record of records)
      {
        const name = record?.Name;
        const body = record?.Body;
        if (typeof name !== 'string' || typeof body !== 'string')
        {
          logger.warn('⚠️ Registro de ApexClass sin Name o Body válido, se omite.');
          continue;
        }

        const targetPath = path.join(fallbackDir, `${name}.cls`);
        await fs.writeFile(targetPath, body, 'utf8');
        retrievedNames.add(name);
        logger.info(`✅ Clase ${name} recuperada mediante fallback.`);
      }
    }
    catch (error: any)
    {
      logger.error(`❌ Error ejecutando consulta fallback: ${error.message}`);
      if (error.stdout) logger.error(`📄 STDOUT: ${error.stdout}`);
      if (error.stderr) logger.error(`⚠️ STDERR: ${error.stderr}`);
    }
  }

  if (!retrievedNames.size)
  {
    logger.error('❌ Ninguna clase pudo recuperarse mediante fallback ApexClass.Body.');
  }

  return retrievedNames;
}

export async function runCompareApexClasses(uri?: vscode.Uri)
{
  const logger = new Logger('compareController', true);
  logger.info('🚀 Iniciando Comparación de Clases...');

  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace)
  {
    vscode.window.showErrorMessage('No hay un workspace abierto.');
    logger.error('❌ No se detectó workspace activo.');
    return;
  }

  const baseDir = workspace.uri.fsPath;
  const settings = vscode.workspace.getConfiguration('UnifiedApexValidator');
  const repoDir = settings.get<string>('sfRepositoryDir') || '';
  const outputDir = settings.get<string>('outputDir') || path.join(baseDir, 'output');

  logger.info(`📁 Workspace: ${baseDir}`);
  logger.info(`📦 Repositorio configurado: ${repoDir}`);
  logger.info(`📂 Carpeta de salida: ${outputDir}`);

  // 🧩 Detectar archivo origen
  let classNames: string[] = [];

  if (uri && uri.fsPath.endsWith('.xml'))
  {
    logger.info(`🧩 Analizando package.xml: ${uri.fsPath}`);
    const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(uri.fsPath, repoDir);
    classNames = [...testClasses, ...nonTestClasses];
  }
  else if (uri && uri.fsPath.endsWith('.cls'))
  {
    const className = path.basename(uri.fsPath, '.cls');
    logger.info(`📘 Comparando una sola clase: ${className}`);
    classNames = [className];
  }
  else
  {
    vscode.window.showWarningMessage('Abre un package.xml o un archivo .cls para comparar.');
    logger.warn('⚠️ Comando ejecutado sin archivo .xml ni .cls válido.');
    return;
  }

  if (classNames.length === 0)
  {
    vscode.window.showWarningMessage('No se encontraron clases Apex en el archivo seleccionado.');
    logger.warn('⚠️ No se encontraron clases Apex en el archivo.');
    return;
  }

    // 🔍 Listar orgs conectadas
    logger.info('🔍 Listando organizaciones conectadas con Salesforce CLI...');
    const { stdout: orgListJson } = await execa('sf', ['org', 'list', '--json'], {
    env: { ...process.env, FORCE_COLOR: '0' }
    });
    const orgList = JSON.parse(orgListJson).result.nonScratchOrgs
    .filter((o: any) => o.connectedStatus === 'Connected')
    .map((o: any) => o.alias || o.username);

  if (!orgList.length)
  {
    vscode.window.showErrorMessage('No hay orgs conectadas.');
    logger.error('❌ No se encontraron orgs conectadas.');
    return;
  }

  const orgAlias = await vscode.window.showQuickPick(orgList, {
    placeHolder: 'Selecciona la organización contra la que comparar',
  });

  if (!orgAlias)
  {
    logger.warn('⚠️ Comparación cancelada: no se seleccionó ninguna org.');
    return;
  }

  // 📁 Carpeta temporal
  const tempDir = path.join(getStorageRoot(), 'temp', 'compare');
  await fs.ensureDir(tempDir);
  logger.info(`📂 Carpeta temporal creada: ${tempDir}`);

  const fallbackDir = path.join(tempDir, 'fallback');
  let fallbackUsed = false;
  let fallbackAttempted = false;
  let fallbackWarned = false;
  let fallbackRetrievedNames: Set<string> = new Set();

    // 🧭 Retrieve desde la org seleccionada
    logger.info(`⬇️ Recuperando ${classNames.length} clases desde org '${orgAlias}'...`);

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

    logger.info(`🧩 Ejecutando comando: sf ${retrieveCmd.join(' ')}`);

    try {
    const { stdout } = await execa('sf', retrieveCmd, {
        env: { ...process.env, FORCE_COLOR: '0' }
    });
    const result = JSON.parse(stdout);
    logger.info(`✅ Retrieve completado (${result.result.files?.length || 0} archivos).`);
    } catch (err: any) {
    logger.error(`❌ Error en retrieve: ${err.message}`);
    if (err.stdout) logger.error(`📄 STDOUT: ${err.stdout}`);
    if (err.stderr) logger.error(`⚠️ STDERR: ${err.stderr}`);

    fallbackAttempted = true;
    fallbackRetrievedNames = await fallbackRetrieveApexClasses(classNames, orgAlias, fallbackDir, logger);
    fallbackUsed = fallbackRetrievedNames.size > 0;

    if (fallbackUsed)
    {
      fallbackWarned = true;
      logger.warn('⚠️ Se usó fallback ApexClass.Body por error en retrieve.');
      vscode.window.showWarningMessage('No se pudo recuperar metadata; se consultó ApexClass.Body como alternativa.');
    }
    else
    {
      vscode.window.showErrorMessage(`Error recuperando clases: ${err.message}`);
      return;
    }
    }

  // 🔬 Comparar clases
  logger.info(`🔬 Iniciando comparación de ${classNames.length} clases...`);
  const results: {
    ClassName: string;
    Status: string;
    Differences?: string;
    LocalVersion?: string;
    SalesforceVersion?: string;
  }[] = [];

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
                logger.warn(`📦 Archivo recuperado detectado en ruta alternativa: ${altPath}`);
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
                    logger.warn('⚠️ Se usó fallback ApexClass.Body para completar clases faltantes.');
                    vscode.window.showWarningMessage('Algunas clases se consultaron usando ApexClass.Body porque no estaban disponibles vía retrieve.');
                }
            }

            if (fallbackUsed && fallbackRetrievedNames.has(className))
            {
                retrievedPath = path.join(fallbackDir, `${className}.cls`);
                existsRemote = await fs.pathExists(retrievedPath);
            }
        }

        const existsLocal = await fs.pathExists(localPath);

        logger.info(`🧩 Procesando clase: ${className}`);
        logger.info(`🔹 Local: ${existsLocal ? '✅' : '❌'} ${localPath}`);
        logger.info(`🔹 Remote: ${existsRemote ? '✅' : '❌'} ${retrievedPath}`);

        if (!existsLocal && !existsRemote) {
            logger.warn(`⚠️ ${className} no existe ni en local ni en org.`);
            results.push({ ClassName: className, Status: 'No existe en ninguno' });
            continue;
        }

        if (!existsLocal) {
            logger.warn(`⚠️ ${className} existe solo en la org.`);
            results.push({ ClassName: className, Status: 'Solo en Org' });
            continue;
        }

        if (!existsRemote) {
            logger.warn(`⚠️ ${className} existe solo en local.`);
            results.push({ ClassName: className, Status: 'Solo en Local' });
            continue;
        }

        const localBodyRaw = await fs.readFile(localPath, 'utf8');
        const remoteBodyRaw = await fs.readFile(retrievedPath, 'utf8');
        const localBody = normalizeForComparison(localBodyRaw);
        const remoteBody = normalizeForComparison(remoteBodyRaw);

        if (localBody === remoteBody) {
            logger.info(`✅ ${className}: Match`);
            results.push({ ClassName: className, Status: 'Match' });
        } else {
            logger.info(`⚡ ${className}: Diferencias detectadas`);
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
            Status: 'Mismatch',
            Differences: diff,
            LocalVersion: localBodyRaw,
            SalesforceVersion: remoteBodyRaw
            });
        }
    }

    // 🧾 Generar reporte HTML
    logger.info('📊 Generando reporte HTML de comparación...');
    const htmlReport = await generateComparisonReport(outputDir, orgAlias, results);

    // 🔹 Leer contenido del HTML generado
    const htmlContent = await fs.readFile(htmlReport, 'utf8');

    // 🧭 Crear un Webview dentro de VS Code
    const panel = vscode.window.createWebviewPanel(
    'uavComparisonReport',                       // ID interno
    `Comparación - ${orgAlias}`,                 // título visible
    vscode.ViewColumn.One,                       // dónde se abre
    { enableScripts: true }                      // permitir JS (para el Monaco, etc.)
    );

    // 🔸 Insertar el contenido HTML directamente
    panel.webview.html = htmlContent;

    // 🔹 Notificar en la barra de estado, no como popup
    vscode.window.setStatusBarMessage(`✅ Reporte cargado en VS Code: ${path.basename(htmlReport)}`, 5000);
    logger.info(`✅ Reporte abierto dentro de VS Code.`);
}
