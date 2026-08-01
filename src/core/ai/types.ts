export interface IAResponse
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

export interface IAProvider
{
    generate(prompt: string): Promise<IAResponse>;
}

export type AiProviderId = 'einstein' | 'anthropic' | 'openai' | 'custom';

export interface IAConfigStatus
{
    ready: boolean;
    missing: string[];
}
