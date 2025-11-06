import * as vscode from 'vscode';
import { localize } from '../i18n';

interface StatementOffsets
{
    start: number;
    end: number;
}

type LexState = 'code' | 'string' | 'singleLineComment' | 'multiLineComment';

export async function removeSystemDebugs(): Promise<void>
{
    const editor = vscode.window.activeTextEditor;

    if (!editor)
    {
        void vscode.window.showWarningMessage(
            localize('command.removeDebug.noEditor', 'Open an editor to remove System.debug statements.')
        );
        return;
    }

    const document = editor.document;
    const targetRanges = editor.selections.filter((selection) => !selection.isEmpty);

    const rangesToProcess = targetRanges.length
        ? targetRanges
        : [new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))];

    const removalRanges: vscode.Range[] = [];

    for (const range of rangesToProcess)
    {
        const text = document.getText(range);
        const baseOffset = document.offsetAt(range.start);
        const statements = collectSystemDebugStatements(text, baseOffset);

        for (const statement of statements)
        {
            const adjustedRange = createRemovalRange(document, statement);
            if (adjustedRange)
            {
                removalRanges.push(adjustedRange);
            }
        }
    }

    if (!removalRanges.length)
    {
        void vscode.window.showInformationMessage(
            localize('command.removeDebug.noneFound', 'No System.debug statements found in the current selection.')
        );
        return;
    }

    const deduped = dedupeRanges(document, removalRanges);

    await editor.edit((editBuilder) =>
    {
        for (const range of deduped)
        {
            editBuilder.delete(range);
        }
    });

    const count = deduped.length;
    const pluralSuffix = count === 1 ? '' : 's';
    void vscode.window.showInformationMessage(
        localize('command.removeDebug.success', 'Removed {0} System.debug statement{1}.', count, pluralSuffix)
    );
}

function collectSystemDebugStatements(text: string, baseOffset: number): StatementOffsets[]
{
    const results: StatementOffsets[] = [];
    let i = 0;
    let state: LexState = 'code';
    let stringQuote = '';

    while (i < text.length)
    {
        const ch = text[i];

        if (state === 'code')
        {
            if (ch === '/' && text[i + 1] === '/')
            {
                state = 'singleLineComment';
                i += 2;
                continue;
            }

            if (ch === '/' && text[i + 1] === '*')
            {
                state = 'multiLineComment';
                i += 2;
                continue;
            }

            if (ch === '"' || ch === '\'' || ch === '`')
            {
                state = 'string';
                stringQuote = ch;
                i += 1;
                continue;
            }

            if (ch === 'S' && text.startsWith('System.debug', i))
            {
                const prevChar = i > 0 ? text[i - 1] : '';
                if (prevChar && /[A-Za-z0-9_$\.]/.test(prevChar))
                {
                    i += 1;
                    continue;
                }

                let cursor = i + 'System.debug'.length;
                cursor = skipWhitespace(text, cursor);

                if (text[cursor] !== '(')
                {
                    i += 1;
                    continue;
                }

                const afterClosing = findMatchingParen(text, cursor);
                if (afterClosing === null)
                {
                    i += 1;
                    continue;
                }

                let afterCall = skipWhitespace(text, afterClosing);
                if (text[afterCall] !== ';')
                {
                    i = afterClosing;
                    continue;
                }

                afterCall += 1;

                results.push({
                    start: baseOffset + i,
                    end: baseOffset + afterCall
                });

                i = afterCall;
                continue;
            }

            i += 1;
        }
        else if (state === 'string')
        {
            if (ch === '\\')
            {
                i += 2;
                continue;
            }

            if (ch === stringQuote)
            {
                state = 'code';
            }

            i += 1;
        }
        else if (state === 'singleLineComment')
        {
            if (ch === '\n')
            {
                state = 'code';
            }
            else if (ch === '\r')
            {
                state = 'code';
                if (text[i + 1] === '\n')
                {
                    i += 1;
                }
            }

            i += 1;
        }
        else
        {
            // multi-line comment
            if (ch === '*' && text[i + 1] === '/')
            {
                state = 'code';
                i += 2;
                continue;
            }

            i += 1;
        }
    }

    return results;
}

function skipWhitespace(text: string, index: number): number
{
    let cursor = index;
    while (cursor < text.length && /\s/.test(text[cursor]))
    {
        cursor += 1;
    }
    return cursor;
}

function findMatchingParen(text: string, openIndex: number): number | null
{
    let cursor = openIndex;
    let depth = 0;
    let state: LexState = 'code';
    let stringQuote = '';

    while (cursor < text.length)
    {
        const ch = text[cursor];

        if (state === 'code')
        {
            if (ch === '(')
            {
                depth += 1;
                cursor += 1;
                continue;
            }

            if (ch === ')')
            {
                depth -= 1;
                cursor += 1;

                if (depth === 0)
                {
                    return cursor;
                }

                continue;
            }

            if (ch === '"' || ch === '\'' || ch === '`')
            {
                state = 'string';
                stringQuote = ch;
                cursor += 1;
                continue;
            }

            if (ch === '/' && text[cursor + 1] === '/')
            {
                state = 'singleLineComment';
                cursor += 2;
                continue;
            }

            if (ch === '/' && text[cursor + 1] === '*')
            {
                state = 'multiLineComment';
                cursor += 2;
                continue;
            }

            cursor += 1;
        }
        else if (state === 'string')
        {
            if (ch === '\\')
            {
                cursor += 2;
                continue;
            }

            if (ch === stringQuote)
            {
                state = 'code';
            }

            cursor += 1;
        }
        else if (state === 'singleLineComment')
        {
            if (ch === '\n')
            {
                state = 'code';
                cursor += 1;
                continue;
            }

            if (ch === '\r')
            {
                state = 'code';
                cursor += text[cursor + 1] === '\n' ? 2 : 1;
                continue;
            }

            cursor += 1;
        }
        else
        {
            // multi-line comment
            if (ch === '*' && text[cursor + 1] === '/')
            {
                state = 'code';
                cursor += 2;
                continue;
            }

            cursor += 1;
        }
    }

    return null;
}

function createRemovalRange(document: vscode.TextDocument, offsets: StatementOffsets): vscode.Range | null
{
    const startPos = document.positionAt(offsets.start);
    const endPos = document.positionAt(offsets.end);
    const startLine = document.lineAt(startPos);
    let rangeStart = startPos;

    if (!startLine.text.slice(0, startPos.character).trim())
    {
        rangeStart = startLine.range.start;
    }

    let rangeEnd = endPos;
    const endLine = document.lineAt(endPos);
    const suffix = endLine.text.slice(endPos.character);

    if (!suffix.trim())
    {
        if (endLine.lineNumber < document.lineCount - 1)
        {
            rangeEnd = document.lineAt(endLine.lineNumber + 1).range.start;
        }
        else
        {
            rangeEnd = endLine.range.end;
        }
    }

    if (rangeEnd.isBeforeOrEqual(rangeStart))
    {
        return null;
    }

    return new vscode.Range(rangeStart, rangeEnd);
}

function dedupeRanges(document: vscode.TextDocument, ranges: vscode.Range[]): vscode.Range[]
{
    const unique = new Map<string, vscode.Range>();

    for (const range of ranges)
    {
        const key = `${document.offsetAt(range.start)}:${document.offsetAt(range.end)}`;
        unique.set(key, range);
    }

    return Array.from(unique.values()).sort((a, b) =>
    {
        const offsetA = document.offsetAt(a.start);
        const offsetB = document.offsetAt(b.start);
        return offsetB - offsetA;
    });
}

