import * as vscode from 'vscode';
import { ApexChunk } from './apexAstParser';
import { Logger } from './utils';
import { IAAnalisis, IAConnectionError } from './IAAnalisis';

export interface ChunkResult
{
    ok: boolean;
    patchedText?: string;
    error?: string;
    fatal?: boolean;
}

export class AiDocChunkRunner
{
    private static logger = new Logger('ApexDocChunkRunner', true);

    public static async processChunk(docText: string, chunk: ApexChunk): Promise<ChunkResult>
    {
        const logger = AiDocChunkRunner.logger;
        const iaClient = new IAAnalisis();

        logger.info(`Processing chunk: ${chunk.kind} - ${chunk.name}`);

        const cfg = vscode.workspace.getConfiguration('UnifiedApexValidator');
        const maxChars = cfg.get<number>('maxIAClassChars') || 25000;

        let snippet = chunk.text;
        let truncatedNotice = '';
        if (snippet.length > maxChars)
        {
            snippet = snippet.substring(0, maxChars);
            truncatedNotice =
                '\n\nNote: Only part of the code is shown due to size limit.\n' +
                'Document only the visible content, without inventing missing sections.\n';
            logger.warn(`Chunk truncated to ${maxChars} characters (original length: ${chunk.text.length})`);
        }

        logger.info(`Fragmento (${chunk.name}): ${snippet.slice(0, 200)}...`);

        const contextHeader = AiDocChunkRunner.buildContextHeader(docText, chunk);
        const snippetWrapped = `/*__BEGIN_FRAGMENT__*/\n${snippet}\n/*__END_FRAGMENT__*/`;

        const prompt = `
        You are an expert Salesforce Apex developer.

        Your task is to add ApexDoc documentation comments to the given Apex code fragment.
        Follow these strict rules:

        - Do not remove, reorder, or modify any existing code.
        - Only add documentation comments /** ... */ above classes, methods, variables, or inner classes.
        - Keep the original indentation and spacing.
        - Keep the class header (public with sharing class ...) intact.
        - Return only the modified fragment between markers.
        - All documentation tags (@description, @param, @return) must be written in Spanish.
        - Classes, constructors, and methods must always include @description.
        - Each @param must describe the purpose of the parameter briefly.
        - Methods that return a value must include an @return tag describing what is returned.
        - Methods with return type 'void' must not include an @return tag.
        - Variable declarations must not include @return.
        - Surround the return type in the @return tag with single backticks (\`Tipo\`).
        - Do not add empty or placeholder tags.
        - Maintain consistent indentation and spacing with the original code.

        Context (for reference only, do not modify):
        ${contextHeader}
        ${truncatedNotice}

        Example:
        /**
         * @description Calcula la suma de dos números.
         * @param a Primer número.
         * @param b Segundo número.
         * @return \`Integer\` Suma total.
         */
        public static Integer add(Integer a, Integer b)
        { ... }

        Now, document the following Apex code.
        Return only the code between delimiters:
        ---CODE START---
        ${snippetWrapped}
        ---CODE END---
        `.trim();

        try
        {
            const result = await iaClient.generate(prompt);
            let out = result?.resumen?.trim() || '';

            out = out
                .replace(/---CODE START---/gi, '')
                .replace(/---CODE END---/gi, '')
                .replace(/\/\*__BEGIN_FRAGMENT__\*\//g, '')
                .replace(/\/\*__END_FRAGMENT__\*\//g, '')
                .trim();

            const openBraces = (out.match(/{/g) || []).length;
            const closeBraces = (out.match(/}/g) || []).length;
            if (closeBraces > openBraces)
            {
                out = out.replace(/}\s*$/, '');
            }

            if (!out)
            {
                logger.warn(`Empty response for chunk: ${chunk.name}`);
                return { ok: false, error: 'Empty response from model' };
            }

            if (!out.includes('/**'))
            {
                logger.warn(`No ApexDoc comments detected in chunk: ${chunk.name}`);
                return { ok: false, error: 'No documentation generated' };
            }

            const anchorFound = new RegExp(`\\b${chunk.name}\\b`).test(out);
            if (!anchorFound)
            {
                logger.warn(`Possible incomplete response for ${chunk.name}`);
            }

            const preview = out.substring(0, 400).replace(/\n/g, ' ');
            logger.info(`Model responded (${out.length} chars): ${preview}...`);

            return { ok: true, patchedText: out };
        }
        catch (e: any)
        {
            if (e instanceof IAConnectionError)
            {
                const message = e.message || 'Error autenticando con el servidor de IA.';
                logger.error(`Fatal error processing chunk ${chunk.name}: ${message}`);
                return { ok: false, error: message, fatal: true };
            }

            logger.error(`Error processing chunk ${chunk.name}: ${e?.message}`);
            return { ok: false, error: e?.message || 'Error invoking model' };
        }
    }

    private static buildContextHeader(full: string, chunk: ApexChunk): string
    {
        const classMatch = full.match(/(public|global|private|protected)?\s*(with|without)?\s*sharing\s*class\s+([A-Za-z_]\w*)/);
        const className = classMatch ? classMatch[3] : 'UnknownClass';
        const classSignature = classMatch ? classMatch[0] : 'class definition not found';

        const methodRegex = new RegExp(
            `(public|global|private|protected)\\s+(static\\s+)?[A-Za-z_<>\\[\\]]+\\s+${chunk.name}\\s*\\([^)]*\\)`,
            'i'
        );
        const methodSig = full.match(methodRegex)?.[0] || `Signature for ${chunk.name} not found`;

        return [
            `Class: ${className}`,
            `Class signature: ${classSignature}`,
            `Current element: ${chunk.kind} ${chunk.name}`,
            `Signature: ${methodSig}`
        ].join('\n');
    }
}

