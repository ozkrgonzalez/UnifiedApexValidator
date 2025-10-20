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
exports.showWhereUsedPanel = showWhereUsedPanel;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
const whereUsedReport_1 = require("./whereUsedReport");
const logger = new utils_1.Logger('WhereUsedPanel');
async function showWhereUsedPanel(results) {
    const now = new Date();
    const safeTimestamp = formatTimestampForFile(now);
    const displayTimestamp = formatTimestampForDisplay(now);
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    let outputDir = config.get('outputDir')?.trim();
    if (outputDir) {
        outputDir = path.resolve(outputDir);
    }
    else {
        outputDir = undefined;
    }
    const { html, savedPath } = await (0, whereUsedReport_1.generateWhereUsedReport)(results, {
        timestamp: safeTimestamp,
        displayTimestamp,
        outputDir
    });
    const panel = vscode.window.createWebviewPanel('uav.whereIsUsed', `Where is Used — ${displayTimestamp}`, vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true
    });
    const themeClass = getVSCodeThemeClass();
    panel.webview.html = applyThemeClass(html, themeClass);
    if (savedPath) {
        logger.info(`Reporte guardado en ${savedPath}`);
    }
}
function formatTimestampForFile(date) {
    const pad = (value) => value.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}
function formatTimestampForDisplay(date) {
    try {
        const formatter = new Intl.DateTimeFormat(vscode.env.language || 'en', {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
        return formatter.format(date);
    }
    catch {
        return date.toISOString();
    }
}
function getVSCodeThemeClass() {
    const themeKind = vscode.window.activeColorTheme.kind;
    switch (themeKind) {
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
function applyThemeClass(html, themeClass) {
    const bodyClassPattern = /<body([^>]*)class="([^"]*)"/i;
    if (bodyClassPattern.test(html)) {
        return html.replace(bodyClassPattern, `<body$1class="${themeClass}"`);
    }
    return html.replace('<body', `<body class="${themeClass}"`);
}
