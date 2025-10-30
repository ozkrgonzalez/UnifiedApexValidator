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
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const execa_1 = require("execa");
const utils_1 = require("./utils");
/**
 * Modulo TestSuite
 */
class TestSuite {
    logger;
    sfPath;
    tempDir;
    constructor(workspaceRoot) {
        this.tempDir = path.join(workspaceRoot, '.uav', 'temp');
        // Logger dedicado a TestSuite (no pisa el canal principal)
        this.logger = new utils_1.Logger('TestSuite', false);
        this.tempDir = path.join((0, utils_1.getStorageRoot)(), 'temp');
        fs.ensureDirSync(this.tempDir);
        this.sfPath = (0, utils_1.resolveSfCliPath)();
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
            // Muestra solo informacion relevante
            child.stdout?.on('data', (data) => {
                const text = data.toString().trim();
                if (/TestRunId|outcome|status|passed|failing|error/i.test(text)) {
                }
            });
            child.stderr?.on('data', (data) => {
                const text = data.toString().trim();
            });
            const { stdout, stderr } = await child;
            const parsed = (0, utils_1.parseSfJson)(stdout) ?? (0, utils_1.parseSfJson)(stderr);
            if (parsed) {
                return parsed;
            }
            const raw = (stdout || stderr || '').trim();
            if (raw) {
                this.logger.warn(`Warning ${description} devolvio salida no JSON: ${raw}`);
            }
            return {};
        }
        catch (err) {
            const parsed = (0, utils_1.parseSfJson)(err?.stdout) ?? (0, utils_1.parseSfJson)(err?.stderr);
            if (parsed) {
                this.logger.warn(`Warning ${description} finalizo con error pero entrego datos JSON.`);
                return parsed;
            }
            this.logger.error(`\u274C Error en ${description}: ${err.shortMessage || err.message}`);
            return {};
        }
    }
    /**
     * Lanza las clases de prueba y obtiene el testRunId
     */
    async executeTests(testClasses, targetOrg) {
        const command = [this.sfPath, 'apex', 'run', 'test', '--json', '--target-org', targetOrg, '--test-level', 'RunSpecifiedTests', '--code-coverage', '--class-names', ...testClasses];
        const result = await this.runSfCommand(command, 'ejecucion de pruebas');
        const testRunId = result?.result?.testRunId ||
            result?.result?.summary?.testRunId ||
            null;
        if (!testRunId) {
            this.logger.error('❌ No se obtuvo testRunId del resultado.');
        }
        else {
            this.logger.info(`🚀 TestRun iniciado correctamente (ID: ${testRunId}).`);
        }
        return testRunId;
    }
    /**
     * Espera a que el test run finalice
     */
    async waitForTestCompletion(testRunId, targetOrg) {
        this.logger.info(`⏳ Esperando finalización del testRunId ${testRunId}...`);
        for (let i = 0; i < 60; i++) {
            const command = [this.sfPath, 'apex', 'get', 'test', '--json', '--target-org', targetOrg, '--test-run-id', testRunId];
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
    async fetchTestResults(testRunId, targetOrg) {
        const baseFile = path.join(this.tempDir, `test-result-${testRunId}.json`);
        const coverageFile = path.join(this.tempDir, `test-result-${testRunId}-codecoverage.json`);
        fs.ensureDirSync(this.tempDir);
        this.logger.info(`\u{1F4E6} Recuperando resultados del test run ${testRunId}...`);
        for (let i = 0; i < 3; i++) {
            const command = [this.sfPath, 'apex', 'get', 'test', '--json', '--target-org', targetOrg, '--test-run-id', testRunId, '--code-coverage', '--output-dir', this.tempDir];
            await this.runSfCommand(command, `obtencion cobertura (intento ${i + 1})`);
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
        this.logger.info(`🧪 Ejecutando clases de prueba: ${testClasses.join(', ')}`);
        const defaultOrg = await (0, utils_1.getDefaultConnectedOrg)(this.logger);
        if (!defaultOrg) {
            const message = 'No se detectó una org por defecto conectada en Salesforce CLI.';
            this.logger.error(message);
            return { error: message, coverage_data: [], test_results: [] };
        }
        const targetOrg = defaultOrg.alias || defaultOrg.username;
        const displayOrg = defaultOrg.alias && defaultOrg.alias !== defaultOrg.username
            ? `${defaultOrg.alias} (${defaultOrg.username})`
            : defaultOrg.username;
        this.logger.info(`🌐 Usando la org por defecto: ${displayOrg}.`);
        const testRunId = await this.executeTests(testClasses, targetOrg);
        if (!testRunId)
            return { error: 'No se pudo iniciar pruebas.', coverage_data: [], test_results: [] };
        this.logger.info(`🔍 Monitoreando progreso del testRunId ${testRunId}...`);
        await this.waitForTestCompletion(testRunId, targetOrg);
        this.logger.info('📈 Ejecución de pruebas finalizada. Obteniendo resultados y cobertura...');
        const results = await this.fetchTestResults(testRunId, targetOrg);
        if (!results || Object.keys(results).length === 0) {
            this.logger.error('❌ No se pudieron obtener resultados del test run.');
            return { error: 'No se pudo obtener resultados.', coverage_data: [], test_results: [] };
        }
        this.logger.info('📝 Procesando datos de cobertura y resultados individuales...');
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
        const passed = tests.filter((t) => t.outcome === 'Pass').length;
        const failed = tests.filter((t) => t.outcome === 'Fail').length;
        const skipped = tests.filter((t) => t.outcome === 'Skip').length;
        this.logger.info(`📋 Resumen: ${passed} pasados, ${failed} fallidos, ${skipped} omitidos, total ${total}.`);
        for (const test of tests) {
            const statusIcon = test.outcome === 'Pass' ? '✅' : test.outcome === 'Fail' ? '❌' : '⚠️';
            this.logger.info(`${statusIcon} ${test.class_name}.${test.method_name} → ${test.outcome}`);
            if (test.outcome === 'Fail' && test.message) {
                this.logger.warn(`   💬 Motivo: ${test.message}`);
            }
        }
        this.logger.info('🎉 Fin de la ejecución de pruebas Apex.');
        return { coverage_data: coverage, test_results: tests };
    }
}
exports.TestSuite = TestSuite;
