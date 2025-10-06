import * as fs from 'fs-extra';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import * as vscode from 'vscode';
import glob from 'glob';

let _ctx: vscode.ExtensionContext | undefined;
export function setExtensionContext(ctx: vscode.ExtensionContext)
{
  console.log('[UAV][setExtensionContext] ExtensionContext recibido:', !!ctx);
  console.log('[UAV][setExtensionContext] globalStorageUri:', ctx?.globalStorageUri?.fsPath);
  _ctx = ctx;
}

let globalChannel: vscode.OutputChannel | null = null;

export function getGlobalChannel(): vscode.OutputChannel
{
  if (!globalChannel)
  {
    globalChannel = vscode.window.createOutputChannel('Unified Apex Validator');
    globalChannel.show(true);
  }
  return globalChannel;
}

export function getStorageRoot(): string
{
  const base = _ctx?.globalStorageUri?.fsPath || path.resolve(__dirname, '..', '..');
  const dir = path.join(base, '.uav');

  console.log('[UAV][getStorageRoot] Base path:', base);
  console.log('[UAV][getStorageRoot] Dir path:', dir);

  try
  {
    fs.ensureDirSync(dir);
  }
  catch (err)
  {
    console.error('[UAV][getStorageRoot] ❌ Error creando directorio', err);
  }

  return dir;
}

export class Logger
{
  private logPath: string;
  private outputChannel: vscode.OutputChannel;
  private prefix: string;

  constructor(prefix: string, autoShow: boolean = false, channelName = 'Unified Apex Validator')
  {
    this.prefix = prefix;

    const storageRoot = getStorageRoot();
    console.log(`[UAV][Logger] Creando logger para ${prefix} en ${storageRoot}`);

    const logDir = path.join(storageRoot, 'logs');
    try {
      fs.ensureDirSync(logDir);
    } catch (err) {
      console.error('[UAV][Logger] ❌ Error creando carpeta de logs:', err);
    }

    this.logPath = path.join(logDir, `${prefix}.log`);
    //this.outputChannel = vscode.window.createOutputChannel(channelName);
    this.outputChannel = getGlobalChannel();
    if (autoShow) {
        this.outputChannel.show(true);
        console.log(`[UAV][Logger] Mostrando canal: ${channelName}`);
    }

    // Confirmar rutas
    console.log(`[UAV][Logger] logPath=${this.logPath}`);

    process.on('uncaughtException', (err) => this.error(`Uncaught Exception: ${err.message}`));
    process.on('unhandledRejection', (reason) => this.error(`Unhandled Rejection: ${reason}`));
  }

  clear() {
    console.log(`[UAV][Logger] Limpiando log: ${this.logPath}`);
    fs.writeFileSync(this.logPath, '');
  }

  private write(level: string, msg: string)
  {
    const line = `${new Date().toISOString()} [${level}] [${this.prefix}] ${msg}`;
    try
    {
      fs.appendFileSync(this.logPath, line + '\n');
    }
    catch (err)
    {
      console.error(`[UAV][Logger] ❌ Error escribiendo log ${this.logPath}:`, err);
    }
    this.outputChannel.appendLine(line);
  }

  info(msg: string) { this.write('INFO', msg); }
  warn(msg: string) { this.write('WARN', msg); }
  error(msg: string) { this.write('ERROR', msg); }

  pipe(childProcess: any) { /* vacío si ya filtrás salida en TestSuite */ }
}

/**
 * Lee un package.xml y devuelve las clases test y no-test encontradas.
 */
export async function parseApexClassesFromPackage(pkgPath: string, repoDir: string) {
  const logger = new Logger('PackageParser');

  try {
    logger.info(`📦 Leyendo package.xml desde: ${pkgPath}`);
    const xml = await fs.readFile(pkgPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const json = parser.parse(xml);

    //logger.info(`🧩 Estructura JSON parseada: ${JSON.stringify(json?.Package?.types, null, 2)}`);

    const types = json?.Package?.types || [];
    const apexTypes = Array.isArray(types)
      ? types.find((t: any) => t.name === 'ApexClass')
      : types.name === 'ApexClass'
        ? types
        : null;

    if (!apexTypes) {
      logger.warn('❌ No se encontraron tipos ApexClass en package.xml');
      throw new Error('No se encontraron clases Apex en package.xml');
    }

    const members = Array.isArray(apexTypes.members) ? apexTypes.members : [apexTypes.members];
    logger.info(`📄 Miembros detectados (${members.length}): ${members.join(', ')}`);

    const testClasses: string[] = [];
    const nonTestClasses: string[] = [];

    logger.info(`📁 Buscando clases dentro de: ${repoDir}`);

    for (const cls of members) {
      const matches = glob.sync(`**/${cls}.cls`, { cwd: repoDir, absolute: true });
      logger.info(`🔍 Buscando ${cls}.cls → encontrados: ${matches.length}`);

      if (!matches.length) continue;

      const content = await fs.readFile(matches[0], 'utf8');
      if (/@istest/i.test(content)) {
        logger.info(`✅ ${cls} marcada como clase de prueba`);
        testClasses.push(cls);
      } else {
        logger.info(`ℹ️ ${cls} no es clase de prueba`);
        nonTestClasses.push(cls);
      }
    }

    logger.info(`🧪 Clases de prueba detectadas (${testClasses.length}): ${testClasses.join(', ') || 'Ninguna'}`);
    logger.info(`📘 Clases normales detectadas (${nonTestClasses.length}): ${nonTestClasses.join(', ') || 'Ninguna'}`);

    return { testClasses, nonTestClasses };
  } catch (err: any) {
    console.error('[UAV][PackageParser] ❌ Error parseando package.xml:', err);
    throw err;
  }
}

/**
 * Elimina de forma segura los archivos y carpetas indicadas
 * @param paths Lista de rutas a limpiar
 * @param logger Logger opcional para registrar la limpieza
 */
export async function cleanUpFiles(paths: string[], logger?: Logger)
{
  for (const dir of paths)
    {
    try {
      if (await fs.pathExists(dir)) {
        await fs.emptyDir(dir);
        logger?.info(`🧹 Carpeta limpiada: ${dir}`);
      } else {
        logger?.warn(`⚠️ Carpeta no encontrada: ${dir}`);
      }
    } catch (err: any) {
      logger?.warn(`❌ No se pudo limpiar ${dir}: ${err.message}`);
    }
  }
}

