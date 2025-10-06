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
exports.runValidator = runValidator;
exports.runPMDFiltered = runPMDFiltered;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const execa_1 = require("execa");
const utils_1 = require("./utils");
let logger;
const MINIMUM_TOKENS = 100;
/**
 * Ejecuta análisis estático de código (Salesforce Code Analyzer + PMD)
 */
async function runValidator(uri, progress, repoDir) {
    console.log('[UAV][Validator] runValidator() inicializado');
    logger = new utils_1.Logger('Validator', true);
    logger.info('🧠 Iniciando análisis estático (runValidator)');
    try {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
            throw new Error('No se detectó carpeta de proyecto');
        const pkgPath = uri.fsPath;
        logger.info(`📂 repoDir=${repoDir}`);
        logger.info(`📦 package.xml=${pkgPath}`);
        progress.report({ message: 'Leyendo package.xml...' });
        const { testClasses, nonTestClasses } = await (0, utils_1.parseApexClassesFromPackage)(pkgPath, repoDir);
        logger.info(`🧩 Clases detectadas: tests=${testClasses.length}, normales=${nonTestClasses.length}`);
        if (!nonTestClasses.length) {
            logger.warn('⚠️ No se detectaron clases Apex no-test, omitiendo Code Analyzer y PMD.');
            return { testClasses, nonTestClasses, codeAnalyzerResults: [], pmdResults: [] };
        }
        progress.report({ message: 'Ejecutando Salesforce Code Analyzer...' });
        logger.info('🚀 Iniciando Salesforce Code Analyzer...');
        const codeAnalyzerResults = await runCodeAnalyzer(nonTestClasses, repoDir);
        logger.info(`✅ Code Analyzer completado: ${codeAnalyzerResults.length} hallazgos.`);
        progress.report({ message: 'Ejecutando PMD Copy Paste Detector...' });
        logger.info('🚀 Iniciando PMD Copy Paste Detector...');
        const pmdResults = await runPMDFiltered(repoDir, nonTestClasses, testClasses);
        logger.info(`✅ PMD completado con ${pmdResults.length} resultados.`);
        logger.info('🏁 runValidator completado correctamente.');
        return {
            testClasses,
            nonTestClasses,
            codeAnalyzerResults,
            pmdResults
        };
    }
    catch (err) {
        logger.error(`❌ Error en runValidator: ${err.message}`);
        return { testClasses: [], nonTestClasses: [], codeAnalyzerResults: [], pmdResults: [] };
    }
}
/**
 * Ejecuta Salesforce Code Analyzer vía CLI
 */
async function runCodeAnalyzer(classes, repoDir) {
    const issues = [];
    logger.info(`🧠 Analizando ${classes.length} clases con Code Analyzer...`);
    const storageRoot = (0, utils_1.getStorageRoot)();
    const tempDir = path.join(storageRoot, 'temp');
    await fs.ensureDir(tempDir);
    // Detectar raíz real del proyecto (donde vive sfdx-project.json)
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
        path.resolve(repoDir, '../../../..');
    // Validar que exista sfdx-project.json
    const sfdxPath = path.join(workspaceRoot, 'sfdx-project.json');
    if (!fs.existsSync(sfdxPath)) {
        logger.warn(`⚠️ No se encontró sfdx-project.json en ${workspaceRoot}`);
    }
    for (const cls of classes) {
        const clsPath = path.join(repoDir, `${cls}.cls`);
        if (!fs.existsSync(clsPath)) {
            logger.warn(`⚠️ Clase no encontrada: ${clsPath}`);
            continue;
        }
        try {
            // ✅ Target debe ser relativo al workspace
            const relativeTarget = path.relative(workspaceRoot, clsPath).replace(/\\/g, '/');
            const outputFile = path.join(tempDir, `${cls}_codeAnalyzer.json`);
            const cmd = [
                'sf',
                'code-analyzer',
                'run',
                '--workspace',
                workspaceRoot,
                '--target',
                relativeTarget,
                '--output-file',
                outputFile,
            ];
            logger.info(`▶️ Ejecutando: ${cmd.join(' ')}`);
            const { stdout, stderr } = await (0, execa_1.execa)(cmd[0], cmd.slice(1), {
                env: { FORCE_COLOR: '0' },
                reject: false,
            });
            if (stderr?.trim())
                logger.warn(`⚠️ ${cls} stderr: ${stderr.trim()}`);
            if (stdout?.trim())
                logger.info(`ℹ️ ${cls} stdout: ${stdout.trim()}`);
            if (!fs.existsSync(outputFile)) {
                logger.warn(`⚠️ No se generó archivo de salida para ${cls}`);
                continue;
            }
            const data = JSON.parse(await fs.readFile(outputFile, 'utf8'));
            const violations = data?.violations || [];
            logger.info(`🔍 ${cls} → ${violations.length} hallazgos`);
            for (const v of violations) {
                /*issues.push({
                  Clase: cls,
                  Regla: v.rule,
                  Mensaje: v.message,
                  Severidad: v.severity,
                  Archivo: v.locations?.[0]?.file,
                  Línea: v.locations?.[0]?.startLine,
                });*/
                issues.push({
                    Clase: cls,
                    Línea: v.locations?.[0]?.startLine,
                    Regla: v.rule,
                    Severidad: v.severity,
                    Descripción: v.message || 'Sin descripción'
                });
            }
            await fs.remove(outputFile).catch(() => { });
        }
        catch (err) {
            logger.error(`❌ Error Code Analyzer (${cls}): ${err.shortMessage || err.message}`);
        }
    }
    logger.info(`🏁 Code Analyzer finalizado. Total hallazgos: ${issues.length}`);
    return issues;
}
/**
 * Ejecuta PMD Copy Paste Detector
 */
async function runPMDFiltered(repoDir, classNames, testClasses) {
    logger.info(`▶️ Ejecutando PMD CPD filtrado en ${repoDir}`);
    try {
        const cmd = [
            'pmd', 'cpd',
            '--minimum-tokens', String(MINIMUM_TOKENS),
            '--dir', repoDir,
            '--language', 'apex',
            '--format', 'text'
        ];
        logger.info(`🧩 Comando: ${cmd.join(' ')}`);
        const { stdout, stderr } = await (0, execa_1.execa)(cmd[0], cmd.slice(1), { encoding: 'utf8', reject: false });
        if (stderr?.trim())
            logger.warn(`⚠️ PMD stderr: ${stderr.trim()}`);
        if (!stdout?.trim()) {
            logger.warn('⚠️ PMD no devolvió salida.');
            return [];
        }
        // 🔍 Procesar duplicados
        const duplications = parsePMDOutput(stdout);
        const filtered = filterPMDDuplications(duplications, classNames, testClasses);
        logger.info(`✅ Duplicaciones relevantes: ${filtered.length}`);
        return filtered;
    }
    catch (err) {
        logger.error(`❌ Error ejecutando PMD: ${err.shortMessage || err.message}`);
        return [];
    }
}
/**
 * Parsea la salida de PMD CPD (modo texto)
 */
function parsePMDOutput(output) {
    const duplications = [];
    const lines = output.split(/\r?\n/);
    const dupRegex = /Found a (\d+) line \((\d+) tokens\) duplication/;
    const fileRegex = /Starting at line (\d+) of (.+)/;
    let currentDup = null;
    for (const line of lines) {
        const dupMatch = dupRegex.exec(line);
        if (dupMatch) {
            if (currentDup)
                duplications.push(currentDup);
            currentDup = {
                lineCount: parseInt(dupMatch[1]),
                tokenCount: parseInt(dupMatch[2]),
                files: []
            };
            continue;
        }
        const fileMatch = fileRegex.exec(line);
        if (fileMatch && currentDup) {
            const [_, start, file] = fileMatch;
            currentDup.files.push({ file, startLine: parseInt(start) });
        }
    }
    if (currentDup)
        duplications.push(currentDup);
    return duplications;
}
/**
 * Filtra duplicaciones relevantes según las clases de package.xml
 */
function filterPMDDuplications(duplications, classNames, testClasses) {
    const relevant = [];
    for (const dup of duplications) {
        const involved = dup.files.map((f) => path.basename(f.file, '.cls'));
        const hasPackageClass = involved.some((cls) => classNames.includes(cls));
        const onlyTestClasses = involved.every((cls) => testClasses.includes(cls));
        if (hasPackageClass && !onlyTestClasses) {
            relevant.push({
                tokens: dup.tokenCount,
                lines: dup.lineCount,
                clases: involved.join(', ')
            });
        }
    }
    return relevant;
}
