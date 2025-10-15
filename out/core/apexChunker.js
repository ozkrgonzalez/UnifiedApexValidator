"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApexChunker = void 0;
class ApexChunker {
    static split(doc) {
        const text = doc.getText();
        const chunks = [];
        // 1️⃣ Header de clase (línea de class + apertura)
        const classMatch = text.match(/(public|global|private|protected)?\s*(with|without)?\s*sharing\s*class\s+([A-Za-z_]\w*)[^{]*\{/);
        if (classMatch) {
            const idx = classMatch.index ?? 0;
            const headerEnd = text.indexOf('{', idx) + 1;
            chunks.push({
                kind: 'classHeader',
                name: classMatch[3] || 'UnknownClass',
                start: idx,
                end: headerEnd,
                text: text.substring(idx, headerEnd),
                signature: (classMatch[0] || '').trim()
            });
        }
        // 2️⃣ Campos a nivel de clase (sin entrar a métodos)
        const fieldRegex = /(?<=\n|\r|^)\s*(public|global|private|protected)\s+(static\s+)?[A-Za-z_<>\[\]]+\s+[A-Za-z_]\w*\s*(=\s*[^;]+)?;/g;
        let m;
        while ((m = fieldRegex.exec(text)) !== null) {
            chunks.push({
                kind: 'field',
                name: 'field',
                start: m.index,
                end: m.index + m[0].length,
                text: m[0],
                signature: m[0].trim()
            });
        }
        // 3️⃣ Constructores
        if (classMatch) {
            const className = classMatch[3];
            const ctorRegex = new RegExp(`\\b${className}\\s*\\([^)]*\\)\\s*\\{`, 'g');
            let c;
            while ((c = ctorRegex.exec(text)) !== null) {
                const start = c.index;
                const bodyStart = text.indexOf('{', start);
                const end = ApexChunker.findBlockEnd(text, bodyStart);
                chunks.push({
                    kind: 'constructor',
                    name: className,
                    start,
                    end,
                    text: text.substring(start, end),
                    signature: text.substring(start, bodyStart).trim()
                });
            }
        }
        // 4️⃣ Métodos
        const methodRegex = /(?<!\/\/[^\n]*)(?<!\/\*[\s\S]*?\*\/)\s*@?[A-Za-z_]*\s*(public|global|private|protected)\s+(static\s+)?[A-Za-z_<>\[\]]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g;
        let mm;
        while ((mm = methodRegex.exec(text)) !== null) {
            const start = mm.index;
            const bodyStart = text.indexOf('{', start);
            if (bodyStart === -1) {
                console.warn(`[ApexChunker] Warning: no '{' found for method ${mm[3]}`);
                continue;
            }
            const end = ApexChunker.findBlockEnd(text, bodyStart);
            chunks.push({
                kind: 'method',
                name: mm[3],
                start,
                end,
                text: text.substring(start, end),
                signature: text.substring(start, bodyStart).trim()
            });
        }
        // 5️⃣ Inner classes (todas las visibilidades)
        const innerRegex = /(public|global|private|protected)?\s*class\s+([A-Za-z_]\w*)[^{]*\{/g;
        let ic;
        while ((ic = innerRegex.exec(text)) !== null) {
            const start = ic.index;
            const bodyStart = text.indexOf('{', start);
            if (bodyStart === -1) {
                console.warn(`[ApexChunker] Warning: no '{' found for inner class ${ic[2]}`);
                continue;
            }
            const end = ApexChunker.findBlockEnd(text, bodyStart);
            chunks.push({
                kind: 'innerClass',
                name: ic[2],
                start,
                end,
                text: text.substring(start, end),
                signature: text.substring(start, bodyStart).trim()
            });
        }
        // 🧹 Orden estable
        chunks.sort((a, b) => a.start - b.start);
        // 🧩 Filtra duplicados o fragmentos anidados erróneos
        const filtered = [];
        for (const ch of chunks) {
            const isNested = chunks.some(o => o !== ch && o.start < ch.start && o.end > ch.end);
            if (!isNested) {
                filtered.push(ch);
            }
        }
        return filtered;
    }
    static findBlockEnd(src, bracePos) {
        if (bracePos === -1) {
            console.warn('[ApexChunker] Warning: no opening brace found.');
            return src.length;
        }
        let depth = 0;
        for (let i = bracePos; i < src.length; i++) {
            const ch = src[i];
            if (ch === '{')
                depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0)
                    return i + 1;
            }
        }
        return src.length;
    }
}
exports.ApexChunker = ApexChunker;
