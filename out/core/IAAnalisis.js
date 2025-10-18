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
exports.IAAnalisis = exports.IAConnectionError = void 0;
exports.evaluateIaConfig = evaluateIaConfig;
const axios_1 = __importDefault(require("axios"));
const vscode = __importStar(require("vscode"));
const utils_1 = require("./utils");
class IAConnectionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'IAConnectionError';
        Object.setPrototypeOf(this, IAConnectionError.prototype);
    }
}
exports.IAConnectionError = IAConnectionError;
/**
 * Client responsible for talking with the configured Einstein GPT (or compatible) endpoint.
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
        const url = `https://${this.domain.replace(/^https:\/\//i, '')}/services/oauth2/token`;
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        });
        try {
            const response = await axios_1.default.post(url, params);
            const token = response.data?.access_token;
            if (!token) {
                throw new Error('Token vacio en la respuesta del servidor IA.');
            }
            return token;
        }
        catch (error) {
            this.logger.error(`[IA] Error obteniendo token IA: ${error.message}`);
            if (error.response) {
                this.logger.error(`[IA] Respuesta del servidor IA: ${JSON.stringify(error.response.data)}`);
            }
            throw new IAConnectionError(`Error autenticando con el servidor de IA: ${error.message}`);
        }
    }
    async generate(prompt) {
        this.logger.info('[IA] Iniciando analisis IA...');
        const token = await this.getAccessToken();
        const finalPrompt = `${this.basePrompt}\n\n${prompt}`;
        try {
            const apiEndpoint = `${this.endpoint}/v1/models/${this.model}/generations`;
            this.logger.info(`[IA] Enviando solicitud a Einstein GPT: ${apiEndpoint}`);
            const response = await axios_1.default.post(apiEndpoint, { prompt: finalPrompt }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'x-sfdc-app-context': 'EinsteinGPT',
                    'x-client-feature-id': 'ai-platform-models-connected-app'
                },
                timeout: 120000
            });
            this.logger.info('[IA] Analisis IA completado correctamente.');
            let generatedText = '';
            const data = response.data || {};
            if (data.generation?.generatedText) {
                generatedText = data.generation.generatedText;
            }
            else if (data.generations?.length) {
                generatedText = data.generations[0]?.text || '';
            }
            else if (data.generation?.text) {
                generatedText = data.generation.text;
            }
            else if (typeof data === 'string') {
                generatedText = data;
            }
            if (!generatedText) {
                this.logger.warn('[IA] No se detecto texto generado en la respuesta de IA.');
            }
            return {
                resumen: generatedText || 'Sin resumen disponible'
            };
        }
        catch (error) {
            this.logger.error(`[IA] Error durante el analisis IA: ${error.message}`);
            if (error.response) {
                const payload = JSON.stringify(error.response.data);
                this.logger.error(`[IA] Respuesta del servidor: ${payload.slice(0, 300)}...`);
            }
            throw new Error('No se pudo ejecutar el analisis IA.');
        }
    }
}
exports.IAAnalisis = IAAnalisis;
function evaluateIaConfig() {
    const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
    const requiredFields = [
        { key: 'sfGptEndpoint', label: 'sfGptEndpoint' },
        { key: 'sfGptModel', label: 'sfGptModel' },
        { key: 'sfClientId', label: 'sfClientId' },
        { key: 'sfClientSecret', label: 'sfClientSecret' },
        { key: 'iaPromptTemplate', label: 'iaPromptTemplate' }
    ];
    const missing = requiredFields
        .filter(({ key }) => {
        const value = config.get(key);
        return typeof value !== 'string' || value.trim().length === 0;
    })
        .map(({ label }) => label);
    return {
        ready: missing.length === 0,
        missing
    };
}
