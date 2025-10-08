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
exports.showReport = showReport;
// src/core/reportViewer.ts
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getVSCodeThemeClass() {
    const themeKind = vscode.window.activeColorTheme.kind;
    switch (themeKind) {
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
function showReport(htmlPath, title = 'Reporte de Validación Apex') {
    try {
        if (!fs.existsSync(htmlPath)) {
            vscode.window.showErrorMessage(`No se encontró el archivo: ${htmlPath}`);
            return;
        }
        const panel = vscode.window.createWebviewPanel('uavReport', title, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(path.dirname(htmlPath))]
        });
        const html = fs.readFileSync(htmlPath, 'utf8');
        const dirUri = vscode.Uri.file(path.dirname(htmlPath));
        const baseUri = panel.webview.asWebviewUri(dirUri);
        const themeClass = getVSCodeThemeClass();
        const content = html.replace(/<body([^>]*)>/i, `<body$1 class="${themeClass}">`).replace(/(<head>)/i, `$1<base href="${baseUri}/">`);
        panel.webview.html = content;
        vscode.window.showInformationMessage('📊 Reporte abierto en vista integrada.');
    }
    catch (err) {
        vscode.window.showErrorMessage(`Error al abrir el reporte: ${err.message}`);
    }
}
