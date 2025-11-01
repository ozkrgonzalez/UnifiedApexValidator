import * as vscode from 'vscode';
import { ApexAstParser, ApexChunk } from './apexAstParser';
import { AiDocChunkRunner } from '../core/aiDocChunkRunner';
import { PatchApplier } from '../core/patchApplier';
import { Logger } from '../core/utils';
import { evaluateIaConfig } from './IAAnalisis';
import { localize } from '../i18n';

export async function generateApexDocChunked()
{
    const editor = vscode.window.activeTextEditor;
    if (!editor)
    {
        vscode.window.showErrorMessage(localize('error.generateApexDoc.noEditor', '❌ No hay ningún archivo abierto.'));
        return;
    }

    const iaStatus = evaluateIaConfig();
    if (!iaStatus.ready)
    {
        vscode.window.showWarningMessage(
            localize(
                'warn.generateApexDoc.iaDisabled',
                '⚠️ Generación de ApexDoc deshabilitada. Faltan parámetros IA: {0}',
                iaStatus.missing.join(', ')
            )
        );
        return;
    }

    const logger = new Logger('GenerateApexDoc', true);
    const doc = editor.document;
    const original = doc.getText();
    let working = original;

    const chunks = ApexAstParser.parseDocument(doc);

    const traceAst = vscode.workspace.getConfiguration('UnifiedApexValidator').get<boolean>('traceAst') ?? false;
    logger.info(localize('log.generateApexDoc.chunksDetected', '🧩 Chunks detectados: {0}', chunks.length));
    if (traceAst)
    {
        const statusPending = localize('log.generateApexDoc.docPending', 'pendiente');
        const statusOk = localize('log.generateApexDoc.docOk', 'ok');

        for (const ch of chunks)
        {
            const status = ch.needsDoc ? statusPending : statusOk;
            logger.info(
                localize(
                    'log.generateApexDoc.chunkDetail',
                    '  • {0} {1} ({2}-{3}) doc={4}',
                    ch.kind.padEnd(12),
                    ch.name.padEnd(60),
                    ch.start,
                    ch.end,
                    status
                )
            );
        }
    }

    const missing = chunks.filter((c) => c.needsDoc);
    let fatalError: string | undefined;

    if (!missing.length)
    {
        vscode.window.showInformationMessage(
            localize('info.generateApexDoc.allDocumented', '✅ Todos los elementos ya tienen ApexDoc.')
        );
        return;
    }

    const progressOptions =
    {
        location: vscode.ProgressLocation.Notification,
        title: localize('progress.generateApexDoc.title', 'Revisión de ApexDoc generados'),
        cancellable: true
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) =>
    {
        const total = missing.length;
        let done = 0;

        const locateChunk = (source: string, snippet: string, hint: number): number =>
        {
            if (!snippet) return -1;

            const primary = source.indexOf(snippet, Math.max(0, hint));
            if (primary !== -1) return primary;

            const trimmed = snippet.trim();
            if (trimmed && trimmed !== snippet)
            {
                const fallback = source.indexOf(trimmed, Math.max(0, hint));
                if (fallback !== -1) return fallback;
            }

            return -1;
        };

        let searchCursor = 0;

        for (const chunk of missing)
        {
            if (token.isCancellationRequested)
            {
                break;
            }

            done += 1;
            progress.report({
                message: localize(
                    'progress.generateApexDoc.processing',
                    'Procesando {0} "{1}" ({2}/{3})',
                    chunk.kind,
                    chunk.name,
                    done,
                    total
                )
            });
            logger.info(
                localize(
                    'log.generateApexDoc.generating',
                    '✏️ Generando doc para: {0} "{1}"',
                    chunk.kind,
                    chunk.name
                )
            );

            const snippet = chunk.text;
            let realStart = locateChunk(working, snippet, searchCursor);

            if (realStart === -1)
            {
                realStart = locateChunk(working, snippet, 0);
            }

            if (realStart === -1)
            {
                logger.warn(
                    localize(
                        'warn.generateApexDoc.chunkMissing',
                        '❗ No se encontró el fragmento actualizado para {0}; se omite.',
                        chunk.name
                    )
                );
                continue;
            }

            const realEnd = realStart + snippet.length;
            const currentSlice = working.substring(realStart, realEnd);
            const localChunk = { ...chunk, start: realStart, end: realEnd, text: currentSlice };

            const result = await AiDocChunkRunner.processChunk(working, localChunk);

            if (result.ok && result.patchedText)
            {
                try
                {
                    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
                    const outputDir =
                        config.get<string>('outputDir') ||
                        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
                        __dirname;

                    const safeName = `${chunk.kind}_${chunk.name.replace(/[^a-zA-Z0-9_]/g, '_')}.txt`;
                    const rawPath = vscode.Uri.file(`${outputDir}/ApexDoc_Debug_${safeName}`);
                    await vscode.workspace.fs.writeFile(rawPath, Buffer.from(result.patchedText, 'utf8'));
                    logger.info(
                        localize(
                            'log.generateApexDoc.rawSaved',
                            '💾 Guardado bloque IA crudo para {0} en {1}',
                            chunk.name,
                            rawPath.fsPath
                        )
                    );

                    const matches = [...result.patchedText.matchAll(/\/\*\*[\s\S]*?\*\//g)];
                    if (matches.length > 0)
                    {
                        for (let i = 0; i < matches.length; i++)
                        {
                            const block = matches[i][0];
                            const blkPath = vscode.Uri.file(`${outputDir}/ApexDoc_Debug_${chunk.kind}_${chunk.name.replace(/[^a-zA-Z0-9_]/g, '_')}_${i}.txt`);
                            await vscode.workspace.fs.writeFile(blkPath, Buffer.from(block, 'utf8'));
                        }

                        let docBlock = matches[0][0];
                        if (chunk.kind === 'classHeader')
                        {
                            docBlock = ensureClassPlaceholders(docBlock);
                        }
                        else if (chunk.kind === 'method')
                        {
                            docBlock = ensureMethodPlaceholders(docBlock, chunk, false);
                        }
                        else if (chunk.kind === 'constructor')
                        {
                            docBlock = ensureMethodPlaceholders(docBlock, chunk, true);
                        }
                        working = PatchApplier.applyInMemory(working, localChunk, docBlock);
                        searchCursor = realStart + docBlock.length + snippet.length;
                        logger.info(
                            localize(
                                'log.generateApexDoc.docInserted',
                                '📝 Documentación insertada para {0} ({1} bloque(s) detectados)',
                                chunk.name,
                                matches.length
                            )
                        );
                    }
                    else
                    {
                        logger.warn(
                            localize(
                                'warn.generateApexDoc.noBlocks',
                                '⚠️ No se detectaron bloques ApexDoc en la respuesta para {0}',
                                chunk.name
                            )
                        );
                    }
                }
                catch (err: any)
                {
                    logger.warn(
                        localize(
                            'warn.generateApexDoc.saveError',
                            '⚠️ Error guardando/insertando doc para {0}: {1}',
                            chunk.name,
                            err.message
                        )
                    );
                }
            }
            else if (result.fatal)
            {
                fatalError =
                    result.error ||
                    localize('error.generateApexDoc.fatal', '❌ Error fatal al invocar el servicio de IA.');
                logger.error(
                    localize(
                        'error.generateApexDoc.processStopped',
                        '🚫 Proceso detenido para {0}: {1}',
                        chunk.name,
                        fatalError
                    )
                );
                break;
            }
            else
            {
                logger.warn(
                    localize(
                        'warn.generateApexDoc.failure',
                        '⚠️ Fallo {0}: {1}',
                        chunk.name,
                        result.error
                    )
                );
            }

            if (searchCursor < realStart + snippet.length)
            {
                searchCursor = realStart + snippet.length;
            }
        }

        if (fatalError)
        {
            return;
        }
    });

    if (fatalError)
    {
        vscode.window.showErrorMessage(
            localize('error.generateApexDoc.final', '❌ No se pudo generar ApexDoc: {0}', fatalError)
        );
        return;
    }

    const diffTitle = localize('ui.generateApexDoc.diffTitle', 'Comparar documentación generada (chunked)');
    await PatchApplier.openFinalDiff(original, working, doc.uri, diffTitle);

    const applyQuestion = localize(
        'prompt.generateApexDoc.applyQuestion',
        'Revisa el diff abierto. ¿Quieres aplicar la documentación generada al archivo?'
    );
    const applyOption = localize('prompt.generateApexDoc.apply', 'Aplicar');
    const skipOption = localize('prompt.generateApexDoc.skip', 'Omitir');

    let applyAnswer: string | undefined;
    while (!applyAnswer)
    {
        applyAnswer = await vscode.window.showInformationMessage(applyQuestion, applyOption, skipOption);
    }

    if (applyAnswer === applyOption)
    {
        const targetEditor = await vscode.window.showTextDocument(doc, { preview: false });
        const applied = await targetEditor.edit((editBuilder) =>
        {
            const start = new vscode.Position(0, 0);
            const lastLine = doc.lineCount > 0 ? doc.lineAt(doc.lineCount - 1) : undefined;
            const end = lastLine ? lastLine.range.end : start;
            editBuilder.replace(new vscode.Range(start, end), working);
        });

        if (applied)
        {
            logger.info(localize('log.generateApexDoc.docsApplied', '✅ Documentación aplicada al archivo.'));
            await doc.save();
        }
        else
        {
            logger.warn(
                localize(
                    'warn.generateApexDoc.applyFailed',
                    '⚠️ No fue posible aplicar la documentación al archivo.'
                )
            );
        }
    }
    else
    {
        logger.info(
            localize('log.generateApexDoc.userSkipped', 'ℹ️ Documentación generada omitida por el usuario.')
        );
    }
}

interface DocBlockMetadata
{
    lines: string[];
    closingLineIndex: number;
    indent: string;
}

function analyzeDocBlock(docBlock: string): DocBlockMetadata | undefined
{
    const lines = docBlock.split(/\r?\n/);
    const closeIndex = [...lines].reverse().findIndex((line) => line.trim().startsWith('*/'));
    if (closeIndex === -1) return undefined;

    const closingLineIndex = lines.length - 1 - closeIndex;
    let indent = '';
    for (const line of lines)
    {
        const match = line.match(/^(\s*)\*/);
        if (match)
        {
            indent = match[1];
            break;
        }
    }

    return { lines, closingLineIndex, indent };
}

function normalizeTags(settingKey: string, fallback: string[]): string[]
{
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const configured = config.get<string[]>(settingKey) ?? fallback;
    return configured
        .map((tag) => (tag.startsWith('@') ? tag : `@${tag}`))
        .map((tag) => tag.trim())
        .filter((tag, index, array) => tag.length > 1 && array.indexOf(tag) === index);
}

function docBlockHasTag(docBlock: string, tag: string): boolean
{
    const tagPattern = new RegExp(`\\*\\s*${tag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
    return tagPattern.test(docBlock);
}

function ensureClassPlaceholders(docBlock: string): string
{
    const normalized = normalizeTags('classDocTags', ['@description', '@since', '@author', '@testClass']);
    if (!normalized.length) return docBlock;

    const metadata = analyzeDocBlock(docBlock);
    if (!metadata) return docBlock;

    const { lines, closingLineIndex, indent } = metadata;
    const missing = normalized.filter((tag) => !docBlockHasTag(docBlock, tag));
    if (!missing.length) return docBlock;

    const insertionLines = missing.map((tag) => `${indent} * ${tag} `);
    lines.splice(closingLineIndex, 0, ...insertionLines);

    return lines.join('\n');
}

function ensureMethodPlaceholders(docBlock: string, chunk: ApexChunk, isConstructor: boolean): string
{
    const normalized = normalizeTags('methodDocTags', ['@description', '@param', '@return']);
    if (!normalized.length) return docBlock;

    const metadata = analyzeDocBlock(docBlock);
    if (!metadata) return docBlock;

    const { lines, closingLineIndex, indent } = metadata;
    const methodInfo = extractMethodMetadata(chunk, isConstructor);
    const insertionLines: string[] = [];
    const existingParams = new Set<string>(
        [...docBlock.matchAll(/\*\s*@param\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((match) => match[1].toLowerCase())
    );

    for (const tag of normalized)
    {
        const lower = tag.toLowerCase();

        if (lower === '@param')
        {
            if (!methodInfo.params.length) continue;

            for (const paramName of methodInfo.params)
            {
                if (!existingParams.has(paramName.toLowerCase()))
                {
                    insertionLines.push(`${indent} * @param ${paramName} `);
                }
            }
            continue;
        }

        if (lower === '@return')
        {
            if (isConstructor || methodInfo.returnsVoid) continue;
            if (docBlockHasTag(docBlock, tag)) continue;

            if (methodInfo.returnType)
            {
                insertionLines.push(`${indent} * @return \`${methodInfo.returnType}\` `);
            }
            else
            {
                insertionLines.push(`${indent} * @return `);
            }
            continue;
        }

        if (!docBlockHasTag(docBlock, tag))
        {
            insertionLines.push(`${indent} * ${tag} `);
        }
    }

    if (!insertionLines.length) return docBlock;

    lines.splice(closingLineIndex, 0, ...insertionLines);

    return lines.join('\n');
}

interface MethodMetadata
{
    params: string[];
    returnsVoid: boolean;
    returnType?: string;
}

function extractMethodMetadata(chunk: ApexChunk, isConstructor: boolean): MethodMetadata
{
    const beforeBody = chunk.text.split('{', 1)[0] ?? chunk.text;
    const sanitized = beforeBody
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ');

    const lines = sanitized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('@'));

    const header = lines.join(' ');
    const methodPattern = new RegExp(`\\b${chunk.name}\\s*\\(`);
    const match = methodPattern.exec(header);

    if (!match)
    {
        return {
            params: [],
            returnsVoid: isConstructor,
            returnType: isConstructor ? undefined : undefined
        };
    }

    const prefix = header.slice(0, match.index).trim();
    const suffix = header.slice(match.index);

    const paramsStart = suffix.indexOf('(');
    let paramsEnd = -1;
    let depth = 0;
    for (let i = paramsStart; i < suffix.length; i++)
    {
        const char = suffix[i];
        if (char === '(')
        {
            depth++;
        }
        else if (char === ')')
        {
            depth--;
            if (depth === 0)
            {
                paramsEnd = i;
                break;
            }
        }
    }

    const paramSegment = paramsEnd > paramsStart ? suffix.slice(paramsStart + 1, paramsEnd) : '';
    const params = splitParameterList(paramSegment);

    if (isConstructor)
    {
        return {
            params,
            returnsVoid: true,
            returnType: undefined
        };
    }

    const tokens = tokenizeSignaturePrefix(prefix);
    const filtered = tokens.filter((token) =>
    {
        const lower = token.toLowerCase();
        if (lower === 'with' || lower === 'without' || lower === 'sharing') return false;
        return ![
            'public',
            'private',
            'protected',
            'global',
            'static',
            'virtual',
            'override',
            'abstract',
            'final',
            'transient',
            'testmethod',
            'webservice',
            'future',
            'synchronized'
        ].includes(lower);
    });

    const returnType = filtered.length ? filtered[filtered.length - 1] : undefined;
    const returnsVoid = (returnType ?? '').toLowerCase() === 'void';

    return {
        params,
        returnsVoid,
        returnType: returnType && returnType.toLowerCase() !== 'void' ? returnType : undefined
    };
}

function tokenizeSignaturePrefix(prefix: string): string[]
{
    if (!prefix) return [];

    const rawTokens = prefix.split(/\s+/).filter(Boolean);
    const merged: string[] = [];
    let buffer: string | undefined;
    let angleDepth = 0;

    for (const token of rawTokens)
    {
        if (buffer === undefined)
        {
            buffer = token;
        }
        else
        {
            buffer += ` ${token}`;
        }

        angleDepth += (token.match(/</g) ?? []).length;
        angleDepth -= (token.match(/>/g) ?? []).length;

        if (angleDepth <= 0)
        {
            merged.push(buffer);
            buffer = undefined;
        }
    }

    if (buffer !== undefined)
    {
        merged.push(buffer);
    }

    return merged;
}

function splitParameterList(raw: string): string[]
{
    if (!raw.trim()) return [];

    const segments: string[] = [];
    let current = '';
    let angleDepth = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let inString: string | null = null;

    for (let i = 0; i < raw.length; i++)
    {
        const char = raw[i];

        if (inString)
        {
            current += char;
            if (char === inString && raw[i - 1] !== '\\')
            {
                inString = null;
            }
            continue;
        }

        if (char === '"' || char === '\'')
        {
            inString = char;
            current += char;
            continue;
        }

        switch (char)
        {
            case '<':
                angleDepth++;
                break;
            case '>':
                if (angleDepth > 0) angleDepth--;
                break;
            case '(':
                parenDepth++;
                break;
            case ')':
                if (parenDepth > 0) parenDepth--;
                break;
            case '{':
                braceDepth++;
                break;
            case '}':
                if (braceDepth > 0) braceDepth--;
                break;
            case ',':
                if (angleDepth === 0 && parenDepth === 0 && braceDepth === 0)
                {
                    segments.push(current.trim());
                    current = '';
                    continue;
                }
                break;
        }

        current += char;
    }

    if (current.trim())
    {
        segments.push(current.trim());
    }

    const names: string[] = [];
    const seen = new Set<string>();

    for (const segment of segments)
    {
        const name = extractParamName(segment);
        if (name && !seen.has(name.toLowerCase()))
        {
            seen.add(name.toLowerCase());
            names.push(name);
        }
    }

    return names;
}

function extractParamName(param: string): string | undefined
{
    if (!param) return undefined;

    let cleaned = param.replace(/@[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?/g, ' ').trim();
    if (!cleaned) return undefined;

    const equalsIndex = cleaned.indexOf('=');
    if (equalsIndex !== -1)
    {
        cleaned = cleaned.slice(0, equalsIndex).trim();
    }

    const match = cleaned.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    return match ? match[1] : undefined;
}
