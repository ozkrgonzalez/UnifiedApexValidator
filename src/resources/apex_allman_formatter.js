const fs = require('fs');
const path = require('path');

// This function now only replaces tabs with spaces.
function normalizeIndentation(text, spacesPerTab = 4) {
    const spaces = ' '.repeat(spacesPerTab);
    return text.replace(/\t/g, spaces);
}

function applyAllmanStyle(filePath) {
    let code = fs.readFileSync(filePath, 'utf8');
    
    // Normalize line endings and tabs
    code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    code = normalizeIndentation(code);

    const lines = code.split('\n');
    const result = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i]; // Use let to allow modification

        // Step 1: Check for lines with content after a closing brace, like '} else {'
        if (line.trim().startsWith('}')) {
            const match = line.match(/^(\s*)\}(.*)/);
            if (match) {
                const restOfLine = match[2].trim();
                if (restOfLine !== '') {
                    const indent = match[1];
                    // Push the closing brace on its own line
                    result.push(`${indent}}`);
                    // The rest of the line becomes the new line to process
                    line = `${indent}${restOfLine}`;
                }
            }
        }

        // Step 2: Process the (potentially modified) line for a trailing opening brace
        const trimmedLine = line.trim();
        const braceIndex = line.lastIndexOf('{');

        if (braceIndex > -1 && trimmedLine.endsWith('{') && line.substring(0, braceIndex).trim() !== '') {
            const contentBeforeBrace = line.substring(0, braceIndex);
            const indentMatch = line.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '';

            const nextLine = lines[i + 1]?.trim();
            if (nextLine === '{') {
                result.push(line);
                continue;
            }

            result.push(contentBeforeBrace.trimEnd());
            result.push(`${indent}{`);
        } else {
            result.push(line);
        }
    }

    // Join lines and clean up excessive blank lines.
    const formatted = result.join('\n').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(filePath, formatted + '\n', 'utf8');
    console.log(`✔ Allman style applied: ${path.basename(filePath)}`);
}

function processPath(target) {
    try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
            for (const f of fs.readdirSync(target)) {
                processPath(path.join(target, f));
            }
        } else if (target.endsWith('.cls') || target.endsWith('.trigger')) { // Also format triggers
            applyAllmanStyle(target);
        }
    } catch (error) {
        console.error(`❌ Error processing path ${target}: ${error.message}`);
    }
}

const targetPath = process.argv[2];
if (!targetPath) {
    console.error('❌ Debes especificar un archivo o carpeta.');
    process.exit(1);
}

processPath(path.resolve(targetPath));
