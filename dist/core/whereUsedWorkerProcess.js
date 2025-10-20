"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const whereUsedCore_1 = require("./whereUsedCore");
const workerLogger = {
    info: (message) => process.stdout.write(`[WhereIsUsedWorker] ${message}\n`),
    warn: (message) => process.stderr.write(`[WhereIsUsedWorker] ${message}\n`)
};
process.on('message', async (payload) => {
    try {
        const result = await (0, whereUsedCore_1.analyzeWhereUsedCore)({
            repoDir: payload.repoDir,
            classIdentifiers: payload.classIdentifiers,
            logger: workerLogger
        });
        sendResponse({
            type: 'result',
            result
        });
        process.exit(0);
    }
    catch (err) {
        sendResponse({
            type: 'error',
            message: err?.message || String(err),
            stack: err?.stack
        });
        process.exit(1);
    }
});
function sendResponse(response) {
    if (process.send) {
        process.send(response);
    }
}
process.on('uncaughtException', (err) => {
    sendResponse({
        type: 'error',
        message: err?.message || String(err),
        stack: err?.stack
    });
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    sendResponse({
        type: 'error',
        message: reason?.message || String(reason),
        stack: reason?.stack
    });
    process.exit(1);
});
