import axios from 'axios';
import { localize } from '../../i18n';
import { Logger } from '../utils';
import { IAConnectionError, IAProvider, IAResponse } from './types';

/**
 * Serves both the official OpenAI API and any self-hosted / third-party
 * endpoint compatible with the Chat Completions format (e.g. Mimo).
 */
export class OpenAICompatibleProvider implements IAProvider
{
    private logger: Logger;

    constructor(
        private apiKey: string,
        private model: string,
        private basePrompt: string,
        private baseUrl: string
    )
    {
        this.logger = new Logger('IA:openai-compatible', true);
    }

    private resolveChatCompletionsUrl(): string
    {
        const trimmed = this.baseUrl.replace(/\/+$/, '');
        if (/\/chat\/completions$/i.test(trimmed))
        {
            return trimmed;
        }
        if (/\/v1$/i.test(trimmed))
        {
            return `${trimmed}/chat/completions`;
        }
        return `${trimmed}/v1/chat/completions`;
    }

    public async generate(prompt: string): Promise<IAResponse>
    {
        const finalPrompt = `${this.basePrompt}\n\n${prompt}`;
        const url = this.resolveChatCompletionsUrl();
        this.logger.info(localize('log.ia.requestGeneric', '[IA] Sending request to {0}', url));

        try
        {
            const response = await axios.post(
                url,
                {
                    model: this.model,
                    messages: [{ role: 'user', content: finalPrompt }]
                },
                {
                    headers:
                    {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000
                }
            );

            this.logger.info(localize('log.ia.analysisComplete', '[IA] AI analysis completed successfully.'));

            const usage = response.data?.usage;
            if (usage)
            {
                this.logger.info(
                    localize(
                        'log.ia.tokenUsage',
                        '[IA] Token usage - prompt: {0}, completion: {1}, total: {2}',
                        usage.prompt_tokens ?? '?',
                        usage.completion_tokens ?? '?',
                        usage.total_tokens ?? '?'
                    )
                );
            }

            const generatedText: string = response.data?.choices?.[0]?.message?.content || '';
            if (!generatedText)
            {
                this.logger.warn(localize('warn.ia.noText', '[IA] No generated text detected in the AI response.'));
            }

            return {
                resumen: generatedText || localize('info.ia.noSummary', 'No summary available')
            };
        }
        catch (error: any)
        {
            const status = error?.response?.status;
            if (status === 401 || status === 403)
            {
                throw new IAConnectionError(
                    localize('error.ia.authentication', 'Error authenticating with the AI server: {0}', error.message)
                );
            }

            this.logger.error(localize('log.ia.analysisError', '[IA] Error during AI analysis: {0}', error.message));
            if (error.response)
            {
                const payload = JSON.stringify(error.response.data);
                this.logger.error(localize('log.ia.errorResponse', '[IA] Server response: {0}...', payload.slice(0, 300)));
            }

            throw new Error(localize('error.ia.analysisFailed', 'Could not execute the AI analysis.'));
        }
    }
}
