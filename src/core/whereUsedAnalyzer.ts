import * as path from 'path';
import * as fs from 'fs-extra';
import * as vscode from 'vscode';
import { Logger } from './utils';
import {
    analyzeWhereUsedCore,
    collectClassNames,
    TraceLogger,
    WhereUsedCoreOptions,
    WhereUsedEntry
} from './whereUsedCore';

export async function analyzeWhereUsed(targets: string[]): Promise<WhereUsedEntry[]>
{
    const logger = new Logger('WhereUsedAnalyzer');
    const workspaceFolder = resolveWorkspaceFolder(targets);

    const repoDir = await resolveRepositoryDir(workspaceFolder, logger);
    const classNames = collectClassNames(targets);
    if (!classNames.size)
    {
        throw new Error('No fue posible determinar los nombres de clase Apex a partir de la selección.');
    }

    logger.info(`Clases objetivo: ${Array.from(classNames).join(', ')}`);
    logger.info(`Repositorio analizado: ${repoDir}`);

    const options: WhereUsedCoreOptions = {
        repoDir,
        classIdentifiers: targets,
        logger: wrapLogger(logger)
    };

    return analyzeWhereUsedCore(options);
}

function resolveWorkspaceFolder(targets: string[]): vscode.WorkspaceFolder
{
    if (targets.length)
    {
        for (const raw of targets)
        {
            if (!raw) continue;
            const uri = vscode.Uri.file(raw);
            const workspace = vscode.workspace.getWorkspaceFolder(uri);
            if (workspace)
            {
                return workspace;
            }
        }
    }

    const fallback = vscode.workspace.workspaceFolders?.[0];
    if (!fallback)
    {
        throw new Error('No se detectó un workspace abierto.');
    }
    return fallback;
}

async function resolveRepositoryDir(workspaceFolder: vscode.WorkspaceFolder, logger: Logger): Promise<string>
{
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    let repoDir = config.get<string>('sfRepositoryDir')?.trim() || '';

    if (!repoDir)
    {
        repoDir = workspaceFolder.uri.fsPath;
        logger.warn('sfRepositoryDir no configurado. Se usará la raíz del workspace.');
    }

    repoDir = path.resolve(repoDir);

    if (!(await fs.pathExists(repoDir)))
    {
        throw new Error(`La ruta configurada no existe: ${repoDir}`);
    }

    return repoDir;
}

function wrapLogger(logger: Logger): TraceLogger
{
    return {
        info: (message: string) => logger.info(message),
        warn: (message: string) => logger.warn(message)
    };
}

