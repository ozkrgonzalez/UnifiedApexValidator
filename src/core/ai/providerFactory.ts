import * as vscode from 'vscode';
import { localize } from '../../i18n';
import { getExtensionContext } from '../utils';
import { AnthropicProvider } from './anthropicProvider';
import { EinsteinProvider } from './einsteinProvider';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';
import { AiProviderId, IAConfigStatus, IAConnectionError, IAProvider } from './types';

export const SF_CLIENT_ID_SECRET_KEY = 'uav.sfClientId';
export const SF_CLIENT_SECRET_SECRET_KEY = 'uav.sfClientSecret';

const DEFAULT_MODELS: Record<Exclude<AiProviderId, 'einstein'>, string> = {
    anthropic: 'claude-sonnet-5',
    openai: 'gpt-5-codex',
    custom: ''
};

export function aiApiKeySecretKey(provider: Exclude<AiProviderId, 'einstein'>): string
{
    return `uav.aiApiKey.${provider}`;
}

function resolveProviderId(): AiProviderId
{
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const value = config.get<string>('aiProvider')?.trim();
    return (value === 'anthropic' || value === 'openai' || value === 'custom') ? value : 'einstein';
}

function requireSecretStorage(): vscode.SecretStorage
{
    const context = getExtensionContext();
    if (!context)
    {
        throw new IAConnectionError(
            localize('error.ai.contextUnavailable', 'The extension context is not available yet. Try again after the extension finishes activating.')
        );
    }
    return context.secrets;
}

export async function createIaProvider(): Promise<IAProvider>
{
    const provider = resolveProviderId();
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const basePrompt = config.get<string>('iaPromptTemplate') ?? '';
    const secrets = requireSecretStorage();

    if (provider === 'einstein')
    {
        const clientId = await secrets.get(SF_CLIENT_ID_SECRET_KEY);
        const clientSecret = await secrets.get(SF_CLIENT_SECRET_SECRET_KEY);
        if (!clientId || !clientSecret)
        {
            throw new IAConnectionError(
                localize(
                    'error.ai.missingEinsteinCredentials',
                    'Salesforce Connected App credentials are not configured. Run "UAV: Set AI API Key".'
                )
            );
        }
        return new EinsteinProvider(clientId, clientSecret);
    }

    const model = config.get<string>('aiModel')?.trim() || DEFAULT_MODELS[provider];
    const apiKey = await secrets.get(aiApiKeySecretKey(provider));
    if (!apiKey)
    {
        throw new IAConnectionError(
            localize(
                'error.ai.missingApiKey',
                'No API key configured for the "{0}" AI provider. Run "UAV: Set AI API Key".',
                provider
            )
        );
    }

    if (provider === 'anthropic')
    {
        return new AnthropicProvider(apiKey, model, basePrompt);
    }

    if (provider === 'openai')
    {
        return new OpenAICompatibleProvider(apiKey, model, basePrompt, 'https://api.openai.com');
    }

    const endpoint = config.get<string>('aiCustomEndpoint')?.trim();
    if (!endpoint)
    {
        throw new IAConnectionError(
            localize('error.ai.missingCustomEndpoint', 'Set "UnifiedApexValidator.aiCustomEndpoint" before using the custom AI provider.')
        );
    }
    return new OpenAICompatibleProvider(apiKey, model, basePrompt, endpoint);
}

export async function evaluateIaConfig(): Promise<IAConfigStatus>
{
    const provider = resolveProviderId();
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const context = getExtensionContext();

    if (!context)
    {
        return { ready: false, missing: ['extensionContext'] };
    }

    const missing: string[] = [];

    if (provider === 'einstein')
    {
        const requiredSettings: Array<{ key: string; label: string }> = [
            { key: 'sfGptEndpoint', label: 'sfGptEndpoint' },
            { key: 'sfGptModel', label: 'sfGptModel' },
            { key: 'iaPromptTemplate', label: 'iaPromptTemplate' }
        ];
        for (const { key, label } of requiredSettings)
        {
            const value = config.get<string>(key);
            if (typeof value !== 'string' || value.trim().length === 0)
            {
                missing.push(label);
            }
        }

        const [clientId, clientSecret] = await Promise.all([
            context.secrets.get(SF_CLIENT_ID_SECRET_KEY),
            context.secrets.get(SF_CLIENT_SECRET_SECRET_KEY)
        ]);
        if (!clientId) missing.push('sfClientId');
        if (!clientSecret) missing.push('sfClientSecret');

        return { ready: missing.length === 0, missing };
    }

    const apiKey = await context.secrets.get(aiApiKeySecretKey(provider));
    if (!apiKey)
    {
        missing.push('aiApiKey');
    }

    if (provider === 'custom' && !config.get<string>('aiCustomEndpoint')?.trim())
    {
        missing.push('aiCustomEndpoint');
    }

    return { ready: missing.length === 0, missing };
}
