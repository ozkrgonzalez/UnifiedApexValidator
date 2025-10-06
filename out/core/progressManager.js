"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalProgress = exports.ProgressManager = void 0;
const utils_1 = require("./utils");
/**
 * Controlador global de progreso para toda la extensión.
 * Permite que todos los módulos (validator, testSuite, etc.) reporten progreso coordinado.
 */
class ProgressManager {
    logger;
    totalSteps;
    currentStep;
    progress;
    constructor(totalSteps = 7) {
        this.totalSteps = totalSteps;
        this.currentStep = 0;
        this.logger = new utils_1.Logger('Progress', false);
    }
    /** Inicializa el progreso VS Code */
    attach(progress) {
        this.progress = progress;
    }
    /** Incrementa un paso global y actualiza visualmente */
    step(message) {
        this.currentStep++;
        const percent = Math.min(Math.round((this.currentStep / this.totalSteps) * 100), 100);
        const bar = this.makeBar(percent);
        const text = `🧩 [${percent}%] ${message}`;
        this.logger.info(text);
        if (this.progress)
            this.progress.report({ message: text });
        // También muestra en Output Channel (barra visual)
        this.logger.info(`${bar} ${percent}%`);
    }
    /** Muestra un mensaje sin avanzar */
    info(message) {
        this.logger.info(`ℹ️ ${message}`);
        if (this.progress)
            this.progress.report({ message });
    }
    /** Genera la barra de progreso visual */
    makeBar(percent) {
        const total = 20;
        const filled = Math.round((percent / 100) * total);
        const empty = total - filled;
        return '▓'.repeat(filled) + '░'.repeat(empty);
    }
    /** Reinicia el progreso */
    reset() {
        this.currentStep = 0;
        this.logger.info('🔄 Progreso reiniciado.');
    }
}
exports.ProgressManager = ProgressManager;
// Instancia global (singleton)
exports.GlobalProgress = new ProgressManager();
