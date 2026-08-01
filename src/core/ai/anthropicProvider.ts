import axios from 'axios';
import { localize } from '../../i18n';
import { Logger } from '../utils';
import { IAConnectionError, IAProvider, IAResponse } from './types';

const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 4096;

export class AnthropicProvider implements IAProvider
{
    private logger = new Logger('IA:anthropic', true);

    constructor(
        private apiKey: string,
        private model: string,
        private basePrompt: string
    ) {}

    public async generate(prompt: string): Promise<IAResponse>
    {
        const finalPrompt = `${this.basePrompt}\n\n${prompt}`;
        this.logger.info(localize('log.ia.analysisStart', '[IA] Starting AI analysis...'));

        try
        {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: this.model,
                    max_tokens: ANTHROPIC_MAX_TOKENS,
                    messages: [{ role: 'user', content: finalPrompt }]
                },
                {
                    headers:
                    {
                        'x-api-key': this.apiKey,
                        'anthropic-version': ANTHROPIC_API_VERSION,
                        'content-type': 'application/json'
                    },
                    timeout: 120000
                }
            );

            this.logger.info(localize('log.ia.analysisComplete', '[IA] AI analysis completed successfully.'));

            const usage = response.data?.usage;
            if (usage)
            {
                const total = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
                this.logger.info(
                    localize(
                        'log.ia.tokenUsage',
                        '[IA] Token usage - prompt: {0}, completion: {1}, total: {2}',
                        usage.input_tokens ?? '?',
                        usage.output_tokens ?? '?',
                        total || '?'
                    )
                );
            }

            const generatedText: string = response.data?.content?.[0]?.text || '';
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
