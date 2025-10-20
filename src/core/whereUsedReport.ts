import * as path from 'path';
import * as fs from 'fs-extra';
import * as nunjucks from 'nunjucks';
import * as vscode from 'vscode';
import { Logger } from './utils';
import { WhereUsedEntry } from './whereUsedCore';

const CATEGORY_DEFINITIONS = [
    { key: 'Apex', icon: '📘', label: 'Apex' },
    { key: 'Flows', icon: '⚡', label: 'Flow' },
    { key: 'LWC', icon: '💻', label: 'LWC' },
    { key: 'Triggers', icon: '🧱', label: 'Trigger' },
    { key: 'Metadata', icon: '📦', label: 'Metadata' }
] as const;

type CategoryKey = (typeof CATEGORY_DEFINITIONS)[number]['key'];

export interface WhereUsedReportOptions
{
    timestamp: string;
    displayTimestamp: string;
    outputDir?: string;
}

export interface GeneratedWhereUsedReport
{
    html: string;
    savedPath?: string;
}

const logger = new Logger('WhereUsedReport');

export async function generateWhereUsedReport(
    results: WhereUsedEntry[],
    options: WhereUsedReportOptions
): Promise<GeneratedWhereUsedReport>
{
    if (!results.length)
    {
        throw new Error('No se recibieron resultados para generar el reporte.');
    }

    const templatePath = resolveTemplatePath();
    const env = nunjucks.configure(path.dirname(templatePath), { autoescape: true });

    const viewModel = buildViewModel(results, options.displayTimestamp);
    const html = env.render(path.basename(templatePath), viewModel);

    let savedPath: string | undefined;
    if (options.outputDir)
    {
        try
        {
            await fs.ensureDir(options.outputDir);
            savedPath = path.join(options.outputDir, `where-is-used_${options.timestamp}.html`);
            await fs.writeFile(savedPath, html, 'utf8');
            //logger.info(`Reporte Where is Used guardado en ${savedPath}`);
        }
        catch (err)
        {
            logger.warn(`No se pudo guardar el reporte en disco: ${(err as Error).message}`);
        }
    }

    return { html, savedPath };
}

function resolveTemplatePath(): string
{
    const extension = vscode.extensions.getExtension('ozkrgonzalez.unifiedapexvalidator');
    const basePath = extension?.extensionPath || path.resolve(__dirname, '..');

    const distPath = path.join(basePath, 'dist', 'resources', 'templates', 'whereUsed_template.html');
    if (fs.existsSync(distPath))
    {
        return distPath;
    }

    const srcPath = path.join(basePath, 'src', 'resources', 'templates', 'whereUsed_template.html');
    if (fs.existsSync(srcPath))
    {
        return srcPath;
    }

    throw new Error('No se encontró el template whereUsed_template.html en dist ni en src.');
}

function buildViewModel(results: WhereUsedEntry[], displayTimestamp: string)
{
    const categoryTotals = CATEGORY_DEFINITIONS.map((category) =>
    {
        return {
            key: category.key,
            icon: category.icon,
            label: category.label,
            count: results.reduce((acc, entry) => acc + (entry.usedBy[category.key as CategoryKey]?.length || 0), 0)
        };
    });

    const entries = results.map((entry) =>
    {
        const categories = CATEGORY_DEFINITIONS.map((category) =>
        {
            const items = entry.usedBy[category.key as CategoryKey] || [];
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
