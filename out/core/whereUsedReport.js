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
exports.generateWhereUsedReport = generateWhereUsedReport;
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const nunjucks = __importStar(require("nunjucks"));
const vscode = __importStar(require("vscode"));
const utils_1 = require("./utils");
const CATEGORY_DEFINITIONS = [
    { key: 'Apex', icon: '📘', label: 'Apex' },
    { key: 'Flows', icon: '⚡', label: 'Flow' },
    { key: 'LWC', icon: '💻', label: 'LWC' },
    { key: 'Triggers', icon: '🧱', label: 'Trigger' },
    { key: 'Metadata', icon: '📦', label: 'Metadata' }
];
const logger = new utils_1.Logger('WhereUsedReport');
async function generateWhereUsedReport(results, options) {
    if (!results.length) {
        throw new Error('No se recibieron resultados para generar el reporte.');
    }
    const templatePath = resolveTemplatePath();
    const env = nunjucks.configure(path.dirname(templatePath), { autoescape: true });
    const viewModel = buildViewModel(results, options.displayTimestamp);
    const html = env.render(path.basename(templatePath), viewModel);
    let savedPath;
    if (options.outputDir) {
        try {
            await fs.ensureDir(options.outputDir);
            savedPath = path.join(options.outputDir, `where-is-used_${options.timestamp}.html`);
            await fs.writeFile(savedPath, html, 'utf8');
            //logger.info(`Reporte Where is Used guardado en ${savedPath}`);
        }
        catch (err) {
            logger.warn(`No se pudo guardar el reporte en disco: ${err.message}`);
        }
    }
    return { html, savedPath };
}
function resolveTemplatePath() {
    const extension = vscode.extensions.getExtension('ozkrgonzalez.unifiedapexvalidator');
    const basePath = extension?.extensionPath || path.resolve(__dirname, '..');
    const distPath = path.join(basePath, 'dist', 'resources', 'templates', 'whereUsed_template.html');
    if (fs.existsSync(distPath)) {
        return distPath;
    }
    const srcPath = path.join(basePath, 'src', 'resources', 'templates', 'whereUsed_template.html');
    if (fs.existsSync(srcPath)) {
        return srcPath;
    }
    throw new Error('No se encontró el template whereUsed_template.html en dist ni en src.');
}
function buildViewModel(results, displayTimestamp) {
    const categoryTotals = CATEGORY_DEFINITIONS.map((category) => {
        return {
            key: category.key,
            icon: category.icon,
            label: category.label,
            count: results.reduce((acc, entry) => acc + (entry.usedBy[category.key]?.length || 0), 0)
        };
    });
    const entries = results.map((entry) => {
        const categories = CATEGORY_DEFINITIONS.map((category) => {
            const items = entry.usedBy[category.key] || [];
            return {
                key: category.key,
                icon: category.icon,
                label: category.label,
                items,
                count: items.length
            };
        });
        const totalCount = categories.reduce((acc, cat) => acc + cat.count, 0);
        return {
            className: entry.class,
            categories,
            totalCount
        };
    });
    const totalReferences = categoryTotals.reduce((acc, cat) => acc + cat.count, 0);
    return {
        generatedAt: displayTimestamp,
        totalClasses: results.length,
        totalReferences,
        categoryTotals,
        entries
    };
}
