import * as vscode from 'vscode';
import { ApexChunk } from './apexAstParser';
import { Logger } from './utils';

export class PatchApplier
{
    private static logger = new Logger('PatchApplier', true);

    public static applyInMemory(baseText: string, chunk: ApexChunk, docBlock: string): string
    {
        const logger = PatchApplier.logger;

        try
        {
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
            const newText =
                baseText.substring(0, insertionPoint) +
                formattedBlock +
                baseText.substring(insertionPoint);

            logger.info(`✅ ApexDoc insertado en ${chunk.kind} "${chunk.name}" (posición ${insertionPoint})`);
            return newText;
        }
        catch (err: any)
        {
            logger.error(`❌ Error aplicando ApexDoc en ${chunk.name}: ${err.message}`);
            return baseText;
        }
    }

    public static async openFinalDiff(original: string, modified: string, uri: vscode.Uri, title: string)
    {
        const logger = PatchApplier.logger;
        try
        {
            logger.info('🔍 Opening final diff preview...');

            // 🧩 izquierda → archivo real (ya abierto en el editor)
            const leftUri = uri;

            // 🧩 derecha → versión generada (virtual, solo en memoria)
            const rightDoc = await vscode.workspace.openTextDocument({ content: modified, language: 'apex' });

            // 🔀 abrir vista de diferencias
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightDoc.uri, title);

            logger.info('🪄 Diff view opened successfully (left = original file, right = generated version).');
        }
        catch (err: any)
        {
            logger.error(`❌ Error opening diff view: ${err.message}`);
        }
    }
}
