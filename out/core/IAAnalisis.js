"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IAAnalisis = void 0;
const axios_1 = __importDefault(require("axios"));
const vscode = __importStar(require("vscode"));
const utils_1 = require("./utils");
/**
 * Módulo IAAnalisis
 * Encargado de comunicarse con la API de IA definida en Settings (Einstein GPT u otra)
 */
class IAAnalisis {
    logger;
    endpoint;
    model;
    clientId;
    clientSecret;
    domain;
    basePrompt;
    constructor() {
        const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
        this.endpoint = config.get('sfGptEndpoint') ?? '';
        this.model = config.get('sfGptModel') ?? '';
        this.clientId = config.get('sfClientId') ?? '';
        this.clientSecret = config.get('sfClientSecret') ?? '';
        this.domain = config.get('sfDomain') ?? 'test.salesforce.com';
        this.basePrompt = config.get('iaPromptTemplate') ?? '';
        this.logger = new utils_1.Logger('IAAnalisis', true);
    }
    async getAccessToken() {
        const url = `https://${this.domain}/services/oauth2/token`;
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        });
        try {
            const response = await axios_1.default.post(url, params);
            const token = response.data.access_token;
            if (!token) {
                throw new Error('Token vacío en respuesta del servidor IA');
            }
            return token;
        }
        catch (error) {
            this.logger.error(`❌ Error obteniendo token IA: ${error.message}`);
            if (error.response) {
                this.logger.error(`📡 Respuesta del servidor IA: ${JSON.stringify(error.response.data)}`);
            }
            throw new Error('Error autenticando con el servidor de IA.');
        }
    }
    async analizar(prompt) {
        this.logger.info('🧠 Iniciando análisis IA...');
        const token = await this.getAccessToken();
        const finalPrompt = `${this.basePrompt}\n\n${prompt}`;
        try {
            // 🔹 Construir endpoint Einstein GPT
            const apiEndpoint = `${this.endpoint}/v1/models/${this.model}/generations`;
            this.logger.info(`🚀 Enviando solicitud a Einstein GPT: ${apiEndpoint}`);
            const response = await axios_1.default.post(apiEndpoint, { prompt: finalPrompt }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'x-sfdc-app-context': 'EinsteinGPT',
                    'x-client-feature-id': 'ai-platform-models-connected-app'
                },
                timeout: 60000
            });
            this.logger.info('✅ Análisis IA completado correctamente.');
            // 🔹 Detectar el texto generado según el formato real de Einstein GPT
            let generatedText = '';
            const data = response.data || {};
            if (data.generation?.generatedText) {
                generatedText = data.generation.generatedText;
            }
            else if (data.generations?.length) {
                generatedText = data.generations[0].text || '';
            }
            else if (data.generation?.text) {
                generatedText = data.generation.text;
            }
            else if (typeof data === 'string') {
                generatedText = data;
            }
            if (!generatedText) {
                this.logger.warn('⚠️ No se detectó texto generado en la respuesta de IA.');
            }
            return {
                resumen: generatedText || 'Sin resumen disponible'
            };
        }
        catch (error) {
            this.logger.error(`❌ Error durante el análisis IA: ${error.message}`);
            if (error.response) {
                this.logger.error(`📡 Respuesta del servidor: ${JSON.stringify(error.response.data).slice(0, 300)}...`);
            }
            throw new Error('No se pudo ejecutar el análisis IA.');
        }
    }
}
exports.IAAnalisis = IAAnalisis;
