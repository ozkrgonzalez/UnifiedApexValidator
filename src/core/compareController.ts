import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import * as Diff from "diff";
import { execa } from "execa";
import * as glob from "glob";
import { parseMetadataTypesFromPackage, getStorageRoot, Logger, PackageTypeMembers } from "./utils";
import { localize } from "../i18n";
import { generateComparisonReport } from "./reportGenerator";

function normalizeForComparison(source: string): string
{
  return source
  .replace(/^\uFEFF/, "")
  .replace(/\r\n/g, "\n")
  .replace(/[ \t]+$/gm, "")
  .trim();
}

const BINARY_EXTENSIONS = new Set<string>([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".ico",
  ".pdf",
  ".zip",
  ".jar",
  ".rar",
  ".7z",
  ".mp3",
  ".mp4",
  ".ogg",
  ".wav",
  ".flac",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".png",
  ".svgz"
]);

type ComparisonStatusKey = "match" | "mismatch" | "onlyOrg" | "onlyLocal" | "missingBoth";

interface ComparisonResult
{
  metadataType: string;
  itemName: string;
  relativePath: string;
  status: string;
  statusKey: ComparisonStatusKey;
  differences?: string;
  localVersion?: string;
  salesforceVersion?: string;
  isBinary?: boolean;
  localPath?: string;
  remotePath?: string;
}

interface ManifestMetadata
{
  type: string;
  members: string[];
  hasWildcard: boolean;
}

interface RemoteFileEntry
{
  absolutePath: string;
  relativePath: string;
}

interface FileMetadataInfo
{
  type: string;
  fullName: string;
}

interface RetrieveMetadataMaps
{
  byPath: Map<string, FileMetadataInfo>;
  byComponent: Map<string, FileMetadataInfo>;
}

interface LocalFileMatch
{
  absolutePath: string;
  root: string;
}

const WINDOWS = process.platform === "win32";

const SIMPLE_SUFFIX_TYPE_MAP: Array<{ regex: RegExp; type: string }> = [
  { regex: /\.cls(-meta\.xml)?$/i, type: "ApexClass" },
  { regex: /\.trigger(-meta\.xml)?$/i, type: "ApexTrigger" },
  { regex: /\.page(-meta\.xml)?$/i, type: "ApexPage" },
  { regex: /\.component(-meta\.xml)?$/i, type: "ApexComponent" },
  { regex: /\.resource(-meta\.xml)?$/i, type: "StaticResource" },
  { regex: /\.permissionset(-meta\.xml)?$/i, type: "PermissionSet" },
  { regex: /\.profile(-meta\.xml)?$/i, type: "Profile" },
  { regex: /\.layout(-meta\.xml)?$/i, type: "Layout" },
  { regex: /\.workflow(-meta\.xml)?$/i, type: "Workflow" },
  { regex: /\.flow(-meta\.xml)?$/i, type: "Flow" },
  { regex: /\.flowdefinition(-meta\.xml)?$/i, type: "FlowDefinition" },
  { regex: /\.md-meta\.xml$/i, type: "CustomMetadata" },
  { regex: /\.labels-meta\.xml$/i, type: "CustomLabels" },
  { regex: /\.object-meta\.xml$/i, type: "CustomObject" },
  { regex: /\.field-meta\.xml$/i, type: "CustomField" },
  { regex: /\.recordtype-meta\.xml$/i, type: "RecordType" },
  { regex: /\.lightningpage-meta\.xml$/i, type: "LightningPage" },
  { regex: /\.translation-meta\.xml$/i, type: "Translations" },
  { regex: /\.remoteSite-meta\.xml$/i, type: "RemoteSiteSetting" },
  { regex: /\.email(-meta\.xml)?$/i, type: "EmailTemplate" },
  { regex: /\.settings-meta\.xml$/i, type: "Settings" }
];

const OBJECT_CHILD_FOLDER_TO_TYPE: Record<string, { type: string; suffix: string }> = {
  fields: { type: "CustomField", suffix: ".field-meta.xml" },
  listviews: { type: "ListView", suffix: ".listView-meta.xml" },
  recordtypes: { type: "RecordType", suffix: ".recordType-meta.xml" },
  fieldsets: { type: "FieldSet", suffix: ".fieldSet-meta.xml" },
  validationrules: { type: "ValidationRule", suffix: ".validationRule-meta.xml" },
  compactlayouts: { type: "CompactLayout", suffix: ".compactLayout-meta.xml" },
  businessprocesses: { type: "BusinessProcess", suffix: ".businessProcess-meta.xml" },
  sharingreasons: { type: "SharingReason", suffix: ".sharingReason-meta.xml" },
  weblinks: { type: "WebLink", suffix: ".webLink-meta.xml" },
  indexes: { type: "Index", suffix: ".index-meta.xml" },
  searchlayouts: { type: "SearchLayout", suffix: ".searchLayouts-meta.xml" }
};

const OBJECT_CHILD_TYPE_TO_FOLDER: Record<string, { folder: string; suffix: string }> = Object.entries(OBJECT_CHILD_FOLDER_TO_TYPE)
.reduce((acc, [folder, value]) =>
{
  acc[value.type] = { folder, suffix: value.suffix };
  return acc;
}, {} as Record<string, { folder: string; suffix: string }>);

const COMPONENT_FILE_PATTERNS: Record<string, (fullName: string) => string[]> = {
  ApexClass: (name) => [
    `classes/${name}.cls`,
    `classes/${name}.cls-meta.xml`
  ],
  ApexTrigger: (name) => [
    `triggers/${name}.trigger`,
    `triggers/${name}.trigger-meta.xml`
  ],
  ApexPage: (name) => [
    `pages/${name}.page`,
    `pages/${name}.page-meta.xml`
  ],
  ApexComponent: (name) => [
    `components/${name}.component`,
    `components/${name}.component-meta.xml`
  ],
  CustomMetadata: (name) => [
    `customMetadata/${name}.md-meta.xml`
  ],
  CustomObject: (name) => [
    `objects/${name}.object-meta.xml`
  ],
  Layout: (name) => [
    `layouts/${name}.layout-meta.xml`
  ],
  PermissionSet: (name) => [
    `permissionsets/${name}.permissionset-meta.xml`
  ],
  Profile: (name) => [
    `profiles/${name}.profile-meta.xml`
  ],
  Flow: (name) => [
    `flows/${name}.flow-meta.xml`
  ],
  FlowDefinition: (name) => [
    `flowDefinitions/${name}.flowDefinition-meta.xml`
  ],
  Workflow: (name) => [
    `workflows/${name}.workflow-meta.xml`
  ],
  Translations: (name) => [
    `translations/${name}.translation-meta.xml`
  ],
  CustomLabels: () => [
    `labels/CustomLabels.labels-meta.xml`
  ],
  StaticResource: (name) => [
    `staticresources/${name}.resource`,
    `staticresources/${name}.resource-meta.xml`
  ],
  Settings: (name) => [
    `settings/${name}.settings-meta.xml`
  ],
  RemoteSiteSetting: (name) => [
    `remoteSiteSettings/${name}.remoteSite-meta.xml`
  ],
  CustomPermission: (name) => [
    `customPermissions/${name}.customPermission-meta.xml`
  ],
  EmailTemplate: (name) => [
    `email/${name}.email`,
    `email/${name}.email-meta.xml`
  ],
  Report: (name) => [
    `reports/${name}.report`
  ],
  Dashboard: (name) => [
    `dashboards/${name}.dashboard`
  ],
  Document: (name) => [
    `documents/${name}.document`
  ],
  Territory2Model: (name) => [
    `territory2Models/${name}.territory2Model`
  ],
  Territory2Rule: (name) => [
    `territory2Rules/${name}.territory2Rule`
  ]
};

const DIRECTORY_COMPONENT_PATTERNS: Record<string, (fullName: string) => string> = {
  LightningComponentBundle: (name) => `lwc/${name}`,
  AuraDefinitionBundle: (name) => `aura/${name}`,
  ExperienceBundle: (name) => `experiences/${name}`,
  DigitalExperienceBundle: (name) => `experiences/${name}`
};

function normalizeMetadataPath(value: string): string
{
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\.\\/, "");
}

function generatePathVariants(value: string): string[]
{
  const normalized = normalizeMetadataPath(value);
  const variants = new Set<string>();
  variants.add(normalized);

  const knownPrefixes = [
    "force-app/main/default/",
    "main/default/",
    "force-app/",
    "unpackaged/main/default/",
    "unpackaged/",
    "src/"
  ];

  for (const prefix of knownPrefixes)
  {
    if (normalized.startsWith(prefix))
    {
      variants.add(normalized.substring(prefix.length));
    }
  }

  const segments = normalized.split("/");
  if (segments.length > 1)
  {
    variants.add(segments.slice(1).join("/"));
  }

  const basename = path.posix.basename(normalized);
  variants.add(basename);

  return Array.from(variants).filter(Boolean);
}

function collectRemoteFiles(root: string): RemoteFileEntry[]
{
  const matches = glob.sync("**/*", {
    cwd: root,
    dot: true,
    nodir: true,
    absolute: true,
    windowsPathsNoEscape: true
  }) as string[];

  return matches
  .map((absolutePath) =>
  {
    const relativePath = normalizeMetadataPath(path.relative(root, absolutePath));
    return { absolutePath, relativePath };
  })
  .filter((entry) => entry.relativePath && !entry.relativePath.toLowerCase().endsWith("package.xml"));
}

function stripFileSuffix(fileName: string, suffix: string): string
{
  if (fileName.toLowerCase().endsWith(suffix.toLowerCase()))
  {
    return fileName.slice(0, fileName.length - suffix.length);
  }
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(0, idx) : fileName;
}

function sanitizeFullName(value: string): string
{
  const normalized = normalizeMetadataPath(value);
  const base = path.posix.basename(normalized);
  const clean = base
  .replace(/\.cls(-meta\.xml)?$/i, "")
  .replace(/\.trigger(-meta\.xml)?$/i, "")
  .replace(/\.page(-meta\.xml)?$/i, "")
  .replace(/\.component(-meta\.xml)?$/i, "")
  .replace(/\.resource(-meta\.xml)?$/i, "")
  .replace(/\.meta\.xml$/i, "")
  .replace(/\.email$/i, "");
  return clean;
}

function buildRetrieveMetadataMaps(payload: any): RetrieveMetadataMaps
{
  const byPath = new Map<string, FileMetadataInfo>();
  const byComponent = new Map<string, FileMetadataInfo>();

  const containers = [
    payload?.result?.files,
    payload?.result?.fileProperties,
    payload?.result?.inboundFiles,
    payload?.result?.deployedSource
  ];

  for (const container of containers)
  {
    if (!Array.isArray(container))
    {
      continue;
    }

    for (const entry of container)
    {
      const type = typeof entry?.type === "string"
        ? entry.type
        : typeof entry?.fileType === "string"
          ? entry.fileType
          : typeof entry?.componentType === "string"
            ? entry.componentType
            : "Unknown";

      const fullNameRaw = typeof entry?.fullName === "string"
        ? entry.fullName
        : typeof entry?.componentFullName === "string"
          ? entry.componentFullName
          : typeof entry?.name === "string"
            ? entry.name
            : typeof entry?.fileName === "string"
              ? sanitizeFullName(entry.fileName)
              : "Unknown";

      const info: FileMetadataInfo = {
        type,
        fullName: fullNameRaw
      };

      const componentKey = `${type}#${fullNameRaw}`.toLowerCase();
      if (!byComponent.has(componentKey))
      {
        byComponent.set(componentKey, info);
      }

      const filePathRaw = typeof entry?.filePath === "string"
        ? entry.filePath
        : typeof entry?.fileName === "string"
          ? entry.fileName
          : "";

      if (filePathRaw)
      {
        for (const variant of generatePathVariants(filePathRaw))
        {
          const key = normalizeMetadataPath(variant).toLowerCase();
          if (!byPath.has(key))
          {
            byPath.set(key, info);
          }
        }
      }
    }

    if (byPath.size || byComponent.size)
    {
      break;
    }
  }

  return { byPath, byComponent };
}

function matchMetadataInfoForPath(relativePath: string, maps: RetrieveMetadataMaps): FileMetadataInfo | undefined
{
  const normalized = normalizeMetadataPath(relativePath);
  const lower = normalized.toLowerCase();

  const direct = maps.byPath.get(lower);
  if (direct)
  {
    return direct;
  }

  for (const variant of generatePathVariants(normalized))
  {
    const info = maps.byPath.get(normalizeMetadataPath(variant).toLowerCase());
    if (info)
    {
      return info;
    }
  }

  return undefined;
}

function inferMetadataFromRelativePath(relativePath: string): FileMetadataInfo | undefined
{
  const normalized = normalizeMetadataPath(relativePath);
  const segments = normalized.split("/");
  if (!segments.length)
  {
    return undefined;
  }

  const basename = path.posix.basename(normalized);
  const ext = path.posix.extname(basename).toLowerCase();

  const simpleMatch = SIMPLE_SUFFIX_TYPE_MAP.find((entry) => entry.regex.test(basename));
  if (simpleMatch)
  {
    return { type: simpleMatch.type, fullName: sanitizeFullName(basename) };
  }

  const findSegment = (value: string): number =>
    segments.findIndex((segment) => segment.toLowerCase() === value.toLowerCase());

  const classesIdx = findSegment("classes");
  if (classesIdx >= 0)
  {
    return { type: "ApexClass", fullName: basename.replace(/\.cls(-meta\.xml)?$/i, "") };
  }

  const triggerIdx = findSegment("triggers");
  if (triggerIdx >= 0)
  {
    return { type: "ApexTrigger", fullName: basename.replace(/\.trigger(-meta\.xml)?$/i, "") };
  }

  const pageIdx = findSegment("pages");
  if (pageIdx >= 0)
  {
    return { type: "ApexPage", fullName: basename.replace(/\.page(-meta\.xml)?$/i, "") };
  }

  const componentIdx = findSegment("components");
  if (componentIdx >= 0)
  {
    return { type: "ApexComponent", fullName: basename.replace(/\.component(-meta\.xml)?$/i, "") };
  }

  const lwcIdx = findSegment("lwc");
  if (lwcIdx >= 0 && segments.length > lwcIdx + 1)
  {
    return { type: "LightningComponentBundle", fullName: segments[lwcIdx + 1] };
  }

  const auraIdx = findSegment("aura");
  if (auraIdx >= 0 && segments.length > auraIdx + 1)
  {
    return { type: "AuraDefinitionBundle", fullName: segments[auraIdx + 1] };
  }

  const expIdx = findSegment("experiences");
  if (expIdx >= 0 && segments.length > expIdx + 1)
  {
    return { type: "ExperienceBundle", fullName: segments[expIdx + 1] };
  }

  const objectIdx = findSegment("objects");
  if (objectIdx >= 0 && segments.length > objectIdx + 1)
  {
    const objectName = segments[objectIdx + 1];
    if (basename.toLowerCase().endsWith(".object-meta.xml"))
    {
      return { type: "CustomObject", fullName: objectName };
    }

    if (segments.length > objectIdx + 2)
    {
      const childFolder = segments[objectIdx + 2].toLowerCase();
      const mapping = OBJECT_CHILD_FOLDER_TO_TYPE[childFolder];
      if (mapping)
      {
        const childName = stripFileSuffix(basename, mapping.suffix);
        return { type: mapping.type, fullName: `${objectName}.${childName}` };
      }
    }
  }

  const permIdx = findSegment("permissionsets");
  if (permIdx >= 0)
  {
    return { type: "PermissionSet", fullName: basename.replace(/\.permissionset(-meta\.xml)?$/i, "") };
  }

  const profileIdx = findSegment("profiles");
  if (profileIdx >= 0)
  {
    return { type: "Profile", fullName: basename.replace(/\.profile(-meta\.xml)?$/i, "") };
  }

  const layoutIdx = findSegment("layouts");
  if (layoutIdx >= 0)
  {
    return { type: "Layout", fullName: basename.replace(/\.layout(-meta\.xml)?$/i, "") };
  }

  const flowIdx = findSegment("flows");
  if (flowIdx >= 0)
  {
    return { type: "Flow", fullName: basename.replace(/\.flow(-meta\.xml)?$/i, "") };
  }

  const flowDefIdx = findSegment("flowdefinitions");
  if (flowDefIdx >= 0)
  {
    return { type: "FlowDefinition", fullName: basename.replace(/\.flowdefinition(-meta\.xml)?$/i, "") };
  }

  const emailIdx = findSegment("email");
  if (emailIdx >= 0)
  {
    return { type: "EmailTemplate", fullName: basename.replace(/\.email(-meta\.xml)?$/i, "") };
  }

  const staticResIdx = findSegment("staticresources");
  if (staticResIdx >= 0)
  {
    return { type: "StaticResource", fullName: basename.replace(/\.resource(-meta\.xml)?$/i, "") };
  }

  const customMetadataIdx = findSegment("custommetadata");
  if (customMetadataIdx >= 0)
  {
    return { type: "CustomMetadata", fullName: basename.replace(/\.md-meta\.xml$/i, "") };
  }

  const labelIdx = findSegment("labels");
  if (labelIdx >= 0)
  {
    return { type: "CustomLabels", fullName: "CustomLabels" };
  }

  const translationIdx = findSegment("objecttranslations");
  if (translationIdx >= 0)
  {
    return { type: "ObjectTranslation", fullName: basename.replace(/\.objecttranslation(-meta\.xml)?$/i, "") };
  }

  if (ext === ".json")
  {
    return { type: "JSON", fullName: basename.replace(/\.json$/i, "") };
  }

  if (ext === ".xml")
  {
    return { type: "XML", fullName: basename.replace(/\.xml$/i, "") };
  }

  return { type: "Unknown", fullName: sanitizeFullName(normalized) };
}

function isBinaryPath(filePath: string): boolean
{
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function buildTextDiff(localContent: string, remoteContent: string): string
{
  return Diff.diffLines(localContent, remoteContent)
  .map((part) =>
  {
    const sign = part.added ? "+" : part.removed ? "-" : " ";
    return part.value
    .split("\n")
    .map((line) => `${sign} ${line}`)
    .join("\n");
  })
  .join("\n");
}

async function binaryDifference(localPath: string | undefined, remotePath: string): Promise<{ equal: boolean; message?: string }>
{
  const remoteSize = (await fs.stat(remotePath)).size;
  if (!localPath)
  {
    return {
      equal: false,
      message: localize('log.compareController.binaryOnlyOrg', 'Binary file only present in org ({0} bytes).', remoteSize) // Localized string
    };
  }

  const localSize = (await fs.stat(localPath)).size;
  if (localSize === remoteSize)
  {
    return { equal: true };
  }

  return {
    equal: false,
    message: localize('log.compareController.binarySizeDiff', 'Binary files differ (local {0} bytes vs org {1} bytes).', localSize, remoteSize) // Localized string
  };
}

async function findLocalCandidate(relativePath: string, roots: string[], logger: Logger): Promise<LocalFileMatch | null>
{
  const normalized = normalizeMetadataPath(relativePath);
  const variants = generatePathVariants(normalized);

  for (const root of roots)
  {
    for (const variant of variants)
    {
      const candidate = path.resolve(root, variant);
      if (await fs.pathExists(candidate))
      {
        return { absolutePath: candidate, root };
      }
    }
  }

  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? normalized;
  const suffix = segments.length > 1 ? segments.slice(-2).join("/") : basename;

  const fallbackPatterns = [basename, suffix, normalized];

  for (const root of roots)
  {
    for (const pattern of fallbackPatterns)
    {
      const globPattern = pattern.includes("/") ? `**/${pattern}` : `**/${pattern}`;
      const matches = glob.sync(globPattern, {
        cwd: root,
        dot: true,
        nodir: true,
        absolute: true,
        nocase: WINDOWS,
        windowsPathsNoEscape: true
      }) as string[];

      if (matches.length === 1)
      {
        return { absolutePath: matches[0], root };
      }

      if (matches.length > 1)
      {
        logger.warn(localize('log.compareController.multipleLocalCandidates', 'Multiple local matches found for {0}. Using {1}', normalized, matches[0])); // Localized string
        return { absolutePath: matches[0], root };
      }
    }
  }

  return null;
}

async function resolveLocalFilesForComponent(type: string, fullName: string, roots: string[]): Promise<LocalFileMatch[]>
{
  const matches: LocalFileMatch[] = [];
  const patternResolver = COMPONENT_FILE_PATTERNS[type];
  const dirResolver = DIRECTORY_COMPONENT_PATTERNS[type];

  for (const root of roots)
  {
    if (patternResolver)
    {
      for (const pattern of patternResolver(fullName))
      {
        const files = glob.sync(pattern, {
          cwd: root,
          dot: true,
          nodir: true,
          absolute: true,
          nocase: WINDOWS,
          windowsPathsNoEscape: true
        }) as string[];

        for (const file of files)
        {
          matches.push({ absolutePath: file, root });
        }
      }
    }
    else if (dirResolver)
    {
      const dirPath = path.join(root, dirResolver(fullName));
      if (await fs.pathExists(dirPath))
      {
        const files = glob.sync("**/*", {
          cwd: dirPath,
          dot: true,
          nodir: true,
          absolute: true,
          windowsPathsNoEscape: true
        }) as string[];

        for (const file of files)
        {
          matches.push({ absolutePath: file, root });
        }
      }
    }
    else if (fullName.includes("."))
    {
      const mapping = OBJECT_CHILD_TYPE_TO_FOLDER[type];
      if (mapping)
      {
        const [objectName, memberName] = fullName.split(".");
        const candidate = path.join(root, "objects", objectName, mapping.folder, `${memberName}${mapping.suffix}`);
        if (await fs.pathExists(candidate))
        {
          matches.push({ absolutePath: candidate, root });
        }
      }
    }
  }

  if (!matches.length)
  {
    const fallbackName = fullName.split(".").pop() ?? fullName;
    for (const root of roots)
    {
      const files = glob.sync(`**/${fallbackName}.*`, {
        cwd: root,
        dot: true,
        nodir: true,
        absolute: true,
        nocase: WINDOWS,
        windowsPathsNoEscape: true
      }) as string[];

      for (const file of files)
      {
        matches.push({ absolutePath: file, root });
      }
    }
  }

  const seen = new Set<string>();
  return matches.filter((entry) =>
  {
    const key = entry.absolutePath.toLowerCase();
    if (seen.has(key))
    {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mapPackageTypes(manifestTypes: PackageTypeMembers[]): ManifestMetadata[]
{
  return manifestTypes.map((entry) =>
  ({
    type: entry.type,
    members: entry.members,
    hasWildcard: entry.members.some((member) => member === "*")
  }));
}

function componentKey(type: string, name: string): string
{
  return `${type}#${name}`.toLowerCase();
}

export async function runCompareApexClasses(uri?: vscode.Uri)
{
  const logger = new Logger("compareController", true);
  logger.info(localize('log.compareController.start', 'Starting metadata comparison...')); // Localized string

  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace)
  {
    vscode.window.showErrorMessage(localize('error.compareController.noWorkspace', 'No workspace is open.')); // Localized string
    logger.error(localize('log.compareController.noWorkspace', 'No active workspace detected.')); // Localized string
    return;
  }

  const baseDir = workspace.uri.fsPath;
  const settings = vscode.workspace.getConfiguration('UnifiedApexValidator');
  const repoDirConfigured = settings.get<string>('sfRepositoryDir')?.trim() || '';
  const repoDir = repoDirConfigured ? path.resolve(repoDirConfigured) : '';
  const outputDir = settings.get<string>('outputDir') || path.join(baseDir, 'output');

  logger.info(localize('log.compareController.workspacePath', 'Workspace: {0}', baseDir)); // Localized string
  logger.info(localize('log.compareController.repoPath', 'Configured repository: {0}', repoDir || '(not set)')); // Localized string
  logger.info(localize('log.compareController.outputPath', 'Output folder: {0}', outputDir)); // Localized string

  const localRoots = new Set<string>();
  if (repoDir)
  {
    localRoots.add(repoDir);
  }
  localRoots.add(baseDir);
  const localRootList = Array.from(localRoots);

  if (!uri)
  {
    vscode.window.showWarningMessage(localize('warning.compareController.selectSource', 'Open a package.xml or metadata file to compare.')); // Localized string
    logger.warn(localize('log.compareController.invalidSelection', 'Command executed without a valid manifest or metadata file.')); // Localized string
    return;
  }

  let manifestPath: string | undefined;
  let manifestEntries: ManifestMetadata[] = [];
  const adHocTargets: Array<{ metadataType: string; itemName: string }> = [];

  if (uri.fsPath.endsWith('.xml'))
  {
    manifestPath = uri.fsPath;
    logger.info(localize('log.compareController.analyzingPackageXml', 'Analyzing manifest: {0}', manifestPath)); // Localized string
    const manifestTypes = await parseMetadataTypesFromPackage(manifestPath);
    manifestEntries = mapPackageTypes(manifestTypes);

    if (!manifestEntries.length)
    {
      vscode.window.showWarningMessage(localize('warning.compareController.noMetadataFound', 'No metadata was found in the selected manifest.')); // Localized string
      logger.warn(localize('log.compareController.noMetadataFound', 'No metadata types were parsed from manifest.')); // Localized string
      return;
    }
  }
  else
  {
    const candidate = await findLocalCandidate(path.relative(baseDir, uri.fsPath), localRootList, logger);
    const inferred = inferMetadataFromRelativePath(path.relative(candidate?.root ?? baseDir, uri.fsPath));

    if (!inferred)
    {
      vscode.window.showErrorMessage(localize('error.compareController.cannotInferType', 'Could not infer metadata type for file {0}', uri.fsPath)); // Localized string
      logger.error(localize('log.compareController.cannotInferType', 'Unable to infer metadata type for {0}', uri.fsPath)); // Localized string
      return;
    }

    adHocTargets.push({ metadataType: inferred.type, itemName: inferred.fullName });
    manifestEntries = [{ type: inferred.type, members: [inferred.fullName], hasWildcard: false }];
  }

  logger.info(localize('log.compareController.listingOrgs', 'Listing Salesforce CLI connected orgs...')); // Localized string
  const { stdout: orgListJson } = await execa('sf', ['org', 'list', '--json'], {
    env: { ...process.env, FORCE_COLOR: '0' }
  });
  const orgList = JSON.parse(orgListJson).result.nonScratchOrgs
  .filter((o: any) => o.connectedStatus === 'Connected')
  .map((o: any) => o.alias || o.username);

  if (!orgList.length)
  {
    vscode.window.showErrorMessage(localize('error.compareController.noConnectedOrgs', 'No connected orgs found.')); // Localized string
    logger.error(localize('log.compareController.noConnectedOrgs', 'No connected orgs were found.')); // Localized string
    return;
  }

  const orgAlias = await vscode.window.showQuickPick(orgList, {
    placeHolder: localize('prompt.compareController.selectOrg', 'Select the organization to compare against') // Localized string
  });

  if (!orgAlias)
  {
    logger.warn(localize('log.compareController.orgSelectionCanceled', 'Comparison cancelled: no org was selected.')); // Localized string
    return;
  }

  const tempDir = path.join(getStorageRoot(), 'temp', 'compare');
  await fs.ensureDir(tempDir);
  await fs.emptyDir(tempDir);
  logger.info(localize('log.compareController.tempDirCreated', 'Temporary folder created: {0}', tempDir)); // Localized string

  const retrieveCmd = ['project', 'retrieve', 'start', '--target-org', orgAlias, '--output-dir', tempDir, '--json'];
  if (manifestPath)
  {
    retrieveCmd.push('--manifest', manifestPath);
  }
  else
  {
    for (const target of adHocTargets)
    {
      retrieveCmd.push('--metadata', `${target.metadataType}:${target.itemName}`);
    }
  }

  logger.info(localize('log.compareController.executeRetrieve', 'Running command: sf {0}', retrieveCmd.join(' '))); // Localized string

  let retrieveResult: any;
  try
  {
    const { stdout } = await execa('sf', retrieveCmd, {
      env: { ...process.env, FORCE_COLOR: '0' }
    });
    retrieveResult = JSON.parse(stdout);
    logger.info(localize('log.compareController.retrieveComplete', 'Retrieve completed ({0} files).', retrieveResult?.result?.files?.length || 0)); // Localized string
  }
  catch (err: any)
  {
    logger.error(localize('log.compareController.retrieveError', 'Error during retrieve: {0}', err.message)); // Localized string
    if (err.stdout) logger.error(localize('log.compareController.retrieveStdout', 'STDOUT: {0}', err.stdout)); // Localized string
    if (err.stderr) logger.error(localize('log.compareController.retrieveStderr', 'STDERR: {0}', err.stderr)); // Localized string
    vscode.window.showErrorMessage(localize('error.compareController.retrieveFailed', 'Error retrieving metadata: {0}', err.message)); // Localized string
    return;
  }

  const remoteFiles = collectRemoteFiles(tempDir);
  const metadataMaps = buildRetrieveMetadataMaps(retrieveResult);

  const statusLabels = {
    match: localize('compare.status.match', 'Match'),
    mismatch: localize('compare.status.mismatch', 'Mismatch'),
    onlyOrg: localize('compare.status.onlyOrg', 'Only in Org'),
    onlyLocal: localize('compare.status.onlyLocal', 'Only in Local'),
    missingBoth: localize('compare.status.missingBoth', 'Missing in both')
  };

  const results: ComparisonResult[] = [];
  const seenComponentKeys = new Set<string>();
  const matchedLocalPaths = new Set<string>();

  for (const remote of remoteFiles)
  {
    const info = matchMetadataInfoForPath(remote.relativePath, metadataMaps) || inferMetadataFromRelativePath(remote.relativePath) || { type: 'Unknown', fullName: remote.relativePath };
    const componentIdentifier = componentKey(info.type, info.fullName);
    seenComponentKeys.add(componentIdentifier);

    const localMatch = await findLocalCandidate(remote.relativePath, localRootList, logger);
    const localPath = localMatch?.absolutePath;
    const localExists = !!localPath && await fs.pathExists(localPath);
    const isBinary = isBinaryPath(remote.absolutePath);

    let statusKey: ComparisonStatusKey;
    let status = '';
    let differences: string | undefined;
    let localVersion: string | undefined;
    let salesforceVersion: string | undefined;

    if (localExists)
    {
      matchedLocalPaths.add(localPath!.toLowerCase());

      if (isBinary)
      {
        const diffResult = await binaryDifference(localPath, remote.absolutePath);
        if (diffResult.equal)
        {
          statusKey = 'match';
          status = statusLabels.match;
        }
        else
        {
          statusKey = 'mismatch';
          status = statusLabels.mismatch;
          differences = diffResult.message;
        }
      }
      else
      {
        const localContent = await fs.readFile(localPath!, 'utf8');
        const remoteContent = await fs.readFile(remote.absolutePath, 'utf8');
        localVersion = localContent;
        salesforceVersion = remoteContent;

        if (normalizeForComparison(localContent) === normalizeForComparison(remoteContent))
        {
          statusKey = 'match';
          status = statusLabels.match;
        }
        else
        {
          statusKey = 'mismatch';
          status = statusLabels.mismatch;
          differences = buildTextDiff(localContent, remoteContent);
        }
      }
    }
    else
    {
      statusKey = 'onlyOrg';
      status = statusLabels.onlyOrg;
      if (isBinary)
      {
        const diffResult = await binaryDifference(undefined, remote.absolutePath);
        differences = diffResult.message;
      }
      else
      {
        salesforceVersion = await fs.readFile(remote.absolutePath, 'utf8');
      }
    }

    results.push({
      metadataType: info.type,
      itemName: info.fullName,
      relativePath: remote.relativePath,
      status,
      statusKey,
      differences,
      localVersion,
      salesforceVersion,
      isBinary,
      localPath,
      remotePath: remote.absolutePath
    });
  }

  for (const manifestEntry of manifestEntries)
  {
    for (const member of manifestEntry.members)
    {
      if (member === '*')
      {
        continue;
      }

      const key = componentKey(manifestEntry.type, member);
      if (seenComponentKeys.has(key))
      {
        continue;
      }

      const localFiles = await resolveLocalFilesForComponent(manifestEntry.type, member, localRootList);

      if (!localFiles.length)
      {
        results.push({
          metadataType: manifestEntry.type,
          itemName: member,
          relativePath: '',
          status: statusLabels.missingBoth,
          statusKey: 'missingBoth'
        });
        continue;
      }

      for (const match of localFiles)
      {
        const normalized = match.absolutePath.toLowerCase();
        if (matchedLocalPaths.has(normalized))
        {
          continue;
        }
        matchedLocalPaths.add(normalized);

        const relativePath = normalizeMetadataPath(path.relative(match.root, match.absolutePath));
        const isBinary = isBinaryPath(match.absolutePath);
        const localVersion = isBinary ? undefined : await fs.readFile(match.absolutePath, 'utf8');

        results.push({
          metadataType: manifestEntry.type,
          itemName: member,
          relativePath,
          status: statusLabels.onlyLocal,
          statusKey: 'onlyLocal',
          localVersion,
          isBinary,
          localPath: match.absolutePath
        });
      }
    }
  }

  const sortedResults = results.sort((a, b) =>
  {
    const typeCompare = a.metadataType.localeCompare(b.metadataType);
    if (typeCompare !== 0) return typeCompare;
    const nameCompare = (a.itemName || '').localeCompare(b.itemName || '');
    if (nameCompare !== 0) return nameCompare;
    return a.relativePath.localeCompare(b.relativePath);
  });

  logger.info(localize('log.compareController.generatingHtmlReport', 'Generating comparison HTML report...')); // Localized string
  const htmlReport = await generateComparisonReport(outputDir, orgAlias, sortedResults);
  const htmlContent = await fs.readFile(htmlReport, 'utf8');

  const panelTitle = localize('ui.compareController.webviewTitle', 'Comparison - {0}', orgAlias); // Localized string
  const panel = vscode.window.createWebviewPanel(
    'uavComparisonReport',
    panelTitle,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = htmlContent;

  vscode.window.setStatusBarMessage(
    localize('status.compareController.reportLoaded', 'Report loaded in VS Code: {0}', path.basename(htmlReport)),
    5000
  ); // Localized string
  logger.info(localize('log.compareController.reportOpened', 'Report opened inside VS Code.')); // Localized string
}
