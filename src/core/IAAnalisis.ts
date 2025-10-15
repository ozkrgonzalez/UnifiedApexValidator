import axios from 'axios';
import * as vscode from 'vscode';
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
                throw new Error('Token vacio en la respuesta del servidor IA.');
            }

            return token;
        }
        catch (error: any)
        {
            this.logger.error(`[IA] Error obteniendo token IA: ${error.message}`);
            if (error.response)
            {
                this.logger.error(`[IA] Respuesta del servidor IA: ${JSON.stringify(error.response.data)}`);
            }

            throw new IAConnectionError(`Error autenticando con el servidor de IA: ${error.message}`);
        }
    }

    public async generate(prompt: string): Promise<IAResponse>
    {
        this.logger.info('[IA] Iniciando analisis IA...');

        const token = await this.getAccessToken();
        const finalPrompt = `${this.basePrompt}\n\n${prompt}`;

        try
        {
            const apiEndpoint = `${this.endpoint}/v1/models/${this.model}/generations`;
            this.logger.info(`[IA] Enviando solicitud a Einstein GPT: ${apiEndpoint}`);

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
            this.logger.info('[IA] Analisis IA completado correctamente.');

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
                this.logger.warn('[IA] No se detecto texto generado en la respuesta de IA.');
            }

            return {
                resumen: generatedText || 'Sin resumen disponible'
            };
        }
        catch (error: any)
        {
            this.logger.error(`[IA] Error durante el analisis IA: ${error.message}`);
            if (error.response)
            {
                const payload = JSON.stringify(error.response.data);
                this.logger.error(`[IA] Respuesta del servidor: ${payload.slice(0, 300)}...`);
            }

            throw new Error('No se pudo ejecutar el analisis IA.');
        }
    }
}
