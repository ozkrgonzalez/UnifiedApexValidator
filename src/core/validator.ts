import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { execa } from 'execa';
import { Logger, parseApexClassesFromPackage, getStorageRoot } from './utils';
import { parseStringPromise } from 'xml2js';

const MINIMUM_TOKENS = 100;
let logger: Logger;

/**
 * Ejecuta análisis estático de código (Salesforce Code Analyzer v5: PMD + CPD)
 */
export async function runValidator(
  uri: vscode.Uri,
  progress: vscode.Progress<{ message?: string }>,
  repoDir: string
) {
  console.log('[UAV][Validator] runValidator() inicializado');
  logger = new Logger('Validator', true);
  logger.info('🧠 Iniciando análisis estático (runValidator)');

  try {
    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) throw new Error('No se detectó carpeta de proyecto');

    const pkgPath = uri.fsPath;

    logger.info(`📂 repoDir=${repoDir}`);
    logger.info(`📦 package.xml=${pkgPath}`);

    progress.report({ message: 'Leyendo package.xml...' });
    const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(pkgPath, repoDir);
    logger.info(`🧩 Clases detectadas: tests=${testClasses.length}, normales=${nonTestClasses.length}`);

    if (!nonTestClasses.length) {
      logger.warn('⚠️ No se detectaron clases Apex no-test, omitiendo Code Analyzer.');
      return { testClasses, nonTestClasses, codeAnalyzerResults: [], pmdResults: [] };
    }

   // 🔹 PMD interno (Salesforce Code Analyzer)
    const codeAnalyzerResults = await runCodeAnalyzer(nonTestClasses, repoDir);
    logger.info(`✅ Code Analyzer completado: ${codeAnalyzerResults.length} hallazgos.`);

    // 🔹 PMD externo (CPD)
    progress.report({ message: 'Analizando duplicaciones (CPD)...' });
    const pmdResults = await runPMDFiltered(repoDir, nonTestClasses, testClasses);
    logger.info(`📑 PMD externo (CPD) completado: ${pmdResults.length} duplicaciones detectadas.`);

    logger.info('🏁 runValidator completado correctamente.');
    return {
      testClasses,
      nonTestClasses,
      codeAnalyzerResults,
      pmdResults
    };

  } catch (err: any) {
    logger.error(`❌ Error en runValidator: ${err.message}`);
    return { testClasses: [], nonTestClasses: [], codeAnalyzerResults: [], pmdResults: [] };
  }
}

/**
 * Ejecuta Salesforce Code Analyzer (PMD + CPD) embebido
 */
async function runCodeAnalyzer(classes: string[], repoDir: string) {
  logger.info(`🧠 Analizando ${classes.length} clases con Code Analyzer (PMD + CPD)...`);

  const storageRoot = getStorageRoot();
  const tempDir = path.join(storageRoot, 'temp');
  await fs.ensureDir(tempDir);

  // 🧭 Detectar raíz del workspace (donde está sfdx-project.json)
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    path.resolve(repoDir, '../../../..');

  // 🗂️ Archivo de configuración embebido en la extensión (compatible con build)
  const embeddedConfig = path.resolve(
    __dirname,
    '..',
    'resources',
    'templates',
    'code-analyzer.yml'
  );

  const outputFile = path.join(tempDir, 'code_analyzer_output.json');
  const execLog = path.join(tempDir, 'code_analyzer_exec.log');

  // 🎯 Target absoluto para todas las clases Apex
  const targetGlob = path.join(
    workspaceRoot,
    'force-app',
    'main',
    'default',
    'classes',
    '**',
    '*.cls'
  );

  const cmd = [
    'sf',
    'code-analyzer',
    'run',
    '--workspace', workspaceRoot,
    '--rule-selector', 'pmd:apex',
    '--config-file', embeddedConfig,
    '--target', targetGlob,
    '--output-file', outputFile,
    '--view', 'detail'
  ];

  logger.info(`▶️ Ejecutando: ${cmd.join(' ')}`);
  logger.info(`📄 Log de ejecución: ${execLog}`);

  try {
    // 🚀 Sin shell, para que maneje espacios correctamente en macOS y Windows
    const subprocess = execa(cmd[0], cmd.slice(1), {
      cwd: workspaceRoot,
      env: { FORCE_COLOR: '0' },
      reject: false,
      all: true,
      shell: false
    });

    const { all, exitCode } = await subprocess;

    await fs.writeFile(execLog, all || '(sin salida)', 'utf8');
    logger.info(`📤 STDOUT capturado en log (${all?.length || 0} bytes)`);

    if (exitCode !== 0 && exitCode !== undefined) {
      logger.error(`❌ Code Analyzer terminó con código ${exitCode}`);
    }

    if (!(await fs.pathExists(outputFile))) {
      logger.warn('⚠️ El Code Analyzer no generó el archivo de salida');
      return [];
    }

    const json = JSON.parse(await fs.readFile(outputFile, 'utf8'));
    const violations =
      json.violations ||
      json.results ||
      json.runs?.[0]?.results ||
      json.runs?.flatMap((r: any) => r.results) ||
      [];

    const filtered = filterAnalyzerFindings(violations, classes);

    logger.info(`🏁 Code Analyzer finalizado: ${filtered.length} hallazgos relevantes.`);
    return filtered;

  } catch (err: any) {
    logger.error(`❌ Error ejecutando Code Analyzer: ${err.message}`);
    await fs.appendFile(execLog, `\n[ERROR] ${err.stack || err.message}`);
    return [];
  }
}

/**
 * Filtra hallazgos de PMD/CPD para clases del package.xml
 */
function filterAnalyzerFindings(findings: any[], apexClasses: string[]) {
  return findings
    .filter(f => {
      const file = f.locations?.[0]?.file || '';
      const normalized = file.replace(/\\/g, '/');
      const base = path.basename(normalized).replace(/(-meta)?\.cls$/, '');
      return apexClasses.includes(base);
    })
    .map(f => {
      const loc = f.locations?.[0] || {};
      const file = loc.file || '';
      const normalizedFile = file.replace(/\\/g, '/');
      const base = path.basename(normalizedFile);

      // 🔹 resources siempre llega como array; tomamos el primer elemento
      const resource =
        Array.isArray(f.resources) && f.resources.length > 0
          ? f.resources[0]
          : null;

      return {
        clase: base || 'Desconocida',
        linea: loc.startLine || 0,
        regla: f.rule || 'Desconocido',
        severidad: f.severity || 'N/A',
        descripcion: f.message || 'Sin descripción',
        recurso: resource
      };
    });
}

/**
 * Ejecuta CPD de PMD externo (detección de código duplicado con salida XML)
 */
export async function runPMDFiltered(repoDir: string, classNames: string[], testClasses: string[]) {
  logger = new Logger('CPD', true);
  logger.info(`▶️ Ejecutando PMD CPD filtrado en ${repoDir}`);

  const storageRoot = getStorageRoot();
  const tempDir = path.join(storageRoot, 'temp');
  await fs.ensureDir(tempDir);

  const lexicalErrorFile = path.join(tempDir, 'lexical_errors.txt');
  const execLog = path.join(tempDir, 'pmd_exec.log');
  const outputFile = path.join(tempDir, 'pmd_output.xml');

  try {
    const xmlFile = path.join(tempDir, 'cpd_stdout.xml');
    const cmd = [
      'pmd', 'cpd',
      '--minimum-tokens', String(MINIMUM_TOKENS),
      '--dir', `"${path.join(repoDir, 'force-app', 'main', 'default', 'classes')}"`,
      '--language', 'apex',
      '--format', 'xml',
      '--no-fail-on-error',
      '--no-fail-on-violation',
      `> "${xmlFile}" 2>&1`
    ];

    logger.info(`🧩 Comando: ${cmd.join(' ')}`);

    // 🚀 Ejecutar en modo shell (redirige STDOUT a archivo)
    const { stderr, exitCode } = await execa(cmd.join(' '), {
      encoding: 'utf8',
      reject: false,
      shell: true
    });

    // Guardar log
    const logContent = [
      '=== PMD EXECUTION LOG ===',
      `Command: ${cmd.join(' ')}`,
      `Exit Code: ${exitCode ?? 'undefined'}`,
      '',
      stderr ? `STDERR:\n${stderr}` : '(sin stderr)',
      ''
    ].join('\n');
    await fs.writeFile(execLog, logContent, 'utf8');

    // ⚠️ Registrar errores léxicos
    if (stderr?.includes('Lexical error')) {
      const lexicalErrors = stderr
        .split(/\r?\n/)
        .filter(line => line.includes('Lexical error'))
        .join('\n');
      await fs.writeFile(lexicalErrorFile, lexicalErrors, 'utf8');
      logger.warn(`⚠️ Se detectaron errores léxicos. Guardados en: ${lexicalErrorFile}`);
    }

    // 📖 Leer XML redirigido
    if (!(await fs.pathExists(xmlFile))) {
      logger.warn('⚠️ No se generó archivo XML de salida de CPD.');
      return [];
    }

    const xml = await fs.readFile(xmlFile, 'utf8');
    if (!xml?.includes('<pmd-cpd')) {
      logger.info('ℹ️ No se encontraron elementos <duplication> en el XML.');
      return [];
    }

    const duplications = await parsePMDXmlOutput(xml);
    const filtered = filterPMDDuplications(duplications, classNames, testClasses);

    logger.info(`✅ Duplicaciones relevantes: ${filtered.length}`);
    return filtered;

  } catch (err: any) {
    logger.error(`❌ Error ejecutando PMD: ${err.shortMessage || err.message}`);
    await fs.appendFile(execLog, `\n[ERROR] ${err.stack || err.message}`);
    return [];
  }
}

/**
 * Parsea la salida XML del comando CPD y extrae duplicaciones con fragmentos de código
 */
async function parsePMDXmlOutput(xml: string) {
  try {
    if (!xml?.trim()) {
      logger.warn('⚠️ El archivo XML de CPD está vacío o no contiene datos válidos.');
      return [];
    }

    // 🧹 Eliminar todo lo que esté antes del XML propiamente tal
    const xmlStartIndex = xml.indexOf('<?xml');
    if (xmlStartIndex > 0) {
      logger.warn('⚠️ Se detectó contenido antes del XML (errores léxicos, logs, etc). Se limpiará.');
      xml = xml.substring(xmlStartIndex).trim();
    }

    // 📂 Definir el directorio temporal antes de usarlo
    const storageRoot = getStorageRoot();
    const tempDir = path.join(storageRoot, 'temp');
    await fs.ensureDir(tempDir);

    // 💾 Guardar XML limpio para depuración
    const cleanXmlFile = path.join(tempDir, 'pmd_output_clean.xml');
    await fs.writeFile(cleanXmlFile, xml, 'utf8');
    logger.info(`🧾 XML limpio guardado en: ${cleanXmlFile}`);

    // 🚫 Si sigue sin empezar con <?xml, descartamos
    if (!xml.startsWith('<?xml')) {
      logger.error('❌ El contenido del archivo CPD no inicia con una cabecera XML válida.');
      logger.error(`Contenido inicial: ${xml.substring(0, 200)}`);
      return [];
    }

    // 🧩 Parsear XML limpiado
    const result = await parseStringPromise(xml, { explicitArray: false });
    const duplications: any[] = [];

    if (!result?.['pmd-cpd']?.duplication) {
      logger.info('ℹ️ No se encontraron elementos <duplication> en el XML.');
      return [];
    }

    const items = Array.isArray(result['pmd-cpd'].duplication)
      ? result['pmd-cpd'].duplication
      : [result['pmd-cpd'].duplication];

    logger.info(`🔍 CPD detectó ${items.length} duplicaciones totales antes del filtrado.`);

    for (const [index, dup] of items.entries()) {
      const files = Array.isArray(dup.file) ? dup.file : [dup.file];
      const formattedFiles = files.map((f: any) => ({
        file: f.$.path,
        startLine: parseInt(f.$.line)
      }));

      /*logger.info(
        `🧩 Duplicación #${index + 1}: ${dup.$.lines} líneas, ${dup.$.tokens} tokens entre ${formattedFiles
          .map((f: any) => path.basename(f.file))
          .join(', ')}`
      );*/

      duplications.push({
        lines: parseInt(dup.$.lines),
        tokens: parseInt(dup.$.tokens),
        files: formattedFiles,
        codeSnippet: dup.codefragment?.trim() || ''
      });
    }

    logger.info(`✅ Se extrajeron ${duplications.length} duplicaciones del XML.`);
    return duplications;

  } catch (err: any) {
    logger.error(`❌ Error al parsear el XML de CPD: ${err.message}`);
    logger.error(`📄 XML parcial (post-limpieza):\n${xml.substring(0, 500)}... [truncated]`);
    return [];
  }
}

/**
 * Filtra duplicaciones relevantes según las clases del package.xml
 */
function filterPMDDuplications(duplications: any[], classNames: string[], testClasses: string[]) {
  return duplications
    .filter(dup => {
      const involved = dup.files.map((f: any) => path.basename(f.file, '.cls'));
      const hasPackageClass = involved.some((cls: string) => classNames.includes(cls));
      const onlyTestClasses = involved.every((cls: string) => testClasses.includes(cls));
      return hasPackageClass && !onlyTestClasses;
    })
    .map(dup => ({
      tokens: dup.tokens,
      lines: dup.lines,
      clases: dup.files.map((f: any) => path.basename(f.file)).join(', '),
      codeSnippet: dup.codeSnippet
    }));
}
