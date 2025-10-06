import * as vscode from 'vscode';
import { Logger } from './utils';

/**
 * Controlador global de progreso para toda la extensión.
 * Permite que todos los módulos (validator, testSuite, etc.) reporten progreso coordinado.
 */
export class ProgressManager {
  private logger: Logger;
  private totalSteps: number;
  private currentStep: number;
  private progress?: vscode.Progress<{ message?: string }>;

  constructor(totalSteps = 7) {
    this.totalSteps = totalSteps;
    this.currentStep = 0;
    this.logger = new Logger('Progress', false);
  }

  /** Inicializa el progreso VS Code */
  public attach(progress: vscode.Progress<{ message?: string }>) {
    this.progress = progress;
  }

  /** Incrementa un paso global y actualiza visualmente */
  public step(message: string) {
    this.currentStep++;
    const percent = Math.min(Math.round((this.currentStep / this.totalSteps) * 100), 100);
    const bar = this.makeBar(percent);
    const text = `🧩 [${percent}%] ${message}`;

    this.logger.info(text);
    if (this.progress) this.progress.report({ message: text });

    // También muestra en Output Channel (barra visual)
    this.logger.info(`${bar} ${percent}%`);
  }

  /** Muestra un mensaje sin avanzar */
  public info(message: string) {
    this.logger.info(`ℹ️ ${message}`);
    if (this.progress) this.progress.report({ message });
  }

  /** Genera la barra de progreso visual */
  private makeBar(percent: number): string {
    const total = 20;
    const filled = Math.round((percent / 100) * total);
    const empty = total - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
  }

  /** Reinicia el progreso */
  public reset() {
    this.currentStep = 0;
    this.logger.info('🔄 Progreso reiniciado.');
  }
}

// Instancia global (singleton)
export const GlobalProgress = new ProgressManager();
