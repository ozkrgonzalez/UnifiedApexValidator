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
exports.generateApexDocChunked = generateApexDocChunked;
const vscode = __importStar(require("vscode"));
const apexAstParser_1 = require("./apexAstParser");
const aiDocChunkRunner_1 = require("../core/aiDocChunkRunner");
const patchApplier_1 = require("../core/patchApplier");
const utils_1 = require("../core/utils");
const IAAnalisis_1 = require("./IAAnalisis");
async function generateApexDocChunked() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No hay ningun archivo abierto.');
        return;
    }
    const iaStatus = (0, IAAnalisis_1.evaluateIaConfig)();
    if (!iaStatus.ready) {
        vscode.window.showWarningMessage(`Generacion de ApexDoc deshabilitada. Faltan parametros IA: ${iaStatus.missing.join(', ')}`);
        return;
    }
    const logger = new utils_1.Logger('GenerateApexDoc', true);
    const doc = editor.document;
    const original = doc.getText();
    let working = original;
    const chunks = apexAstParser_1.ApexAstParser.parseDocument(doc);
    const traceAst = vscode.workspace.getConfiguration('UnifiedApexValidator').get('traceAst') ?? false;
    logger.info(`[GenerateApexDoc] Chunks detectados: ${chunks.length}`);
    if (traceAst) {
        for (const ch of chunks) {
            logger.info(`  • ${ch.kind.padEnd(12)} ${ch.name.padEnd(60)} ` +
                `(${ch.start}-${ch.end})  doc=${ch.needsDoc ? 'pendiente' : 'ok'}`);
        }
    }
    const missing = chunks.filter((c) => c.needsDoc);
    let fatalError;
    if (!missing.length) {
        vscode.window.showInformationMessage('Todos los elementos ya tienen ApexDoc.');
        return;
    }
    const progressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: 'Revisión de ApexDoc generados',
        cancellable: true
    };
    await vscode.window.withProgress(progressOptions, async (progress, token) => {
        const total = missing.length;
        let done = 0;
        const locateChunk = (source, snippet, hint) => {
            if (!snippet)
                return -1;
            const primary = source.indexOf(snippet, Math.max(0, hint));
            if (primary !== -1)
                return primary;
            const trimmed = snippet.trim();
            if (trimmed && trimmed !== snippet) {
                const fallback = source.indexOf(trimmed, Math.max(0, hint));
                if (fallback !== -1)
                    return fallback;
            }
            return -1;
        };
        let searchCursor = 0;
        for (const chunk of missing) {
            if (token.isCancellationRequested) {
                break;
            }
            progress.report({ message: `Procesando ${chunk.kind} "${chunk.name}" (${++done}/${total})` });
            logger.info(`Generando doc para: ${chunk.kind} "${chunk.name}"`);
            const snippet = chunk.text;
            let realStart = locateChunk(working, snippet, searchCursor);
            if (realStart === -1) {
                realStart = locateChunk(working, snippet, 0);
            }
            if (realStart === -1) {
                logger.warn(`No se encontro el fragmento actualizado para ${chunk.name}; se omite.`);
                continue;
            }
            const realEnd = realStart + snippet.length;
            const currentSlice = working.substring(realStart, realEnd);
            const localChunk = { ...chunk, start: realStart, end: realEnd, text: currentSlice };
            const result = await aiDocChunkRunner_1.AiDocChunkRunner.processChunk(working, localChunk);
            if (result.ok && result.patchedText) {
                try {
                    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
                    const outputDir = config.get('outputDir') ||
                        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
                        __dirname;
                    const safeName = `${chunk.kind}_${chunk.name.replace(/[^a-zA-Z0-9_]/g, '_')}.txt`;
                    const rawPath = vscode.Uri.file(`${outputDir}/ApexDoc_Debug_${safeName}`);
                    await vscode.workspace.fs.writeFile(rawPath, Buffer.from(result.patchedText, 'utf8'));
                    logger.info(`Guardado bloque IA crudo para ${chunk.name} en ${rawPath.fsPath}`);
                    const matches = [...result.patchedText.matchAll(/\/\*\*[\s\S]*?\*\//g)];
                    if (matches.length > 0) {
                        for (let i = 0; i < matches.length; i++) {
                            const block = matches[i][0];
                            const blkPath = vscode.Uri.file(`${outputDir}/ApexDoc_Debug_${chunk.kind}_${chunk.name.replace(/[^a-zA-Z0-9_]/g, '_')}_${i}.txt`);
                            await vscode.workspace.fs.writeFile(blkPath, Buffer.from(block, 'utf8'));
                        }
                        let docBlock = matches[0][0];
                        if (chunk.kind === 'classHeader') {
                            docBlock = ensureClassPlaceholders(docBlock);
                        }
                        else if (chunk.kind === 'method') {
                            docBlock = ensureMethodPlaceholders(docBlock, chunk, false);
                        }
                        else if (chunk.kind === 'constructor') {
                            docBlock = ensureMethodPlaceholders(docBlock, chunk, true);
                        }
                        working = patchApplier_1.PatchApplier.applyInMemory(working, localChunk, docBlock);
                        searchCursor = realStart + docBlock.length + snippet.length;
                        logger.info(`Documentacion insertada para ${chunk.name} (${matches.length} bloque(s) detectados)`);
                    }
                    else {
                        logger.warn(`No se detectaron bloques ApexDoc en la respuesta para ${chunk.name}`);
                    }
                }
                catch (err) {
                    logger.warn(`Error guardando/insertando doc para ${chunk.name}: ${err.message}`);
                }
            }
            else if (result.fatal) {
                fatalError = result.error || 'Error fatal al invocar el servicio de IA.';
                logger.error(`Proceso detenido para ${chunk.name}: ${fatalError}`);
                break;
            }
            else {
                logger.warn(`Fallo ${chunk.name}: ${result.error}`);
            }
            if (searchCursor < realStart + snippet.length) {
                searchCursor = realStart + snippet.length;
            }
        }
        if (fatalError) {
            return;
        }
    });
    if (fatalError) {
        vscode.window.showErrorMessage(`No se pudo generar ApexDoc: ${fatalError}`);
        return;
    }
    await patchApplier_1.PatchApplier.openFinalDiff(original, working, doc.uri, 'Comparar documentacion generada (chunked)');
    let applyAnswer;
    while (!applyAnswer) {
        applyAnswer = await vscode.window.showInformationMessage('Revisa el diff abierto. ¿Quieres aplicar la documentacion generada al archivo?', 'Aplicar', 'Omitir');
    }
    if (applyAnswer === 'Aplicar') {
        const targetEditor = await vscode.window.showTextDocument(doc, { preview: false });
        const applied = await targetEditor.edit((editBuilder) => {
            const start = new vscode.Position(0, 0);
            const lastLine = doc.lineCount > 0 ? doc.lineAt(doc.lineCount - 1) : undefined;
            const end = lastLine ? lastLine.range.end : start;
            editBuilder.replace(new vscode.Range(start, end), working);
        });
        if (applied) {
            logger.info('Documentacion aplicada al archivo.');
        }
        else {
            logger.warn('No fue posible aplicar la documentacion al archivo.');
        }
    }
    else {
        logger.info('Documentacion generada omitida por el usuario.');
    }
}
function analyzeDocBlock(docBlock) {
    const lines = docBlock.split(/\r?\n/);
    const closeIndex = [...lines].reverse().findIndex((line) => line.trim().startsWith('*/'));
    if (closeIndex === -1)
        return undefined;
    const closingLineIndex = lines.length - 1 - closeIndex;
    let indent = '';
    for (const line of lines) {
        const match = line.match(/^(\s*)\*/);
        if (match) {
            indent = match[1];
            break;
        }
    }
    return { lines, closingLineIndex, indent };
}
function normalizeTags(settingKey, fallback) {
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const configured = config.get(settingKey) ?? fallback;
    return configured
        .map((tag) => (tag.startsWith('@') ? tag : `@${tag}`))
        .map((tag) => tag.trim())
        .filter((tag, index, array) => tag.length > 1 && array.indexOf(tag) === index);
}
function docBlockHasTag(docBlock, tag) {
    const tagPattern = new RegExp(`\\*\\s*${tag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
    return tagPattern.test(docBlock);
}
function ensureClassPlaceholders(docBlock) {
    const normalized = normalizeTags('classDocTags', ['@description', '@since', '@author', '@testClass']);
    if (!normalized.length)
        return docBlock;
    const metadata = analyzeDocBlock(docBlock);
    if (!metadata)
        return docBlock;
    const { lines, closingLineIndex, indent } = metadata;
    const missing = normalized.filter((tag) => !docBlockHasTag(docBlock, tag));
    if (!missing.length)
        return docBlock;
    const insertionLines = missing.map((tag) => `${indent} * ${tag} `);
    lines.splice(closingLineIndex, 0, ...insertionLines);
    return lines.join('\n');
}
function ensureMethodPlaceholders(docBlock, chunk, isConstructor) {
    const normalized = normalizeTags('methodDocTags', ['@description', '@param', '@return']);
    if (!normalized.length)
        return docBlock;
    const metadata = analyzeDocBlock(docBlock);
    if (!metadata)
        return docBlock;
    const { lines, closingLineIndex, indent } = metadata;
    const methodInfo = extractMethodMetadata(chunk, isConstructor);
    const insertionLines = [];
    const existingParams = new Set([...docBlock.matchAll(/\*\s*@param\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((match) => match[1].toLowerCase()));
    for (const tag of normalized) {
        const lower = tag.toLowerCase();
        if (lower === '@param') {
            if (!methodInfo.params.length)
                continue;
            for (const paramName of methodInfo.params) {
                if (!existingParams.has(paramName.toLowerCase())) {
                    insertionLines.push(`${indent} * @param ${paramName} `);
                }
            }
            continue;
        }
        if (lower === '@return') {
            if (isConstructor || methodInfo.returnsVoid)
                continue;
            if (docBlockHasTag(docBlock, tag))
                continue;
            if (methodInfo.returnType) {
                insertionLines.push(`${indent} * @return \`${methodInfo.returnType}\` `);
            }
            else {
                insertionLines.push(`${indent} * @return `);
            }
            continue;
        }
        if (!docBlockHasTag(docBlock, tag)) {
            insertionLines.push(`${indent} * ${tag} `);
        }
    }
    if (!insertionLines.length)
        return docBlock;
    lines.splice(closingLineIndex, 0, ...insertionLines);
    return lines.join('\n');
}
function extractMethodMetadata(chunk, isConstructor) {
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
    if (!match) {
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
    for (let i = paramsStart; i < suffix.length; i++) {
        const char = suffix[i];
        if (char === '(') {
            depth++;
        }
        else if (char === ')') {
            depth--;
            if (depth === 0) {
                paramsEnd = i;
                break;
            }
        }
    }
    const paramSegment = paramsEnd > paramsStart ? suffix.slice(paramsStart + 1, paramsEnd) : '';
    const params = splitParameterList(paramSegment);
    if (isConstructor) {
        return {
            params,
            returnsVoid: true,
            returnType: undefined
        };
    }
    const tokens = tokenizeSignaturePrefix(prefix);
    const filtered = tokens.filter((token) => {
        const lower = token.toLowerCase();
        if (lower === 'with' || lower === 'without' || lower === 'sharing')
            return false;
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
function tokenizeSignaturePrefix(prefix) {
    if (!prefix)
        return [];
    const rawTokens = prefix.split(/\s+/).filter(Boolean);
    const merged = [];
    let buffer;
    let angleDepth = 0;
    for (const token of rawTokens) {
        if (buffer === undefined) {
            buffer = token;
        }
        else {
            buffer += ` ${token}`;
        }
        angleDepth += (token.match(/</g) ?? []).length;
        angleDepth -= (token.match(/>/g) ?? []).length;
        if (angleDepth <= 0) {
            merged.push(buffer);
            buffer = undefined;
        }
    }
    if (buffer !== undefined) {
        merged.push(buffer);
    }
    return merged;
}
function splitParameterList(raw) {
    if (!raw.trim())
        return [];
    const segments = [];
    let current = '';
    let angleDepth = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let inString = null;
    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];
        if (inString) {
            current += char;
            if (char === inString && raw[i - 1] !== '\\') {
                inString = null;
            }
            continue;
        }
        if (char === '"' || char === '\'') {
            inString = char;
            current += char;
            continue;
        }
        switch (char) {
            case '<':
                angleDepth++;
                break;
            case '>':
                if (angleDepth > 0)
                    angleDepth--;
                break;
            case '(':
                parenDepth++;
                break;
            case ')':
                if (parenDepth > 0)
                    parenDepth--;
                break;
            case '{':
                braceDepth++;
                break;
            case '}':
                if (braceDepth > 0)
                    braceDepth--;
                break;
            case ',':
                if (angleDepth === 0 && parenDepth === 0 && braceDepth === 0) {
                    segments.push(current.trim());
                    current = '';
                    continue;
                }
                break;
        }
        current += char;
    }
    if (current.trim()) {
        segments.push(current.trim());
    }
    const names = [];
    const seen = new Set();
    for (const segment of segments) {
        const name = extractParamName(segment);
        if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            names.push(name);
        }
    }
    return names;
}
function extractParamName(param) {
    if (!param)
        return undefined;
    let cleaned = param.replace(/@[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?/g, ' ').trim();
    if (!cleaned)
        return undefined;
    const equalsIndex = cleaned.indexOf('=');
    if (equalsIndex !== -1) {
        cleaned = cleaned.slice(0, equalsIndex).trim();
    }
    const match = cleaned.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    return match ? match[1] : undefined;
}
