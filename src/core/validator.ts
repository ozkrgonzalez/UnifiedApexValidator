import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { execa } from 'execa';
import { Logger, parseApexClassesFromPackage, getStorageRoot } from './utils';
import { localize } from '../i18n';

let logger: Logger;

/**
 * Runs static analysis (Salesforce Code Analyzer v5: PMD + CPD)
 */
export async function runValidator(
  uri: vscode.Uri,
  progress: vscode.Progress<{ message?: string }>,
  repoDir: string
) {
  console.log(localize('log.validator.init', '[UAV][Validator] runValidator() initialized'));
  logger = new Logger('Validator', true);

  try {
    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) throw new Error(localize('error.validator.noWorkspace', 'No workspace folder detected.'));

    const pkgPath = uri.fsPath;

    progress.report({ message: localize('progress.validator.readingPackage', 'Reading package.xml...') });
    const { testClasses, nonTestClasses } = await parseApexClassesFromPackage(pkgPath, repoDir);
    logger.info(
      localize(
        'log.validator.detectedClasses',
        'Classes detected: tests={0}, non-tests={1}',
        testClasses.length,
        nonTestClasses.length
      )
    );

    if (!nonTestClasses.length) {
      logger.warn(localize('log.validator.noNonTestClasses', 'No non-test Apex classes detected; skipping Code Analyzer.'));
      return { testClasses, nonTestClasses, codeAnalyzerResults: [], pmdResults: [] };
    }

    const { codeAnalyzerResults, pmdResults } = await runCodeAnalyzer(nonTestClasses, repoDir);
    logger.info(
      localize(
        'log.validator.analyzerSummary',
        'Code Analyzer completed: {0} violations, {1} duplications.',
        codeAnalyzerResults.length,
        pmdResults.length
      )
    );

    return {
      testClasses,
      nonTestClasses,
      codeAnalyzerResults,
      pmdResults
    };
  } catch (err: any) {
    logger.error(localize('log.validator.error', 'Error in runValidator: {0}', err.message));
    return { testClasses: [], nonTestClasses: [], codeAnalyzerResults: [], pmdResults: [] };
  }
}

/**
 * Runs Salesforce Code Analyzer (PMD + CPD)
 */
async function runCodeAnalyzer(classes: string[], repoDir: string) {
  logger.info(localize('log.validator.analyzingClasses', 'Analyzing {0} classes with Code Analyzer (PMD + CPD)...', classes.length));

  const storageRoot = getStorageRoot();
  const tempDir = path.join(storageRoot, 'temp');
  await fs.ensureDir(tempDir);

  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.resolve(repoDir, '../../../..');

  const embeddedConfig = path.resolve(__dirname, 'resources', 'templates', 'code-analyzer.yml');
  const outputFile = path.join(tempDir, 'code_analyzer_output.json');
  const execLog = path.join(tempDir, 'code_analyzer_exec.log');

  const targetGlob = path.join(workspaceRoot, 'force-app', 'main', 'default', 'classes', '**', '*.cls');
  const cmd = [
    'sf',
    'code-analyzer',
    'run',
    '--workspace',
    workspaceRoot,
    '--rule-selector',
    'pmd:apex',
    '--rule-selector',
    'cpd',
    '--config-file',
    embeddedConfig,
    '--target',
    targetGlob,
    '--output-file',
    outputFile
  ];

  try {
    const subprocess = execa(cmd[0], cmd.slice(1), {
      cwd: workspaceRoot,
      env: { FORCE_COLOR: '0' },
      reject: false,
      all: true,
      shell: false
    });

    const { all, exitCode } = await subprocess;

    await fs.writeFile(execLog, all || localize('log.validator.noOutput', '(no output)'), 'utf8');

    if (exitCode !== 0 && exitCode !== undefined) {
      logger.error(localize('log.validator.analyzerExitCode', 'Code Analyzer finished with exit code {0}', exitCode));
    }

    if (!(await fs.pathExists(outputFile))) {
      logger.warn(localize('log.validator.outputMissing', 'Code Analyzer did not produce an output file.'));
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

    const codeAnalyzerResults = filtered.filter((f) => f.tipo === 'PMD');
    const pmdResults = filtered
      .filter((f) => f.tipo === 'CPD')
      .map((f) => ({
        tokens: parseInt((f.descripcion.match(/(\d+)\s+tokens/) || [])[1] || '0', 10),
        lines: parseInt((f.descripcion.match(/(\d+)\s+lines/) || [])[1] || '0', 10),
        clases: f.archivos,
        codeSnippet: f.codeSnippet
      }));

    logger.info(localize('log.validator.analyzerFindings', 'Code Analyzer finished: {0} relevant findings.', filtered.length));
    return { codeAnalyzerResults, pmdResults };
  } catch (err: any) {
    logger.error(localize('log.validator.analyzerError', 'Error running Code Analyzer: {0}', err.message));
    await fs.appendFile(execLog, `\n[ERROR] ${err.stack || err.message}`);
    return { codeAnalyzerResults: [], pmdResults: [] };
  }
}

/**
 * Filters PMD/CPD findings for package classes
 */
async function filterAnalyzerFindings(findings: any[], apexClasses: string[]) {
  const results: any[] = [];

  for (const f of findings) {
    const engine = (f.engine || '').toLowerCase();
    const locs = f.locations || [];
    if (!Array.isArray(locs) || locs.length === 0) continue;

    const involvedClasses = locs.map((l: any) =>
      path.basename(l.file || '').replace(/\.cls$/, '')
    );
    const hasRelevantClass = involvedClasses.some((cls) => apexClasses.includes(cls));
    if (!hasRelevantClass) continue;

    const primary = locs[f.primaryLocationIndex || 0] || locs[0];
    const normalizedPath = (primary.file || '').replace(/\\/g, '/');
    const baseName = path.basename(normalizedPath).replace(/(-meta)?\.cls$/, '');

    if (engine === 'pmd') {
      results.push({
        tipo: 'PMD',
        clase: baseName,
        linea: primary.startLine || 0,
        regla: f.rule || localize('log.validator.ruleUnknown', 'Unknown'),
        severidad: f.severity || 'N/A',
        descripcion: f.message || localize('log.validator.descriptionMissing', 'No description provided'),
        recurso: Array.isArray(f.resources) && f.resources.length > 0 ? f.resources[0] : null
      });
    } else if (engine === 'cpd') {
      const codeSnippet = await extractCpdSnippet(locs);

      results.push({
        tipo: 'CPD',
        clase: baseName,
        regla: f.rule || 'DetectCopyPasteForApex',
        descripcion: f.message || localize('log.validator.duplicationDetected', 'Duplication detected'),
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
 * Extracts the full snippet reported by CPD based on startLine/endLine.
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
      logger.warn(localize('log.validator.cpdFileMissing', 'File not found for CPD snippet: {0}', filePath));
      return '';
    }

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    const start = Math.max(0, firstLoc.startLine - 1);
    const end = Math.min(lines.length, firstLoc.endLine || lines.length);

    const snippet = lines.slice(start, end).join('\n');
    return snippet.trim();
  } catch (err: any) {
    logger.warn(localize('log.validator.cpdSnippetError', 'Error reading CPD snippet: {0}', err.message));
    return '';
  }
}

