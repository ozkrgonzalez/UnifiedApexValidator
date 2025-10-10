import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { execa } from 'execa';
import { Logger, parseApexClassesFromPackage, getStorageRoot } from './utils';

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
  //logger.info('🧠 Iniciando análisis estático (runValidator)');

  try {
    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) throw new Error('No se detectó carpeta de proyecto');

    const pkgPath = uri.fsPath;

    progress.report({ message: 'Leyendo package.xml...' });
    const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(pkgPath, repoDir);
    logger.info(`🧩 Clases detectadas: tests=${testClasses.length}, normales=${nonTestClasses.length}`);

    if (!nonTestClasses.length) {
      logger.warn('⚠️ No se detectaron clases Apex no-test, omitiendo Code Analyzer.');
      return { testClasses, nonTestClasses, codeAnalyzerResults: [], pmdResults: [] };
    }

    // 🔹 PMD interno (Salesforce Code Analyzer)
    const { codeAnalyzerResults, pmdResults } = await runCodeAnalyzer(nonTestClasses, repoDir);
    logger.info(`✅ Code Analyzer completado: ${codeAnalyzerResults.length} violaciones, ${pmdResults.length} duplicaciones.`);

    //logger.info('🏁 runValidator completado correctamente.');
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
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.resolve(repoDir, '../../../..');

  // 🗂️ Archivo de configuración embebido en la extensión (compatible con build)
  const embeddedConfig = path.resolve(__dirname, 'resources', 'templates', 'code-analyzer.yml');
  const outputFile = path.join(tempDir, 'code_analyzer_output.json');
  const execLog = path.join(tempDir, 'code_analyzer_exec.log');

  // 🎯 Target absoluto para todas las clases Apex
  const targetGlob = path.join(workspaceRoot,'force-app','main','default','classes','**','*.cls');
  const cmd = ['sf','code-analyzer','run','--workspace', workspaceRoot,'--rule-selector', 'pmd:apex','--rule-selector', 'cpd','--config-file', embeddedConfig,'--target', targetGlob,'--output-file', outputFile];

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

    if (exitCode !== 0 && exitCode !== undefined) {
      logger.error(`❌ Code Analyzer terminó con código ${exitCode}`);
    }

    if (!(await fs.pathExists(outputFile))) {
      logger.warn('⚠️ El Code Analyzer no generó el archivo de salida');
      return { codeAnalyzerResults: [], pmdResults: [] };
    }

    const json = JSON.parse(await fs.readFile(outputFile, 'utf8'));
    const violations =
      json.violations ||
      json.results ||
      json.runs?.[0]?.results ||
      json.runs?.flatMap((r: any) => r.results) ||
      [];

    const filtered = await filterAnalyzerFindings(violations, classes);

    // 🔹 separar hallazgos PMD y CPD
    const codeAnalyzerResults = filtered.filter(f => f.tipo === 'PMD');
    const pmdResults = filtered
      .filter(f => f.tipo === 'CPD')
      .map(f => ({
        tokens: parseInt((f.descripcion.match(/(\d+)\s+tokens/) || [])[1] || '0', 10),
        lines: parseInt((f.descripcion.match(/(\d+)\s+lines/) || [])[1] || '0', 10),
        clases: f.archivos,
        codeSnippet: f.codeSnippet
      }));

    logger.info(`🏁 Code Analyzer finalizado: ${filtered.length} hallazgos relevantes.`);
    return { codeAnalyzerResults, pmdResults };

  } catch (err: any) {
    logger.error(`❌ Error ejecutando Code Analyzer: ${err.message}`);
    await fs.appendFile(execLog, `\n[ERROR] ${err.stack || err.message}`);
    return { codeAnalyzerResults: [], pmdResults: [] };
  }
}

/**
 * Filtra hallazgos de PMD/CPD para clases del package.xml
 */
async function filterAnalyzerFindings(findings: any[], apexClasses: string[]) {
  const results: any[] = [];

  for (const f of findings) {
    const engine = (f.engine || '').toLowerCase();
    const locs = f.locations || [];
    if (!Array.isArray(locs) || locs.length === 0) continue;

    // 🔹 Determinar si alguna de las ubicaciones pertenece al package.xml
    const involvedClasses = locs.map((l: any) =>
      path.basename(l.file || '').replace(/\.cls$/, '')
    );
    const hasRelevantClass = involvedClasses.some(cls => apexClasses.includes(cls));
    if (!hasRelevantClass) continue;

    const primary = locs[f.primaryLocationIndex || 0] || locs[0];
    const normalizedPath = (primary.file || '').replace(/\\/g, '/');
    const baseName = path.basename(normalizedPath).replace(/(-meta)?\.cls$/, '');

    if (engine === 'pmd') {
      results.push({
        tipo: 'PMD',
        clase: baseName,
        linea: primary.startLine || 0,
        regla: f.rule || 'Desconocido',
        severidad: f.severity || 'N/A',
        descripcion: f.message || 'Sin descripción',
        recurso: Array.isArray(f.resources) && f.resources.length > 0 ? f.resources[0] : null
      });
    } else if (engine === 'cpd') {
      const codeSnippet = await extractCpdSnippet(locs);

      results.push({
        tipo: 'CPD',
        clase: baseName,
        regla: f.rule || 'DetectCopyPasteForApex',
        descripcion: f.message || 'Duplicación detectada',
        severidad: f.severity || 'N/A',
        lineas: `${primary.startLine}-${primary.endLine}`,
        archivos: locs
          .map((l: any) => {
            const base = path.basename(l.file);
            const range = l.startLine && l.endLine ? ` (${l.startLine}-${l.endLine})` : '';
            return `${base}${range}`;
          })
          .join(',\n '),
        recurso: Array.isArray(f.resources) && f.resources.length > 0 ? f.resources[0] : null,
        codeSnippet
      });
    }
  }

  return results;
}

/**
 * Extrae el fragmento completo reportado por CPD según startLine y endLine.
 * Usa solo el primer archivo del grupo duplicado.
 */
async function extractCpdSnippet(locations: any[]): Promise<string> {
  if (!locations || locations.length === 0) return '';

  const firstLoc = locations[0];
  const filePath = path.isAbsolute(firstLoc.file)
    ? firstLoc.file
    : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', firstLoc.file);

  try {
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      logger.warn(`⚠️ Archivo no encontrado para snippet CPD: ${filePath}`);
      return '';
    }

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    const start = Math.max(0, firstLoc.startLine - 1);
    const end = Math.min(lines.length, firstLoc.endLine || lines.length);

    const snippet = lines.slice(start, end).join('\n');
    return snippet.trim();
  } catch (err: any) {
    logger.warn(`⚠️ Error al leer fragmento CPD: ${err.message}`);
    return '';
  }
}

