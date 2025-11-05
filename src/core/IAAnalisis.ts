import axios from 'axios';
import * as vscode from 'vscode';
import { localize } from '../i18n';
import { Logger } from './utils';

interface IAResponse
{
    resumen: string;
}

export class IAConnectionError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = 'IAConnectionError';
        Object.setPrototypeOf(this, IAConnectionError.prototype);
    }
}

/**
 * Client responsible for talking with the configured Einstein GPT (or compatible) endpoint.
 */
export class IAAnalisis
{
    private logger: Logger;
    private endpoint: string;
    private model: string;
    private clientId: string;
    private clientSecret: string;
    private domain: string;
    private basePrompt: string;

    constructor()
    {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');

        this.endpoint = config.get<string>('sfGptEndpoint') ?? '';
        this.model = config.get<string>('sfGptModel') ?? '';
        this.clientId = config.get<string>('sfClientId') ?? '';
        this.clientSecret = config.get<string>('sfClientSecret') ?? '';
        this.domain = config.get<string>('sfDomain') ?? 'test.salesforce.com';
        this.basePrompt = config.get<string>('iaPromptTemplate') ?? '';

        this.logger = new Logger('IAAnalisis', true);
    }

    private async getAccessToken(): Promise<string>
    {
        const url = `https://${this.domain.replace(/^https:\/\//i, '')}/services/oauth2/token`;
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        });

        try
        {
            const response = await axios.post(url, params);
            const token = response.data?.access_token;

            if (!token)
            {
                throw new Error(
                    localize('error.ia.tokenEmpty', 'Empty token in the AI server response.')
                );
            }

            return token;
        }
        catch (error: any)
        {
            this.logger.error(
                localize('log.ia.tokenFetchFailed', '[IA] Error obtaining AI token: {0}', error.message)
            );
            if (error.response)
            {
                this.logger.error(
                    localize(
                        'log.ia.tokenServerResponse',
                        '[IA] AI server response: {0}',
                        JSON.stringify(error.response.data)
                    )
                );
            }

            throw new IAConnectionError(
                localize(
                    'error.ia.authentication',
                    'Error authenticating with the AI server: {0}',
                    error.message
                )
            );
        }
    }

    public async generate(prompt: string): Promise<IAResponse>
    {
        this.logger.info(localize('log.ia.analysisStart', '[IA] Starting AI analysis...'));

        const token = await this.getAccessToken();
        const finalPrompt = `${this.basePrompt}\n\n${prompt}`;

        try
        {
            const apiEndpoint = `${this.endpoint}/v1/models/${this.model}/generations`;
            this.logger.info(
                localize('log.ia.request', '[IA] Sending request to Einstein GPT: {0}', apiEndpoint)
            );

            const response = await axios.post(
                apiEndpoint,
                { prompt: finalPrompt },
                {
                    headers:
                    {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'x-sfdc-app-context': 'EinsteinGPT',
                        'x-client-feature-id': 'ai-platform-models-connected-app'
                    },
                    timeout: 120000
                }
            );
            this.logger.info(localize('log.ia.analysisComplete', '[IA] AI analysis completed successfully.'));

            let generatedText = '';
            const data = response.data || {};

            if (data.generation?.generatedText)
            {
                generatedText = data.generation.generatedText;
            }
            else if (data.generations?.length)
            {
                generatedText = data.generations[0]?.text || '';
            }
            else if (data.generation?.text)
            {
                generatedText = data.generation.text;
            }
            else if (typeof data === 'string')
            {
                generatedText = data;
            }

            if (!generatedText)
            {
                this.logger.warn(
                    localize(
                        'warn.ia.noText',
                        '[IA] No generated text detected in the AI response.'
                    )
                );
            }

            return {
                resumen:
                    generatedText ||
                    localize('info.ia.noSummary', 'No summary available')
            };
        }
        catch (error: any)
        {
            this.logger.error(
                localize('log.ia.analysisError', '[IA] Error during AI analysis: {0}', error.message)
            );
            if (error.response)
            {
                const payload = JSON.stringify(error.response.data);
                this.logger.error(
                    localize(
                        'log.ia.errorResponse',
                        '[IA] Server response: {0}...',
                        payload.slice(0, 300)
                    )
                );
            }

            throw new Error(
                localize('error.ia.analysisFailed', 'Could not execute the AI analysis.')
            );
        }
    }
}

export interface IAConfigStatus
{
    ready: boolean;
    missing: string[];
}

export function evaluateIaConfig(): IAConfigStatus
{
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const requiredFields: Array<{ key: string; label: string }> = [
        { key: 'sfGptEndpoint', label: 'sfGptEndpoint' },
        { key: 'sfGptModel', label: 'sfGptModel' },
        { key: 'sfClientId', label: 'sfClientId' },
        { key: 'sfClientSecret', label: 'sfClientSecret' },
        { key: 'iaPromptTemplate', label: 'iaPromptTemplate' }
    ];

    const missing = requiredFields
        .filter(({ key }) =>
        {
            const value = config.get<string>(key);
            return typeof value !== 'string' || value.trim().length === 0;
        })
        .map(({ label }) => label);

    return {
        ready: missing.length === 0,
        missing
    };
}
