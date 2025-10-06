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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.parseApexClassesFromPackage = parseApexClassesFromPackage;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const fast_xml_parser_1 = require("fast-xml-parser");
class Logger {
    logPath;
    constructor(prefix) {
        const logDir = path.join(process.cwd(), '.apex-validator', 'log');
        if (!fs.existsSync(logDir))
            fs.mkdirSync(logDir, { recursive: true });
        this.logPath = path.join(logDir, `${prefix}.log`);
    }
    write(level, msg) {
        const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
        fs.appendFileSync(this.logPath, line);
        console.log(line.trim());
    }
    info(msg) { this.write('INFO', msg); }
    error(msg) { this.write('ERROR', msg); }
    warn(msg) { this.write('WARN', msg); }
}
exports.Logger = Logger;
/**
 * Lee un package.xml y devuelve las clases test y no-test encontradas.
 */
async function parseApexClassesFromPackage(pkgPath, repoDir) {
    const xml = await fs.readFile(pkgPath, 'utf8');
    const parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false });
    const json = parser.parse(xml);
    const types = json?.Package?.types || [];
    const apexTypes = Array.isArray(types)
        ? types.find((t) => t.name === 'ApexClass')
        : types.name === 'ApexClass'
            ? types
            : null;
    if (!apexTypes) {
        throw new Error('No se encontraron clases Apex en package.xml');
    }
    const members = Array.isArray(apexTypes.members) ? apexTypes.members : [apexTypes.members];
    const testClasses = [];
    const nonTestClasses = [];
    for (const cls of members) {
        const clsPath = path.join(repoDir, `${cls}.cls`);
        if (!fs.existsSync(clsPath))
            continue;
        const content = await fs.readFile(clsPath, 'utf8');
        if (/@istest/i.test(content)) {
            testClasses.push(cls);
        }
        else {
            nonTestClasses.push(cls);
        }
    }
    return { testClasses, nonTestClasses };
}
