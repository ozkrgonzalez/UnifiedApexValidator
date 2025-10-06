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
const winston = __importStar(require("winston"));
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
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: '.uav/logs/IAAnalisis.log' })
            ]
        });
    }
    /**
     * Obtiene el token OAuth2 para autenticación
     */
    async getAccessToken() {
        const url = `https://${this.domain}/services/oauth2/token`;
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        });
        this.logger.info(`Solicitando token en: ${url}`);
        try {
            const response = await axios_1.default.post(url, params);
            return response.data.access_token;
        }
        catch (error) {
            this.logger.error(`Error obteniendo token: ${error.message}`);
            throw new Error('Error autenticando con el servidor de IA');
        }
    }
    /**
     * Envía el texto o código Apex a la IA para obtener un análisis
     * @param prompt Texto o código a analizar
     */
    async analizar(prompt) {
        const token = await this.getAccessToken();
        const finalPrompt = `${this.basePrompt}\n\n${prompt}`;
        this.logger.info('Ejecutando análisis IA...');
        try {
            const response = await axios_1.default.post(`${this.endpoint}/inference`, {
                model: this.model,
                input: finalPrompt
            }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            const data = response.data;
            return {
                resumen: data.output?.summary ?? 'Sin resumen disponible',
                hallazgos: data.output?.findings ?? [],
                sugerencias: data.output?.recommendations ?? []
            };
        }
        catch (error) {
            this.logger.error(`Error durante el análisis IA: ${error.message}`);
            throw new Error('No se pudo ejecutar el análisis IA.');
        }
    }
}
exports.IAAnalisis = IAAnalisis;
