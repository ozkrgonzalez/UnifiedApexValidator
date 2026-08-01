// src/core/reportViewer.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import MarkdownIt from 'markdown-it';
import { createIaProvider } from './ai/providerFactory';

interface AiFixRequest
{
    type: 'aiFixRequest';
    requestId: string;
    kind: 'pmd' | 'cpd';
    clase: string;
    linea: string;
    regla: string;
    descripcion: string;
    codeSnippet: string;
}

const SNIPPET_CONTEXT_LINES = 8;

// html: false — this content comes from an LLM response and is inserted via
// innerHTML in the webview, so raw HTML passthrough is disabled defensively.
const aiFixMarkdown = new MarkdownIt({ html: false, linkify: true, typographer: true });

function resolveClassSnippet(className: string, line: number): string
{
    if (!className)
    {
        return '';
    }

    try
    {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
        {
            return '';
        }

        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const repoDir = config.get<string>('sfRepositoryDir')?.trim() || workspaceFolder.uri.fsPath;
        const firstClass = className.split(',')[0].trim();
        const matches = glob.sync(`**/${firstClass}.cls`, { cwd: repoDir, absolute: true });
        if (!matches.length)
        {
            return '';
        }

        const content = fs.readFileSync(matches[0], 'utf8');
        const lines = content.split(/\r?\n/);
        const lineNum = Number(line) || 1;
        const start = Math.max(0, lineNum - 1 - SNIPPET_CONTEXT_LINES);
        const end = Math.min(lines.length, lineNum + SNIPPET_CONTEXT_LINES);
        return lines.slice(start, end).join('\n');
    }
    catch
    {
        return '';
    }
}

function buildAiFixPrompt(message: AiFixRequest, snippet: string): string
{
    const parts = [
        'You are an expert Salesforce Apex developer. A static analysis tool flagged the following issue:',
        `Class: ${message.clase}`,
        `Line: ${message.linea}`,
        `Rule: ${message.regla}`,
        `Description: ${message.descripcion}`
    ];

    if (snippet)
    {
        parts.push('', 'Relevant code:', '```apex', snippet, '```');
    }

    parts.push(
        '',
        'Suggest a concise fix. Briefly explain why, then show the corrected code in an apex code block.'
    );

    return parts.join('\n');
}

async function handleAiFixRequest(panel: vscode.WebviewPanel, message: AiFixRequest): Promise<void>
{
    try
    {
        const snippet = message.codeSnippet?.trim() || resolveClassSnippet(message.clase, Number(message.linea));
        const prompt = buildAiFixPrompt(message, snippet);
        const provider = await createIaProvider();
        const result = await provider.generate(prompt);
        const suggestionHtml = aiFixMarkdown.render(result.resumen || '');

        panel.webview.postMessage({
            type: 'aiFixResult',
            requestId: message.requestId,
            ok: true,
            suggestionHtml
        });
    }
    catch (err: any)
    {
        const reason = err?.message || String(err);
        panel.webview.postMessage({
            type: 'aiFixResult',
            requestId: message.requestId,
            ok: false,
            error: reason
        });
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
            return 'vscode-high-contrast';
        default:
            return 'vscode-light';
    }
}

export function showReport(htmlPath: string, title = 'Reporte de Validación Apex')
{
    try
    {
        if (!fs.existsSync(htmlPath))
        {
            vscode.window.showErrorMessage(`No se encontró el archivo: ${htmlPath}`);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'uavReport',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.dirname(htmlPath))]
            }
        );

        const html = fs.readFileSync(htmlPath, 'utf8');
        const dirUri = vscode.Uri.file(path.dirname(htmlPath));
        const baseUri = panel.webview.asWebviewUri(dirUri);
        const themeClass = getVSCodeThemeClass();

        const content = html.replace(
            /<body([^>]*)>/i,
            `<body$1 class="${themeClass}">`
        ).replace(
            /(<head>)/i,
            `$1<base href="${baseUri}/">`
        );

        panel.webview.onDidReceiveMessage((message: AiFixRequest) =>
        {
            if (message?.type === 'aiFixRequest')
            {
                void handleAiFixRequest(panel, message);
            }
        });

        panel.webview.html = content;
        vscode.window.showInformationMessage('📊 Reporte abierto en vista integrada.');
    }
    catch (err: any)
    {
        vscode.window.showErrorMessage(`Error al abrir el reporte: ${err.message}`);
    }
}
