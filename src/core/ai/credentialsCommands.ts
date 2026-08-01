import * as vscode from 'vscode';
import { localize } from '../../i18n';
import { AiProviderId } from './types';
import { aiApiKeySecretKey, SF_CLIENT_ID_SECRET_KEY, SF_CLIENT_SECRET_SECRET_KEY } from './providerFactory';

function resolveProviderId(): AiProviderId
{
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const value = config.get<string>('aiProvider')?.trim();
    return (value === 'anthropic' || value === 'openai' || value === 'custom') ? value : 'einstein';
}

const PROVIDER_LABELS: Record<AiProviderId, string> = {
    einstein: 'Salesforce Einstein GPT',
    anthropic: 'Anthropic Claude',
    openai: 'OpenAI',
    custom: 'Custom (OpenAI-compatible)'
};

async function setEinsteinCredentials(secrets: vscode.SecretStorage): Promise<boolean>
{
    const clientId = await vscode.window.showInputBox({
        title: localize('input.ai.einsteinClientId.title', 'Salesforce Connected App Client ID'),
        prompt: localize('input.ai.einsteinClientId.prompt', 'Enter the Connected App Client ID.'),
        ignoreFocusOut: true
    });
    if (!clientId)
    {
        return false;
    }

    const clientSecret = await vscode.window.showInputBox({
        title: localize('input.ai.einsteinClientSecret.title', 'Salesforce Connected App Client Secret'),
        prompt: localize('input.ai.einsteinClientSecret.prompt', 'Enter the Connected App Client Secret.'),
        password: true,
        ignoreFocusOut: true
    });
    if (!clientSecret)
    {
        return false;
    }

    await secrets.store(SF_CLIENT_ID_SECRET_KEY, clientId.trim());
    await secrets.store(SF_CLIENT_SECRET_SECRET_KEY, clientSecret.trim());
    return true;
}

async function setProviderApiKey(secrets: vscode.SecretStorage, provider: Exclude<AiProviderId, 'einstein'>): Promise<boolean>
{
    const apiKey = await vscode.window.showInputBox({
        title: localize('input.ai.apiKey.title', 'API Key for {0}', PROVIDER_LABELS[provider]),
        prompt: localize('input.ai.apiKey.prompt', 'Enter the API key. It is stored securely and never written to settings.json.'),
        password: true,
        ignoreFocusOut: true
    });
    if (!apiKey)
    {
        return false;
    }

    await secrets.store(aiApiKeySecretKey(provider), apiKey.trim());
    return true;
}

export function registerAiCredentialCommands(context: vscode.ExtensionContext): vscode.Disposable[]
{
    const setCmd = vscode.commands.registerCommand('UnifiedApexValidator.setAiApiKey', async () =>
    {
        const provider = resolveProviderId();
        const saved = provider === 'einstein'
            ? await setEinsteinCredentials(context.secrets)
            : await setProviderApiKey(context.secrets, provider);

        if (saved)
        {
            vscode.window.showInformationMessage(
                localize('info.ai.credentialsSaved', 'Credentials saved for provider "{0}".', PROVIDER_LABELS[provider])
            );
        }
    });

    const clearCmd = vscode.commands.registerCommand('UnifiedApexValidator.clearAiApiKey', async () =>
    {
        const provider = resolveProviderId();

        if (provider === 'einstein')
        {
            await context.secrets.delete(SF_CLIENT_ID_SECRET_KEY);
            await context.secrets.delete(SF_CLIENT_SECRET_SECRET_KEY);
        }
        else
        {
            await context.secrets.delete(aiApiKeySecretKey(provider));
        }

        vscode.window.showInformationMessage(
            localize('info.ai.credentialsCleared', 'Credentials cleared for provider "{0}".', PROVIDER_LABELS[provider])
        );
    });

    return [setCmd, clearCmd];
}
