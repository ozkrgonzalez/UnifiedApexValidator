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
exports.analyzeWhereUsed = analyzeWhereUsed;
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const vscode = __importStar(require("vscode"));
const utils_1 = require("./utils");
const i18n_1 = require("../i18n");
const whereUsedCore_1 = require("./whereUsedCore");
async function analyzeWhereUsed(targets) {
    const logger = new utils_1.Logger('WhereUsedAnalyzer');
    const workspaceFolder = resolveWorkspaceFolder(targets);
    const repoDir = await resolveRepositoryDir(workspaceFolder, logger);
    const classNames = (0, whereUsedCore_1.collectClassNames)(targets);
    if (!classNames.size) {
        throw new Error((0, i18n_1.localize)('error.whereUsedAnalyzer.noClassNames', 'Unable to derive Apex class names from the selection.'));
    }
    logger.info(`Clases objetivo: ${Array.from(classNames).join(', ')}`);
    logger.info(`Repositorio analizado: ${repoDir}`);
    const options = {
        repoDir,
        classIdentifiers: targets,
        logger: wrapLogger(logger)
    };
    return (0, whereUsedCore_1.analyzeWhereUsedCore)(options);
}
function resolveWorkspaceFolder(targets) {
    if (targets.length) {
        for (const raw of targets) {
            if (!raw)
                continue;
            const uri = vscode.Uri.file(raw);
            const workspace = vscode.workspace.getWorkspaceFolder(uri);
            if (workspace) {
                return workspace;
            }
        }
    }
    const fallback = vscode.workspace.workspaceFolders?.[0];
    if (!fallback) {
        throw new Error('No workspace folder detected.');
    }
    return fallback;
}
async function resolveRepositoryDir(workspaceFolder, logger) {
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    let repoDir = config.get('sfRepositoryDir')?.trim() || '';
    if (!repoDir) {
        repoDir = workspaceFolder.uri.fsPath;
        logger.warn((0, i18n_1.localize)('log.whereUsedAnalyzer.repoDefault', 'sfRepositoryDir not configured. Using workspace root.'));
    }
    repoDir = path.resolve(repoDir);
    if (!(await fs.pathExists(repoDir))) {
        throw new Error((0, i18n_1.localize)('error.whereUsedAnalyzer.repoMissing', 'Configured repository path does not exist: {0}', repoDir));
    }
    return repoDir;
}
function wrapLogger(logger) {
    return {
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message)
    };
}
