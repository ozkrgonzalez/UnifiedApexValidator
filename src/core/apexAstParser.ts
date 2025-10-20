import * as fs from 'fs';
import type { TextDocument } from 'vscode';
import { ApexParser, ApexLexer, CaseInsensitiveInputStream } from '@apexdevtools/apex-parser';
import { CommonTokenStream, CharStreams } from 'antlr4ts';
import { ANTLRErrorListener, RecognitionException, Recognizer } from 'antlr4ts';

let vscodeModule: typeof import('vscode') | undefined;
try
{
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    vscodeModule = require('vscode');
}
catch
{
    vscodeModule = undefined;
}

export interface ApexChunk
{
    kind: 'classHeader' | 'field' | 'constructor' | 'method' | 'innerClass';
    name: string;
    start: number;
    end: number;
    text: string;
    signature?: string;
    needsDoc?: boolean;
}

function sanitizeForParser(source: string): string
{
    const chars = source.split('');
    const length = chars.length;

    for (let i = 0; i < length; i++)
    {
        if (chars[i] !== '[') continue;

        let j = i + 1;
        while (j < length && /\s/.test(chars[j])) j++;
        if (j >= length) break;

        const keyword = source.substring(j, j + 6).toLowerCase();
        if (!keyword.startsWith('select') && !keyword.startsWith('find')) continue;

        let depth = 1;
        let k = j;
        while (k < length && depth > 0)
        {
            k++;
            if (k >= length) break;
            const ch = chars[k];
            if (ch === '[')
            {
                depth++;
            }
            else if (ch === ']')
            {
                depth--;
            }
        }

        if (depth !== 0) continue;

        chars[i] = '0';
        for (let p = i + 1; p < k; p++)
        {
            const ch = chars[p];
            chars[p] = (ch === '\n' || ch === '\r') ? ch : ' ';
        }

        if (k < length)
        {
            const ch = chars[k];
            chars[k] = (ch === '\n' || ch === '\r') ? ch : ' ';
        }

        i = k;
    }

    return chars.join('');
}

export class ApexAstParser
{
    public static parseFile(filePath: string): ApexChunk[]
    {
        let code = fs.readFileSync(filePath, 'utf8');
        if (code.startsWith('\uFEFF'))
        {
            code = code.slice(1);
        }

        const parserCode = sanitizeForParser(code);
        const baseStream = CharStreams.fromString(parserCode);
        const inputStream = new CaseInsensitiveInputStream(baseStream);
        const lexer = new ApexLexer(inputStream);
        const tokenStream = new CommonTokenStream(lexer);
        const parser = new ApexParser(tokenStream);

        const config = vscodeModule?.workspace.getConfiguration('UnifiedApexValidator');
        const traceAst = config?.get<boolean>('traceAst') ?? false;
        const syntaxErrors: string[] = [];
        const chunks: ApexChunk[] = [];
        const extract = (start: number, end: number): string => code.substring(start, end);

        parser.removeErrorListeners();
        parser.addErrorListener({
            syntaxError(
                recognizer: Recognizer<any, any>,
                offendingSymbol: any,
                line: number,
                charPositionInLine: number,
                msg: string,
                e: RecognitionException | undefined
            ): void
            {
                syntaxErrors.push(`line ${line}:${charPositionInLine} ${msg}`);
            }
        } as ANTLRErrorListener<any>);

        const ast = parser.compilationUnit();

        const firstNonEmptyLine = (text: string): string =>
        {
            const lines = text.split(/\r?\n/);
            for (const raw of lines)
            {
                const trimmed = raw.trim();
                if (trimmed.length > 0)
                {
                    return trimmed.replace(/\s+/g, ' ');
                }
            }
            return text.trim();
        };

        const hasDocComment = (startToken: any, startIndex: number): boolean =>
        {
            const hasHiddenDoc = (): boolean =>
            {
                const tokenIndex = typeof startToken?.tokenIndex === 'number' ? startToken.tokenIndex : -1;
                if (tokenIndex < 0) return false;

                const hiddenTokens = tokenStream.getHiddenTokensToLeft(tokenIndex) ?? [];
                for (let i = hiddenTokens.length - 1; i >= 0; i--)
                {
                    const hidden = hiddenTokens[i];
                    const text = hidden?.text ?? '';
                    const trimmed = text.trim();

                    if (!trimmed) continue;
                    if (trimmed.startsWith('/**')) return true;
                    if (trimmed.startsWith('/*') || trimmed.startsWith('//')) return false;

                    break;
                }

                return false;
            };

            const hasDocByText = (): boolean =>
            {
                if (startIndex <= 0) return false;

                let scanPos = startIndex;
                let onDeclarationLine = true;

                while (scanPos > 0)
                {
                    const newlineIndex = code.lastIndexOf('\n', scanPos - 1);
                    const lineStart = newlineIndex + 1;

                    if (onDeclarationLine)
                    {
                        scanPos = lineStart;
                        onDeclarationLine = false;
                        continue;
                    }

                    const line = code.substring(lineStart, scanPos).trim();

                    if (!line)
                    {
                        scanPos = newlineIndex >= 0 ? newlineIndex : 0;
                        continue;
                    }

                    if (line.startsWith('@'))
                    {
                        scanPos = newlineIndex >= 0 ? newlineIndex : 0;
                        continue;
                    }

                    break;
                }

                const commentEnd = code.lastIndexOf('*/', scanPos - 1);
                if (commentEnd === -1) return false;

                const between = code.substring(commentEnd + 2, scanPos).trim();
                if (between.length > 0) return false;

                const commentStart = code.lastIndexOf('/**', commentEnd);
                return commentStart !== -1;
            };

            return hasHiddenDoc() || hasDocByText();
        };

        const tryCall = (node: any, method: string, ...args: any[]): any =>
        {
            try
            {
                const fn = node?.[method];
                if (typeof fn === 'function') return fn.apply(node, args);
            }
            catch (err: any)
            {
                console.warn(`[ApexAST] getName call failed for ${method}: ${err.message}`);
            }
            return undefined;
        };

        const getIdText = (node: any): string | undefined =>
        {
            const idCtx = tryCall(node, 'id');
            return idCtx?.text;
        };

        const extractFirstVariableName = (fieldNode: any): string | undefined =>
        {
            const varDecls = tryCall(fieldNode, 'variableDeclarators');
            if (!varDecls) return undefined;

            const decls = tryCall(varDecls, 'variableDeclarator');
            if (Array.isArray(decls) && decls.length > 0)
            {
                const text = getIdText(decls[0]);
                if (text) return text;
            }
            else if (decls)
            {
                const text = getIdText(decls);
                if (text) return text;
            }

            const firstIndexed = tryCall(varDecls, 'variableDeclarator', 0);
            return getIdText(firstIndexed);
        };

        const getName = (node: any): string =>
        {
            if (!node) return 'Unknown';

            const idCtx = tryCall(node, 'id');
            if (idCtx?.text) return idCtx.text;

            const qualified = tryCall(node, 'qualifiedName');
            if (qualified?.text)
            {
                const parts = qualified.text.split('.');
                return parts[parts.length - 1];
            }

            const identifierFn = node?.IDENTIFIER;
            if (typeof identifierFn === 'function')
            {
                const value = identifierFn.call(node);
                if (Array.isArray(value))
                {
                    const last = value[value.length - 1];
                    if (last?.text) return last.text;
                }
                if (value?.text) return value.text;
            }

            if (node.IDENTIFIER?.text) return node.IDENTIFIER.text;
            if (Array.isArray(node.children))
            {
                const symbolNode = node.children.find((c: any) => c.symbol?.text);
                if (symbolNode) return symbolNode.symbol.text;
            }
            if (typeof node.text === 'string')
            {
                const match = node.text.match(/([A-Za-z_]\w*)\s*(\(|\{|;)/);
                if (match) return match[1];
            }
            return 'Unknown';
        };

        const visited = new WeakSet<any>();

        const traverse = (node: any, depth = 0) =>
        {
            if (!node || visited.has(node) || depth > 50) return;
            visited.add(node);

            const type = node.constructor?.name;
            const startToken = node.start || node.symbol;
            const stopToken = node.stop || node.symbol;

            const start =
                typeof startToken?.startIndex === 'number'
                    ? startToken.startIndex
                    : typeof startToken?.start === 'number'
                        ? startToken.start
                        : 0;

            const stopIdx =
                typeof stopToken?.stopIndex === 'number'
                    ? stopToken.stopIndex
                    : typeof stopToken?.stop === 'number'
                        ? stopToken.stop
                        : start;

            const end = Math.min((stopIdx ?? start) + 1, code.length);

            if (traceAst)
                console.log(`[ApexAST][Depth:${depth}] -> ${type} (${start}-${end})`);

            try
            {
                const text = extract(start, end);

                switch (type)
                {
                    case 'ClassDeclarationContext': {
                        const className = getName(node);
                        const parentType = node.parent?.constructor?.name;
                        const isInner =
                            parentType === 'MemberDeclarationContext' ||
                            parentType === 'TriggerMemberDeclarationContext';
                        if (traceAst)
                            console.log(`[ApexAST] Class found: ${className} (inner=${isInner})`);
                        chunks.push({
                            kind: isInner ? 'innerClass' : 'classHeader',
                            name: className,
                            start,
                            end,
                            text,
                            signature: firstNonEmptyLine(text),
                            needsDoc: !hasDocComment(startToken, start)
                        });

                        break;
                    }

                    case 'FieldDeclarationContext': {
                        const fieldName = extractFirstVariableName(node) ?? getName(node);
                        if (traceAst)
                            console.log(`[ApexAST] Field found: ${fieldName}`);
                        chunks.push({
                            kind: 'field',
                            name: fieldName,
                            start,
                            end,
                            text,
                            signature: firstNonEmptyLine(text.split('=')[0] ?? text),
                            needsDoc: !hasDocComment(startToken, start)
                        });
                        break;
                    }

                    case 'ConstructorDeclarationContext':
                        if (traceAst)
                            console.log(`[ApexAST] Constructor found: ${getName(node)}`);
                        chunks.push({
                            kind: 'constructor',
                            name: getName(node),
                            start,
                            end,
                            text,
                            signature: firstNonEmptyLine(text),
                            needsDoc: !hasDocComment(startToken, start)
                        });
                        break;

                    case 'MethodDeclarationContext': {
                        const methodName = getIdText(node) ?? getName(node);
                        if (traceAst)
                            console.log(`[ApexAST] Method found: ${methodName}`);
                        chunks.push({
                            kind: 'method',
                            name: methodName,
                            start,
                            end,
                            text,
                            signature: firstNonEmptyLine(text),
                            needsDoc: !hasDocComment(startToken, start)
                        });
                        break;
                    }

                    case 'PropertyDeclarationContext': {
                        const propertyName = getIdText(node) ?? getName(node);
                        if (traceAst)
                            console.log(`[ApexAST] Property found: ${propertyName}`);
                        chunks.push({
                            kind: 'field',
                            name: propertyName,
                            start,
                            end,
                            text,
                            signature: firstNonEmptyLine(text),
                            needsDoc: !hasDocComment(startToken, start)
                        });
                        break;
                    }
                }
            }
            catch (err: any)
            {
                if (traceAst)
                    console.warn(`[ApexAST] Error parsing node ${type}: ${err.message}`);
            }

            for (const key of Object.keys(node))
            {
                const val = node[key];
                if (!val) continue;

                if (Array.isArray(val))
                {
                    for (const child of val)
                    {
                        if (typeof child === 'object') traverse(child, depth + 1);
                    }
                }
                else if (typeof val === 'object')
                {
                    traverse(val, depth + 1);
                }
            }

            if (traceAst && depth === 0)
                console.log(`[ApexAST] Finalizo recorrido raiz con ${chunks.length} chunks`);
        };

        traverse(ast);
        chunks.sort((a, b) => a.start - b.start);

        if (traceAst)
        {
            if (syntaxErrors.length)
            {
                console.warn('[ApexAST] Syntax errors detectados:');
                for (const err of syntaxErrors)
                {
                    console.warn(`  ! ${err}`);
                }
            }

            console.log('\n[ApexAST] Resumen de chunks detectados:');
            for (const ch of chunks)
            {
                const status = ch.needsDoc ? 'sin doc' : 'con doc';
                console.log(`  - ${ch.kind.padEnd(14)} ${ch.name.padEnd(60)} (${ch.start}-${ch.end})  ${status}`);
            }
            console.log(`[ApexAST] Total: ${chunks.length} elementos`);
        }

        return chunks;
    }

    public static parseDocument(doc: TextDocument): ApexChunk[]
    {
        const tempFile = doc.uri.fsPath;
        fs.writeFileSync(tempFile, doc.getText(), 'utf8');
        return ApexAstParser.parseFile(tempFile);
    }
}




