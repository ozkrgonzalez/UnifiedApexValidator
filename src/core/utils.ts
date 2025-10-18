import * as fs from 'fs-extra';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import * as vscode from 'vscode';
import * as glob from 'glob';
import { execa, execaSync } from 'execa';

let _ctx: vscode.ExtensionContext | undefined;
export function setExtensionContext(ctx: vscode.ExtensionContext)
{
  console.log('[UAV][setExtensionContext] ExtensionContext recibido:', !!ctx);
  console.log('[UAV][setExtensionContext] globalStorageUri:', ctx?.globalStorageUri?.fsPath);
  _ctx = ctx;
}

let globalChannel: vscode.OutputChannel | null = null;
let processHandlersRegistered = false;
const ignoredUnhandledPatterns: RegExp[] = [
  /CreateEmbeddingSupplier/i
];

function shouldIgnoreUnhandled(reason: any): boolean
{
  const message =
    typeof reason === 'string'
      ? reason
      : typeof reason?.message === 'string'
      ? reason.message
      : '';

  return ignoredUnhandledPatterns.some((pattern) => pattern.test(message));
}
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

  try
  {
    fs.ensureDirSync(dir);
  }
  catch (err)
  {
    console.error('[UAV][getStorageRoot] \u274C Error creando directorio', err);
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
    try
    {
      fs.ensureDirSync(logDir);
    }
    catch (err)
    {
      console.error('[UAV][Logger] \u274C Error creando carpeta de logs:', err);
    }

    this.logPath = path.join(logDir, `${prefix}.log`);
    this.outputChannel = getGlobalChannel();

    if (!fs.existsSync(this.logPath))
    {
      fs.writeFileSync(this.logPath, '\uFEFF', { encoding: 'utf8' });
    }

    if (autoShow)
      {
        this.outputChannel.show(true);
        console.log(`[UAV][Logger] Mostrando canal: ${channelName}`);
    }

    // Confirmar rutas
    console.log(`[UAV][Logger] logPath=${this.logPath}`);

    if (!processHandlersRegistered)
    {
      process.on('uncaughtException', (err) => this.error(`Uncaught Exception: ${err.message}`));
      process.on('unhandledRejection', (reason) =>
      {
        if (shouldIgnoreUnhandled(reason)) return;
        this.error(`Unhandled Rejection: ${reason}`);
      });
      processHandlersRegistered = true;
    }
  }

  clear()
  {
    console.log(`[UAV][Logger] Limpiando log: ${this.logPath}`);
    fs.writeFileSync(this.logPath, '\uFEFF', { encoding: 'utf8' });
  }

  private write(level: string, msg: string)
  {
    const line = `${new Date().toISOString()} [${level}] [${this.prefix}] ${msg}`;
    try
    {
      fs.appendFileSync(this.logPath, line + '\n', { encoding: 'utf8' });
    }
    catch (err)
    {
      console.error(`[UAV][Logger] \u274C Error escribiendo log ${this.logPath}:`, err);
    }
    this.outputChannel.appendLine(line);
  }

  info(msg: string) { this.write('INFO', msg); }
  warn(msg: string) { this.write('WARN', msg); }
  error(msg: string) { this.write('ERROR', msg); }

  pipe(childProcess: any) { /* vacio si ya filtras salida en TestSuite */ }
}

/**
 * Lee un package.xml y devuelve las clases test y no-test encontradas.
 */
export async function parseApexClassesFromPackage(pkgPath: string, repoDir: string)
{
  const logger = new Logger('PackageParser');

  try
  {
    logger.info(`📦 Leyendo package.xml desde: ${pkgPath}`);
    const xml = await fs.readFile(pkgPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const json = parser.parse(xml);

    //logger.info(`Estructura JSON parseada: ${JSON.stringify(json?.Package?.types, null, 2)}`);

    const types = json?.Package?.types || [];
    const apexTypes = Array.isArray(types)
      ? types.find((t: any) => t.name === 'ApexClass')
      : types.name === 'ApexClass'
        ? types
        : null;

    const members = Array.isArray(apexTypes.members) ? apexTypes.members : [apexTypes.members];
    const testClasses: string[] = [];
    const nonTestClasses: string[] = [];

    logger.info(`📂 Buscando clases dentro de: ${repoDir}`);

    for (const cls of members)
    {
      const matches = glob.sync(`**/${cls}.cls`, { cwd: repoDir, absolute: true });

      if (!matches.length)
      {
        continue;
      }

      const content = await fs.readFile(matches[0], 'utf8');
      if (/@istest/i.test(content))
      {
        testClasses.push(cls);
      }
      else
      {
        nonTestClasses.push(cls);
      }
    }

    logger.info(`🧪 Clases de prueba detectadas (${testClasses.length}): ${testClasses.join(', ') || 'Ninguna'}`);
    logger.info(`📖 Clases normales detectadas (${nonTestClasses.length}): ${nonTestClasses.join(', ') || 'Ninguna'}`);

    return { testClasses, nonTestClasses };
  }
  catch (err: any)
  {
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
    try
    {
      if (await fs.pathExists(dir))
      {
        await fs.emptyDir(dir);
        logger?.info(`🧹 Carpeta limpiada: ${dir}`);
      }
      else
      {
        logger?.warn(`⚠️ Carpeta no encontrada: ${dir}`);
      }
    }
    catch (err: any)
    {
      logger?.warn(`❌ No se pudo limpiar ${dir}: ${err.message}`);
    }
  }
}

export function resolveSfCliPath(): string
{
  const config = vscode.workspace.getConfiguration('UnifiedApexValidator');
  const configured = config.get<string>('sfCliPath')?.trim();
  const candidates: string[] = [];
  if (configured) candidates.push(configured);

  if (process.platform === 'win32')
  {
    candidates.push('sf.cmd', 'sf.CMD', 'sf');
  }
  else
  {
    candidates.push('sf');
  }

  const attempts: string[] = [];

  for (const cmd of candidates)
  {
    if (!cmd) continue;
    try
    {
      execaSync(cmd, ['--version']);
      return cmd;
    }
    catch (err: any)
    {
      const reason = err?.shortMessage || err?.message || String(err);
      attempts.push(`${cmd}: ${reason}`);
    }
  }

  throw new Error(
    `No se pudo localizar Salesforce CLI. Revisa UnifiedApexValidator.sfCliPath. Intentos: ${attempts.join('; ')}`
  );
}

export async function ensureOrgAliasConnected(alias: string, logger: Logger): Promise<boolean>
{
  const trimmed = (alias || '').trim();
  if (!trimmed)
  {
    vscode.window.showErrorMessage('Configura UnifiedApexValidator.sfOrgAlias antes de ejecutar el validador.');
    return false;
  }

  const sfPath = resolveSfCliPath();

  const checkAlias = async (): Promise<boolean> =>
  {
    try
    {
      const { stdout } = await execa(sfPath, ['org', 'display', '--json', '--target-org', trimmed], {
        env: { ...process.env, FORCE_COLOR: '0' }
      });
      const raw = stdout?.trim();
      if (!raw) return false;

      const info = JSON.parse(raw);
      const status: string =
        info?.result?.connectedStatus ||
        info?.result?.status ||
        info?.result?.connected;

      if (typeof status === 'string' && status.toLowerCase() === 'connected')
      {
        logger.info(`Org "${trimmed}" detectada como conectada.`);
        return true;
      }

      logger.warn(`Estado de la org "${trimmed}": ${status || 'desconocido'}.`);
      return false;
    }
    catch (err: any)
    {
      const reason = err?.shortMessage || err?.stderr || err?.message || String(err);
      logger.warn(`No se pudo verificar la org "${trimmed}": ${reason}`);
      return false;
    }
  };

  if (await checkAlias()) return true;

  const answer = await vscode.window.showWarningMessage(
    `La org con alias "${trimmed}" no aparece conectada en Salesforce CLI. \u00BFQuieres iniciar sesion ahora?`,
    'Conectar ahora',
    'Cancelar'
  );

  if (answer !== 'Conectar ahora')
  {
    logger.warn(`Se cancela la validacion porque la org "${trimmed}" no esta conectada.`);
    return false;
  }

  try
  {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Conectando org "${trimmed}"...`,
        cancellable: false
      },
      async () =>
      {
        logger.info(`Ejecutando "sf org login web --alias ${trimmed}". Completa el inicio de sesion en el navegador.`);

        const child = execa(sfPath, ['org', 'login', 'web', '--alias', trimmed], {
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, FORCE_COLOR: '0' }
        });
        child.stdout?.on('data', (data: Buffer) =>
        {
          const text = data.toString().trim();
          if (text) logger.info(`[sf] ${text}`);
        });

        child.stderr?.on('data', (data: Buffer) =>
        {
          const text = data.toString().trim();
          if (text) logger.warn(`[sf] ${text}`);
        });

        await child;
      }
    );
  }
  catch (err: any)
  {
    const reason = err?.shortMessage || err?.message || String(err);
    logger.error(`No se pudo completar el login de la org "${trimmed}": ${reason}`);
    vscode.window.showErrorMessage(`No se pudo conectar la org "${trimmed}". Revisa el Output de UAV para mas detalles.`);
    return false;
  }

  if (await checkAlias())
  {
    vscode.window.showInformationMessage(`Org "${trimmed}" conectada correctamente.`);
    return true;
  }

  vscode.window.showErrorMessage(
    `El alias "${trimmed}" sigue sin conexion tras el intento de login. Verifica tus permisos y repite el proceso.`
  );
  return false;
}








