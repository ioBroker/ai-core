/**
 * One HTTP request with a JSON answer, over `node:http`/`node:https`.
 *
 * Not `fetch`: Node's `fetch` cannot be told to accept a self-signed certificate without an extra
 * dependency, and a local endpoint (Ollama behind a reverse proxy, LM Studio) often has one.
 */
import * as http from 'node:http';
import * as https from 'node:https';

export interface AiHttpResponse {
    status: number;
    /** The body as text */
    body: string;
}

export interface AiHttpRequest {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    /** Sent as JSON */
    body?: unknown;
    timeoutMs: number;
    /** Accept a self-signed certificate. Only ever for an endpoint of one's own */
    allowSelfSignedCerts?: boolean;
}

/** An error that a user can read: the connection failed or timed out */
export class AiConnectionError extends Error {}

/**
 * Why a connection failed, readable. When a host has several addresses (`localhost` = `::1` and
 * `127.0.0.1`), Node tries them all and throws an `AggregateError` with an empty message; the reason is
 * then only in its `errors` and `code`
 *
 * @param e what `http.request` emitted
 * @param url where the request went
 */
export function describeConnectionError(e: Error, url: URL): string {
    const nested = (e as Error & { errors?: unknown }).errors;
    if (Array.isArray(nested)) {
        const messages = nested.map(n => (n instanceof Error ? n.message : String(n))).filter(Boolean);
        if (messages.length) {
            return [...new Set(messages)].join('; ');
        }
    }
    const code = (e as NodeJS.ErrnoException).code;
    return e.message || `${code || 'unknown error'} (${url.host})`;
}

/**
 * Send the request and collect the answer. Rejects only when no answer came at all - an HTTP error
 * status is an answer and resolves
 *
 * @param request what to send where
 */
export function aiHttpRequest(request: AiHttpRequest): Promise<AiHttpResponse> {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(request.url);
    } catch {
        return Promise.reject(new AiConnectionError(`Invalid API URL: ${request.url}`));
    }
    const isHttps = parsedUrl.protocol === 'https:';
    if (!isHttps && parsedUrl.protocol !== 'http:') {
        return Promise.reject(new AiConnectionError(`Invalid API URL: ${request.url}`));
    }

    const payload = request.body === undefined ? undefined : Buffer.from(JSON.stringify(request.body), 'utf8');
    const headers: Record<string, string | number> = { ...request.headers };
    if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
    }

    return new Promise((resolve, reject) => {
        const options: https.RequestOptions = {
            method: request.method,
            headers,
            timeout: request.timeoutMs,
            ...(isHttps && request.allowSelfSignedCerts ? { rejectUnauthorized: false } : {}),
        };
        const req = (isHttps ? https : http).request(parsedUrl, options, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
            res.on('error', (e: Error) =>
                reject(new AiConnectionError(`Connection failed: ${describeConnectionError(e, parsedUrl)}`)),
            );
        });
        req.on('error', (e: Error) =>
            reject(new AiConnectionError(`Connection failed: ${describeConnectionError(e, parsedUrl)}`)),
        );
        req.on('timeout', () => {
            req.destroy();
            reject(new AiConnectionError(`Connection timeout (${Math.round(request.timeoutMs / 1000)}s)`));
        });
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}
