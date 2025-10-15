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
exports.PatchApplier = void 0;
const vscode = __importStar(require("vscode"));
const utils_1 = require("./utils");
class PatchApplier {
    static logger = new utils_1.Logger('PatchApplier', true);
    static applyInMemory(baseText, chunk, docBlock) {
        const logger = PatchApplier.logger;
        try {
            // 🧭 encuentra el inicio de la línea donde comienza el chunk
            const insertionPoint = Math.max(baseText.lastIndexOf('\n', chunk.start - 1) + 1, 0);
            // 🧱 asegura un salto de línea antes y después del bloque
            const beforeInsert = baseText.substring(0, insertionPoint);
            const charBefore = insertionPoint > 0 ? baseText[insertionPoint - 1] : '';
            const needsSpacer = insertionPoint > 0 && charBefore !== '\n';
            // 🧾 Mantener la indentación del elemento documentado
            const remainder = baseText.substring(insertionPoint);
            const indentMatch = remainder.match(/^[ \t]*/);
            const indent = indentMatch ? indentMatch[0] : '';
            const docLines = docBlock.trim().split(/\r?\n/);
            const indentedDoc = docLines
                .map((line) => (line.length ? indent + line : indent))
                .join('\n');
            const formattedBlock = (needsSpacer ? '\n' : '') + indentedDoc + '\n';
            // 🧩 inserta el bloque sin reemplazar nada del código original
            const newText = baseText.substring(0, insertionPoint) +
                formattedBlock +
                baseText.substring(insertionPoint);
            logger.info(`✅ ApexDoc insertado en ${chunk.kind} "${chunk.name}" (posición ${insertionPoint})`);
            return newText;
        }
        catch (err) {
            logger.error(`❌ Error aplicando ApexDoc en ${chunk.name}: ${err.message}`);
            return baseText;
        }
    }
    static async openFinalDiff(original, modified, uri, title) {
        const logger = PatchApplier.logger;
        try {
            logger.info('🔍 Opening final diff preview...');
            // 🧩 izquierda → archivo real (ya abierto en el editor)
            const leftUri = uri;
            // 🧩 derecha → versión generada (virtual, solo en memoria)
            const rightDoc = await vscode.workspace.openTextDocument({ content: modified, language: 'apex' });
            // 🔀 abrir vista de diferencias
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightDoc.uri, title);
            logger.info('🪄 Diff view opened successfully (left = original file, right = generated version).');
        }
        catch (err) {
            logger.error(`❌ Error opening diff view: ${err.message}`);
        }
    }
}
exports.PatchApplier = PatchApplier;
