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
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const fast_xml_parser_1 = require("fast-xml-parser");
const execa_1 = require("execa");
const utils_1 = require("./utils");
const utils_2 = require("./utils");
const logger = new utils_1.Logger('Validator');
/**
 * Ejecuta análisis estático de código (Salesforce Code Analyzer + PMD)
 */
async function runValidator(uri, progress) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No se detectó carpeta de proyecto');
    }
    const repoDir = path.dirname(uri.fsPath);
    const pkgPath = uri.fsPath;
    progress.report({ message: 'Analizando package.xml...' });
    const { testClasses, nonTestClasses } = await (0, utils_2.parseApexClassesFromPackage)(pkgPath, repoDir);
    logger.info(`Clases detectadas: ${testClasses.length + nonTestClasses.length}`);
    progress.report({ message: 'Ejecutando Salesforce Code Analyzer...' });
    const codeAnalyzerResults = await runCodeAnalyzer(nonTestClasses, repoDir);
    progress.report({ message: 'Ejecutando PMD Copy Paste Detector...' });
    const pmdResults = await runPMD(repoDir);
    logger.info(`Análisis estático completado. CodeAnalyzer=${codeAnalyzerResults.length}, PMD=${pmdResults.length}`);
    return {
        testClasses,
        nonTestClasses,
        codeAnalyzerResults,
        pmdResults
    };
}
/**
 * Lee el package.xml y clasifica las clases test / no test
 */
async function parsePackageXML(pkgPath, repoDir) {
    const xml = await fs.readFile(pkgPath, 'utf8');
    const parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false });
    const json = parser.parse(xml);
    const types = json?.Package?.types || [];
    const apexTypes = Array.isArray(types)
        ? types.find((t) => t.name === 'ApexClass')
        : types.name === 'ApexClass'
            ? types
            : null;
    if (!apexTypes) {
        throw new Error('No se encontraron clases Apex en package.xml');
    }
    const members = Array.isArray(apexTypes.members) ? apexTypes.members : [apexTypes.members];
    const testClasses = [];
    const nonTestClasses = [];
    for (const cls of members) {
        const clsPath = path.join(repoDir, `${cls}.cls`);
        if (!fs.existsSync(clsPath))
            continue;
        const content = await fs.readFile(clsPath, 'utf8');
        if (/@istest/i.test(content)) {
            testClasses.push(cls);
        }
        else {
            nonTestClasses.push(cls);
        }
    }
    return { testClasses, nonTestClasses };
}
/**
 * Ejecuta Salesforce Code Analyzer vía CLI
 */
async function runCodeAnalyzer(classes, repoDir) {
    const issues = [];
    for (const cls of classes) {
        const clsPath = path.join(repoDir, `${cls}.cls`);
        if (!fs.existsSync(clsPath))
            continue;
        try {
            const { stdout } = await (0, execa_1.execa)('sf', [
                'code-analyzer', 'run',
                '--workspace', path.resolve(repoDir, '../../..'),
                '--target', clsPath,
                '--output-format', 'json'
            ], { env: { FORCE_COLOR: '0' } });
            const data = JSON.parse(stdout);
            if (data.violations) {
                for (const v of data.violations) {
                    issues.push({
                        Clase: cls,
                        Regla: v.rule,
                        Mensaje: v.message,
                        Severidad: v.severity,
                        Archivo: v.locations?.[0]?.file,
                        Línea: v.locations?.[0]?.startLine
                    });
                }
            }
        }
        catch (err) {
            logger.error(`Error Code Analyzer (${cls}): ${err.shortMessage || err.message}`);
        }
    }
    return issues;
}
/**
 * Ejecuta PMD Copy Paste Detector
 */
async function runPMD(repoDir) {
    const minTokens = 100;
    const { stdout } = await (0, execa_1.execa)('pmd', [
        'cpd',
        '--minimum-tokens', String(minTokens),
        '--dir', repoDir,
        '--language', 'apex'
    ], { encoding: 'utf8' });
    return stdout.split('\n').filter(line => line.trim());
}
