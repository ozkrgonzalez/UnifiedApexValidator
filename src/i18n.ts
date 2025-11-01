import * as fs from 'fs';
import * as path from 'path';
import * as nls from 'vscode-nls';

const baseLocalize = nls.config({ messageFormat: nls.MessageFormat.file })();

type MessageBundle = Record<string, string>;
let cachedBundle: MessageBundle | null = null;
let bundleLoadAttempted = false;

function ensureBundleLoaded(): void
{
    if (bundleLoadAttempted)
    {
        return;
    }

    bundleLoadAttempted = true;

    const bundlePath = path.join(__dirname, '..', 'i18n', 'extension.i18n.json');

    try
    {
        let contents = fs.readFileSync(bundlePath, 'utf8');
        if (contents.charCodeAt(0) === 0xFEFF)
        {
            contents = contents.slice(1);
        }
        cachedBundle = JSON.parse(contents) as MessageBundle;
    }
    catch (err)
    {
        console.warn('[UAV][i18n] Unable to load fallback bundle:', err);
        cachedBundle = {};
    }
}

function formatMessage(template: string, args: any[]): string
{
    return template.replace(/{(\d+)}/g, (match, indexRaw) =>
    {
        const index = Number(indexRaw);
        if (Number.isNaN(index))
        {
            return match;
        }
        const value = args[index];
        return value === undefined ? match : String(value);
    });
}

export function localize(key: string, defaultValue: string, ...args: any[]): string
{
    const result = baseLocalize(key, defaultValue, ...args);
    const formattedDefault = formatMessage(defaultValue, args);

    if (result !== defaultValue && result !== formattedDefault)
    {
        return result;
    }

    ensureBundleLoaded();

    const template = cachedBundle?.[key];
    if (!template)
    {
        console.warn(`[UAV][i18n] Clave no encontrada en bundle: ${key}`);
        return formattedDefault;
    }

    return formatMessage(template, args);
}
