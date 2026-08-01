import * as vscode from 'vscode';
import { localize } from '../../i18n';
import { createIaProvider, evaluateIaConfig } from './providerFactory';

export async function testAiConnection(): Promise<void>
{
    const status = await evaluateIaConfig();
    if (!status.ready)
    {
        vscode.window.showWarningMessage(
            localize('warn.ai.testConnection.notConfigured', 'AI is not fully configured. Missing: {0}', status.missing.join(', '))
        );
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: localize('progress.ai.testConnection', 'Testing AI connection...'),
            cancellable: false
        },
        async () =>
        {
            try
            {
                const provider = await createIaProvider();
                const result = await provider.generate(
                    'Reply with a short confirmation that you received this test message.'
                );
                const preview = (result.resumen || '').trim().slice(0, 200);
                vscode.window.showInformationMessage(
                    localize('info.ai.testConnection.success', 'AI connection OK. Response: {0}', preview || '(empty)')
                );
            }
            catch (err: any)
            {
                const reason = err?.message || String(err);
                vscode.window.showErrorMessage(
                    localize('error.ai.testConnection.failed', 'AI connection test failed: {0}', reason)
                );
            }
        }
    );
}
