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
exports.localize = localize;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const nls = __importStar(require("vscode-nls"));
const baseLocalize = nls.config({ messageFormat: nls.MessageFormat.file })();
let cachedBundle = null;
let bundleLoadAttempted = false;
function ensureBundleLoaded() {
    if (bundleLoadAttempted) {
        return;
    }
    bundleLoadAttempted = true;
    const bundlePath = path.join(__dirname, '..', 'i18n', 'extension.i18n.json');
    try {
        let contents = fs.readFileSync(bundlePath, 'utf8');
        if (contents.charCodeAt(0) === 0xFEFF) {
            contents = contents.slice(1);
        }
        cachedBundle = JSON.parse(contents);
    }
    catch (err) {
        console.warn('[UAV][i18n] Unable to load fallback bundle:', err);
        cachedBundle = {};
    }
}
function formatMessage(template, args) {
    return template.replace(/{(\d+)}/g, (match, indexRaw) => {
        const index = Number(indexRaw);
        if (Number.isNaN(index)) {
            return match;
        }
        const value = args[index];
        return value === undefined ? match : String(value);
    });
}
function localize(key, defaultValue, ...args) {
    const result = baseLocalize(key, defaultValue, ...args);
    const formattedDefault = formatMessage(defaultValue, args);
    if (result !== defaultValue && result !== formattedDefault) {
        return result;
    }
    ensureBundleLoaded();
    const template = cachedBundle?.[key];
    if (!template) {
        console.warn(`[UAV][i18n] Clave no encontrada en bundle: ${key}`);
        return formattedDefault;
    }
    return formatMessage(template, args);
}
