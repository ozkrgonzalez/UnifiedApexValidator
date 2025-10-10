import axios from 'axios';
import * as vscode from 'vscode';
import { Logger } from './utils';

interface IAResponse
{
  resumen: string;
}

/**
 * Módulo IAAnalisis
 * Encargado de comunicarse con la API de IA definida en Settings (Einstein GPT u otra)
 */
export class IAAnalisis {
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

  private async getAccessToken(): Promise<string> {
    const url = `https://${this.domain}/services/oauth2/token`;
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    try
    {
      const response = await axios.post(url, params);
      const token = response.data.access_token;

      if (!token)
      {
        throw new Error('Token vacío en respuesta del servidor IA');
      }

      return token;
    }
    catch (error: any)
    {
      this.logger.error(`❌ Error obteniendo token IA: ${error.message}`);
      if (error.response)
      {
        this.logger.error(`📡 Respuesta del servidor IA: ${JSON.stringify(error.response.data)}`);
      }

      throw new Error('Error autenticando con el servidor de IA.');
    }
  }

  async analizar(prompt: string): Promise<IAResponse> {
    this.logger.info('🧠 Iniciando análisis IA...');

    const token = await this.getAccessToken();
    const finalPrompt = `${this.basePrompt}\n\n${prompt}`;

    try
    {
      // 🔹 Construir endpoint Einstein GPT
      const apiEndpoint = `${this.endpoint}/v1/models/${this.model}/generations`;

      this.logger.info(`🚀 Enviando solicitud a Einstein GPT: ${apiEndpoint}`);

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
          timeout: 60000
        }
      );
      this.logger.info('✅ Análisis IA completado correctamente.');

      // 🔹 Detectar el texto generado según el formato real de Einstein GPT
      let generatedText = '';
      const data = response.data || {};

      if (data.generation?.generatedText)
      {
        generatedText = data.generation.generatedText;
      }
      else if (data.generations?.length)
      {
        generatedText = data.generations[0].text || '';
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
        this.logger.warn('⚠️ No se detectó texto generado en la respuesta de IA.');
      }

      return {
        resumen: generatedText || 'Sin resumen disponible'
      };

    }
    catch (error: any)
    {
      this.logger.error(`❌ Error durante el análisis IA: ${error.message}`);
      if (error.response)
      {
        this.logger.error(`📡 Respuesta del servidor: ${JSON.stringify(error.response.data).slice(0, 300)}...`);
      }

      throw new Error('No se pudo ejecutar el análisis IA.');
    }
  }
}
