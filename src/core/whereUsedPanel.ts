import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './utils';
import { WhereUsedEntry } from './whereUsedCore';
import { generateWhereUsedReport } from './whereUsedReport';

const logger = new Logger('WhereUsedPanel');

export async function showWhereUsedPanel(results: WhereUsedEntry[]): Promise<void>
{
    const now = new Date();
    const safeTimestamp = formatTimestampForFile(now);
    const displayTimestamp = formatTimestampForDisplay(now);

    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    let outputDir = config.get<string>('outputDir')?.trim();
    if (outputDir)
    {
        outputDir = path.resolve(outputDir);
    }
    else
    {
        outputDir = undefined;
    }

    const { html, savedPath } = await generateWhereUsedReport(results, {
        timestamp: safeTimestamp,
        displayTimestamp,
        outputDir
    });

    const panel = vscode.window.createWebviewPanel(
        'uav.whereIsUsed',
        `Where is Used — ${displayTimestamp}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    const themeClass = getVSCodeThemeClass();
    panel.webview.html = applyThemeClass(html, themeClass);

    if (savedPath)
    {
        logger.info(`Reporte guardado en ${savedPath}`);
    }
}

function formatTimestampForFile(date: Date): string
{
    const pad = (value: number) => value.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function formatTimestampForDisplay(date: Date): string
{
    try
    {
        const formatter = new Intl.DateTimeFormat(vscode.env.language || 'en', {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
        return formatter.format(date);
    }
    catch
    {
        return date.toISOString();
    }
}

function getVSCodeThemeClass(): string
{
    const themeKind = vscode.window.activeColorTheme.kind;
    switch (themeKind)
    {
        case vscode.ColorThemeKind.Light:
            return 'vscode-light';
        case vscode.ColorThemeKind.Dark:
            return 'vscode-dark';
        case vscode.ColorThemeKind.HighContrast:
        case vscode.ColorThemeKind.HighContrastLight:
            return 'vscode-high-contrast';
        default:
            return 'vscode-light';
    }
}

function applyThemeClass(html: string, themeClass: string): string
{
    const bodyClassPattern = /<body([^>]*)class="([^"]*)"/i;
    if (bodyClassPattern.test(html))
    {
        return html.replace(bodyClassPattern, `<body$1class="${themeClass}"`);
    }

    return html.replace('<body', `<body class="${themeClass}"`);
}
