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
const i18n_1 = require("../i18n");
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
                this.logger.warn((0, i18n_1.localize)('log.testSuite.nonJsonOutput', 'Warning {0} returned non-JSON output: {1}', description, raw)); // Localized string
            }
            return {};
        }
        catch (err) {
            const parsed = (0, utils_1.parseSfJson)(err?.stdout) ?? (0, utils_1.parseSfJson)(err?.stderr);
            if (parsed) {
                this.logger.warn((0, i18n_1.localize)('log.testSuite.jsonProvidedOnError', 'Warning {0} finished with an error but returned JSON data.', description)); // Localized string
                return parsed;
            }
            this.logger.error((0, i18n_1.localize)('log.testSuite.commandError', '❌ Error during {0}: {1}', description, err.shortMessage || err.message)); // Localized string
            return {};
        }
    }
    /**
     * Lanza las clases de prueba y obtiene el testRunId
     */
    async executeTests(testClasses, targetOrg) {
        const command = [this.sfPath, 'apex', 'run', 'test', '--json', '--target-org', targetOrg, '--test-level', 'RunSpecifiedTests', '--code-coverage', '--class-names', ...testClasses];
        const result = await this.runSfCommand(command, (0, i18n_1.localize)('label.testSuite.runTests', 'test execution')); // Localized string
        const testRunId = result?.result?.testRunId ||
            result?.result?.summary?.testRunId ||
            null;
        if (!testRunId) {
            this.logger.error((0, i18n_1.localize)('error.testSuite.noTestRunId', '❌ The test run did not return a testRunId.')); // Localized string
        }
        else {
            this.logger.info((0, i18n_1.localize)('log.testSuite.testRunStarted', '🚀 Test run started successfully (ID: {0}).', testRunId)); // Localized string
        }
        return testRunId;
    }
    /**
     * Espera a que el test run finalice
     */
    async waitForTestCompletion(testRunId, targetOrg) {
        this.logger.info((0, i18n_1.localize)('log.testSuite.waitingForCompletion', '⏳ Waiting for testRunId {0} to complete...', testRunId)); // Localized string
        for (let i = 0; i < 60; i++) {
            const command = [this.sfPath, 'apex', 'get', 'test', '--json', '--target-org', targetOrg, '--test-run-id', testRunId];
            const result = await this.runSfCommand(command, (0, i18n_1.localize)('label.testSuite.checkingStatus', 'checking status ({0}/60)', i + 1)); // Localized string
            const summary = result?.result?.summary || {};
            const outcome = summary.outcome || (0, i18n_1.localize)('label.testSuite.pending', 'Pending'); // Localized string
            const ran = Number(summary.testsRan || 0);
            const passing = Number(summary.passing || 0);
            const failing = Number(summary.failing || 0);
            if (ran === passing + failing && ran > 0) {
                this.logger.info((0, i18n_1.localize)('log.testSuite.executionCompleted', '✅ Execution completed for testRun {0}.', testRunId)); // Localized string
                return result;
            }
            await new Promise((r) => setTimeout(r, 10000));
        }
        this.logger.warn((0, i18n_1.localize)('log.testSuite.waitTimeout', '⚠️ Timeout exceeded. Returning partial result.')); // Localized string
        return {};
    }
    /**
     * Obtiene resultados y cobertura
     */
    async fetchTestResults(testRunId, targetOrg) {
        const baseFile = path.join(this.tempDir, `test-result-${testRunId}.json`);
        const coverageFile = path.join(this.tempDir, `test-result-${testRunId}-codecoverage.json`);
        fs.ensureDirSync(this.tempDir);
        this.logger.info((0, i18n_1.localize)('log.testSuite.fetchingResults', '📦 Retrieving test run results for {0}...', testRunId)); // Localized string
        for (let i = 0; i < 3; i++) {
            const command = [this.sfPath, 'apex', 'get', 'test', '--json', '--target-org', targetOrg, '--test-run-id', testRunId, '--code-coverage', '--output-dir', this.tempDir];
            await this.runSfCommand(command, (0, i18n_1.localize)('label.testSuite.fetchCoverageAttempt', 'fetching coverage (attempt {0})', i + 1)); // Localized string
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
        this.logger.error((0, i18n_1.localize)('error.testSuite.resultsAttemptsFailed', '❌ Could not retrieve results after multiple attempts.')); // Localized string
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
            this.logger.warn((0, i18n_1.localize)('log.testSuite.noTestClassesInPackage', '⚠️ No test classes were detected in package.xml.')); // Localized string
            return { error: (0, i18n_1.localize)('error.testSuite.noTestClasses', 'There are no test classes to run.'), coverage_data: [], test_results: [] }; // Localized string
        }
        this.logger.info((0, i18n_1.localize)('log.testSuite.runningTestClasses', '🧪 Running test classes: {0}', testClasses.join(', '))); // Localized string
        const defaultOrg = await (0, utils_1.getDefaultConnectedOrg)(this.logger);
        if (!defaultOrg) {
            const message = (0, i18n_1.localize)('error.testSuite.noDefaultOrg', 'No default org connected in Salesforce CLI.'); // Localized string
            this.logger.error(message);
            return { error: message, coverage_data: [], test_results: [] };
        }
        const targetOrg = defaultOrg.alias || defaultOrg.username;
        const displayOrg = defaultOrg.alias && defaultOrg.alias !== defaultOrg.username
            ? `${defaultOrg.alias} (${defaultOrg.username})`
            : defaultOrg.username;
        this.logger.info((0, i18n_1.localize)('log.testSuite.usingDefaultOrg', '🌐 Using default org: {0}.', displayOrg)); // Localized string
        const testRunId = await this.executeTests(testClasses, targetOrg);
        if (!testRunId)
            return { error: (0, i18n_1.localize)('error.testSuite.testsNotStarted', 'Tests could not be started.'), coverage_data: [], test_results: [] }; // Localized string
        this.logger.info((0, i18n_1.localize)('log.testSuite.monitoringProgress', '🔍 Monitoring progress for testRunId {0}...', testRunId)); // Localized string
        await this.waitForTestCompletion(testRunId, targetOrg);
        this.logger.info((0, i18n_1.localize)('log.testSuite.runCompleted', '📈 Test execution finished. Retrieving results and coverage...')); // Localized string
        const results = await this.fetchTestResults(testRunId, targetOrg);
        if (!results || Object.keys(results).length === 0) {
            this.logger.error((0, i18n_1.localize)('error.testSuite.noResults', '❌ Could not retrieve test run results.')); // Localized string
            return { error: (0, i18n_1.localize)('error.testSuite.resultsUnavailable', 'Results could not be retrieved.'), coverage_data: [], test_results: [] }; // Localized string
        }
        this.logger.info((0, i18n_1.localize)('log.testSuite.processingData', '📝 Processing coverage data and individual results...')); // Localized string
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
        this.logger.info((0, i18n_1.localize)('log.testSuite.summary', '📋 Summary: {0} passed, {1} failed, {2} skipped, {3} total.', passed, failed, skipped, total)); // Localized string
        for (const test of tests) {
            const statusIcon = test.outcome === 'Pass' ? '✅' : test.outcome === 'Fail' ? '❌' : '⚠️';
            this.logger.info((0, i18n_1.localize)('log.testSuite.testOutcome', '{0} {1}.{2} \u2192 {3}', statusIcon, test.class_name, test.method_name, test.outcome)); // Localized string
            if (test.outcome === 'Fail' && test.message) {
                this.logger.warn((0, i18n_1.localize)('log.testSuite.failureReason', '   💬 Reason: {0}', test.message)); // Localized string
            }
        }
        this.logger.info((0, i18n_1.localize)('log.testSuite.testsFinished', '🎉 Apex test execution completed.')); // Localized string
        return { coverage_data: coverage, test_results: tests };
    }
}
exports.TestSuite = TestSuite;
