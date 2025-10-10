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
exports.TestSuite = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const execa_1 = require("execa");
const utils_1 = require("./utils");
/**
 * Módulo TestSuite
 */
class TestSuite {
    logger;
    sfPath;
    orgAlias;
    tempDir;
    constructor(workspaceRoot) {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        this.orgAlias = config.get('sfOrgAlias') || 'DEVSEGC';
        this.tempDir = path.join(workspaceRoot, '.uav', 'temp');
        // Logger dedicado a TestSuite (no pisa el canal principal)
        this.logger = new utils_1.Logger('TestSuite', false);
        this.tempDir = path.join((0, utils_1.getStorageRoot)(), 'temp');
        fs.ensureDirSync(this.tempDir);
        this.sfPath = this.resolveSfPath();
    }
    /**
     * Detecta CLI de Salesforce disponible
     */
    resolveSfPath() {
        const candidates = ['sf', 'sf.cmd', 'sf.CMD'];
        for (const cmd of candidates) {
            try {
                (0, execa_1.execaSync)(cmd, ['--version']);
                //this.logger.info(`🧭 Salesforce CLI detectado en PATH como: ${cmd}`);
                return cmd;
            }
            catch {
                continue;
            }
        }
        throw new Error('❌ No se encontró el CLI de Salesforce (sf) en el PATH.');
    }
    /**
     * Ejecuta un comando Salesforce y devuelve JSON limpio
     */
    async runSfCommand(command, description) {
        const env = { ...process.env, FORCE_COLOR: '0' };
        try {
            const child = (0, execa_1.execa)(command[0], command.slice(1), {
                encoding: 'utf8',
                env,
                stdout: 'pipe',
                stderr: 'pipe'
            });
            // Muestra solo información relevante
            child.stdout?.on('data', (data) => {
                const text = data.toString().trim();
                if (/TestRunId|outcome|status|passed|failing|error/i.test(text)) {
                }
            });
            child.stderr?.on('data', (data) => {
                const text = data.toString().trim();
            });
            const { stdout, stderr } = await child;
            const raw = (stdout || stderr || '').trim();
            try {
                return JSON.parse(raw);
            }
            catch {
                const cleaned = raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
                return JSON.parse(cleaned);
            }
        }
        catch (err) {
            this.logger.error(`❌ Error en ${description}: ${err.shortMessage || err.message}`);
            return {};
        }
    }
    /**
     * Lanza las clases de prueba y obtiene el testRunId
     */
    async executeTests(testClasses) {
        const command = [this.sfPath, 'apex', 'run', 'test', '--json', '--target-org', this.orgAlias, '--test-level', 'RunSpecifiedTests', '--code-coverage', '--class-names', ...testClasses];
        const result = await this.runSfCommand(command, 'ejecución de pruebas');
        const testRunId = result?.result?.testRunId ||
            result?.result?.summary?.testRunId ||
            null;
        if (!testRunId) {
            this.logger.error('❌ No se obtuvo testRunId del resultado.');
        }
        else {
            this.logger.info(`✅ TestRun iniciado correctamente (ID: ${testRunId}).`);
        }
        return testRunId;
    }
    /**
     * Espera a que el test run finalice
     */
    async waitForTestCompletion(testRunId) {
        this.logger.info(`⏳ Esperando finalización del testRunId ${testRunId}...`);
        for (let i = 0; i < 60; i++) {
            const command = [this.sfPath, 'apex', 'get', 'test', '--json', '--target-org', this.orgAlias, '--test-run-id', testRunId];
            const result = await this.runSfCommand(command, `verificando estado (${i + 1}/60)`);
            const summary = result?.result?.summary || {};
            const outcome = summary.outcome || 'Pendiente';
            const ran = Number(summary.testsRan || 0);
            const passing = Number(summary.passing || 0);
            const failing = Number(summary.failing || 0);
            if (ran === passing + failing && ran > 0) {
                this.logger.info(`✅ Ejecución completada para TestRun ${testRunId}.`);
                return result;
            }
            await new Promise((r) => setTimeout(r, 10000));
        }
        this.logger.warn('⚠️ Tiempo de espera agotado. Devolviendo resultado parcial.');
        return {};
    }
    /**
     * Obtiene resultados y cobertura
     */
    async fetchTestResults(testRunId) {
        const baseFile = path.join(this.tempDir, `test-result-${testRunId}.json`);
        const coverageFile = path.join(this.tempDir, `test-result-${testRunId}-codecoverage.json`);
        fs.ensureDirSync(this.tempDir);
        this.logger.info(`📥 Recuperando resultados del test run ${testRunId}...`);
        for (let i = 0; i < 3; i++) {
            const command = [this.sfPath, 'apex', 'get', 'test', '--json', '--target-org', this.orgAlias, '--test-run-id', testRunId, '--code-coverage', '--output-dir', this.tempDir];
            await this.runSfCommand(command, `obtención cobertura (intento ${i + 1})`);
            if (fs.existsSync(baseFile)) {
                const testResult = fs.readJsonSync(baseFile, { throws: false }) || {};
                const coverageSummary = testResult?.coverage?.coverage || [];
                let coverageDetail = {};
                if (fs.existsSync(coverageFile)) {
                    coverageDetail = fs.readJsonSync(coverageFile, { throws: false }) || {};
                }
                return { testResult, coverageSummary, coverageDetail };
            }
            await new Promise((r) => setTimeout(r, 10000));
        }
        this.logger.error('❌ No se pudieron obtener resultados tras varios intentos.');
        return {};
    }
    /**
     * Procesa la cobertura
     */
    extractCoverageData(coverageSummary, coverageDetail, apexClasses) {
        const filtered = [];
        const processed = new Set();
        if (Array.isArray(coverageSummary)) {
            for (const entry of coverageSummary) {
                const name = entry.name;
                if (apexClasses.includes(name)) {
                    filtered.push({
                        ClassName: name,
                        TotalLines: entry.totalLines || 0,
                        CoveredLines: entry.totalCovered || 0,
                        CoveragePercentage: `${entry.coveredPercent || 0}%`,
                        CoveragePercentageInt: entry.coveredPercent || 0
                    });
                    processed.add(name);
                }
            }
        }
        const missing = apexClasses.filter((cls) => !processed.has(cls));
        const detailList = coverageDetail?.result?.coverage?.coverage || [];
        for (const entry of detailList) {
            const name = entry.name;
            if (missing.includes(name)) {
                filtered.push({
                    ClassName: name,
                    TotalLines: entry.totalLines || 0,
                    CoveredLines: entry.lines?.totalCovered || 0,
                    CoveragePercentage: `${entry.lines?.coveredPercent || 0}%`,
                    CoveragePercentageInt: entry.lines?.coveredPercent || 0
                });
                processed.add(name);
            }
        }
        const stillMissing = apexClasses.filter((cls) => !processed.has(cls));
        for (const cls of stillMissing) {
            filtered.push({
                ClassName: cls,
                TotalLines: 0,
                CoveredLines: 0,
                CoveragePercentage: '0%',
                CoveragePercentageInt: 0
            });
        }
        return filtered;
    }
    /**
     * Procesa resultados de test
     */
    extractTestResults(testsList) {
        return testsList.map((t) => ({
            class_name: t.ApexClass?.Name || '',
            method_name: t.MethodName || '',
            outcome: t.Outcome || '',
            message: t.Message || '',
            stack_trace: t.StackTrace || ''
        }));
    }
    /**
     * Orquestador principal
     */
    async runTestSuite(testClasses, apexClasses) {
        if (!testClasses?.length) {
            this.logger.warn('⚠️ No se detectaron clases de prueba en el package.xml.');
            return { error: 'No hay clases test para ejecutar.', coverage_data: [], test_results: [] };
        }
        this.logger.info(`🧩 Ejecutando clases de prueba: ${testClasses.join(', ')}`);
        const testRunId = await this.executeTests(testClasses);
        if (!testRunId)
            return { error: 'No se pudo iniciar pruebas.', coverage_data: [], test_results: [] };
        this.logger.info(`⏱️ Monitoreando progreso del testRunId ${testRunId}...`);
        await this.waitForTestCompletion(testRunId);
        this.logger.info('📬 Ejecución de pruebas finalizada. Obteniendo resultados y cobertura...');
        const results = await this.fetchTestResults(testRunId);
        if (!results || Object.keys(results).length === 0) {
            this.logger.error('❌ No se pudieron obtener resultados del test run.');
            return { error: 'No se pudo obtener resultados.', coverage_data: [], test_results: [] };
        }
        this.logger.info('🧮 Procesando datos de cobertura y resultados individuales...');
        const testResult = results.testResult || {};
        const coverageSummary = results.coverageSummary || [];
        const coverageDetail = results.coverageDetail || {};
        const testsRaw = Array.isArray(testResult.tests)
            ? testResult.tests
            : typeof testResult === 'object' && 'tests' in testResult
                ? testResult.tests
                : [];
        const coverage = this.extractCoverageData(coverageSummary, coverageDetail, apexClasses);
        const tests = this.extractTestResults(testsRaw);
        const total = tests.length;
        const passed = tests.filter(t => t.outcome === 'Pass').length;
        const failed = tests.filter(t => t.outcome === 'Fail').length;
        const skipped = tests.filter(t => t.outcome === 'Skip').length;
        this.logger.info(`📊 Resumen: ${passed} pasados, ${failed} fallidos, ${skipped} omitidos, total ${total}.`);
        for (const test of tests) {
            const statusIcon = test.outcome === 'Pass' ? '✅' : test.outcome === 'Fail' ? '❌' : '⚠️';
            this.logger.info(`${statusIcon} ${test.class_name}.${test.method_name} → ${test.outcome}`);
            if (test.outcome === 'Fail' && test.message) {
                this.logger.warn(`   ↳ Motivo: ${test.message}`);
            }
        }
        this.logger.info('🏁 Fin de la ejecución de pruebas Apex.');
        return { coverage_data: coverage, test_results: tests };
    }
}
exports.TestSuite = TestSuite;
