const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const distResourcesDir = path.join(distDir, 'resources');
const distCoreDir = path.join(distDir, 'core');
const srcResourcesDir = path.join(projectRoot, 'src', 'resources');
const outCoreDir = path.join(projectRoot, 'out', 'core');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function copyRecursive(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) {
        return;
    }

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
            ensureDir(destPath);
            copyRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function copyWhereUsedCoreFiles() {
    if (!fs.existsSync(outCoreDir)) {
        console.warn('[copyResources] skipping copy from out/core (directory not found)');
        return;
    }

    const files = fs.readdirSync(outCoreDir).filter((name) => name.startsWith('whereUsed') && name.endsWith('.js'));
    if (!files.length) {
        console.warn('[copyResources] no whereUsed*.js files found in out/core');
        return;
    }

    for (const file of files) {
        const srcPath = path.join(outCoreDir, file);
        const destPath = path.join(distCoreDir, file);
        fs.copyFileSync(srcPath, destPath);
    }
}

ensureDir(distDir);
ensureDir(distResourcesDir);
ensureDir(distCoreDir);

copyRecursive(srcResourcesDir, distResourcesDir);
copyWhereUsedCoreFiles();
