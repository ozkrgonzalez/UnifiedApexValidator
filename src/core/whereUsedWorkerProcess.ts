import { analyzeWhereUsedCore, TraceLogger, WhereUsedEntry } from './whereUsedCore';

interface WorkerRequest
{
    repoDir: string;
    classIdentifiers: string[];
}

interface WorkerResponse
{
    type: 'result' | 'error';
    result?: WhereUsedEntry[];
    message?: string;
    stack?: string;
}

const workerLogger: TraceLogger = {
    info: (message: string) => process.stdout.write(`[WhereIsUsedWorker] ${message}\n`),
    warn: (message: string) => process.stderr.write(`[WhereIsUsedWorker] ${message}\n`)
};

process.on('message', async (payload: WorkerRequest) =>
{
    try
    {
        const result = await analyzeWhereUsedCore({
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
    catch (err: any)
    {
        sendResponse({
            type: 'error',
            message: err?.message || String(err),
            stack: err?.stack
        });
        process.exit(1);
    }
});

function sendResponse(response: WorkerResponse): void
{
    if (process.send)
    {
        process.send(response);
    }
}

process.on('uncaughtException', (err: any) =>
{
    sendResponse({
        type: 'error',
        message: err?.message || String(err),
        stack: err?.stack
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason: any) =>
{
    sendResponse({
        type: 'error',
        message: reason?.message || String(reason),
        stack: reason?.stack
    });
    process.exit(1);
});

