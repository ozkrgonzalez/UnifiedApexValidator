// src/core/reportViewer.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

        panel.webview.html = content;
        vscode.window.showInformationMessage('📊 Reporte abierto en vista integrada.');
    }
    catch (err: any)
    {
        vscode.window.showErrorMessage(`Error al abrir el reporte: ${err.message}`);
    }
}
