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
async function generateApexDocChunked() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No hay ningun archivo abierto.');
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
    const applyAnswer = await vscode.window.showInformationMessage('Revisa el diff abierto. ¿Quieres aplicar la documentacion generada al archivo?', 'Aplicar', 'Omitir');
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
function ensureClassPlaceholders(docBlock) {
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const configured = config.get('classDocTags') ?? ['@description', '@since', '@author', '@testClass'];
    const normalized = configured
        .map((tag) => (tag.startsWith('@') ? tag : `@${tag}`))
        .filter((tag, index, array) => tag.trim().length > 1 && array.indexOf(tag) === index);
    if (!normalized.length)
        return docBlock;
    const hasAllTags = normalized.every((tag) => {
        const tagPattern = new RegExp(`\\*\\s*${tag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
        return tagPattern.test(docBlock);
    });
    if (hasAllTags)
        return docBlock;
    const lines = docBlock.split(/\r?\n/);
    const closeIndex = [...lines].reverse().findIndex((line) => line.trim().startsWith('*/'));
    if (closeIndex === -1)
        return docBlock;
    const closingLineIndex = lines.length - 1 - closeIndex;
    let indent = '';
    for (const line of lines) {
        const match = line.match(/^(\s*)\*/);
        if (match) {
            indent = match[1];
            break;
        }
    }
    const missing = normalized.filter((tag) => {
        const tagPattern = new RegExp(`\\*\\s*${tag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
        return !tagPattern.test(docBlock);
    });
    if (!missing.length)
        return docBlock;
    const insertionLines = missing.map((tag) => `${indent} * ${tag} `);
    lines.splice(closingLineIndex, 0, ...insertionLines);
    return lines.join('\n');
}
