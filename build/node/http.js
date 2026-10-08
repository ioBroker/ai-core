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
exports.AiConnectionError = void 0;
exports.aiHttpRequest = aiHttpRequest;
/**
 * One HTTP request with a JSON answer, over `node:http`/`node:https`.
 *
 * Not `fetch`: Node's `fetch` cannot be told to accept a self-signed certificate without an extra
 * dependency, and a local endpoint (Ollama behind a reverse proxy, LM Studio) often has one.
 */
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
/** An error that a user can read: the connection failed or timed out */
class AiConnectionError extends Error {
}
exports.AiConnectionError = AiConnectionError;
/**
 * Send the request and collect the answer. Rejects only when no answer came at all - an HTTP error
 * status is an answer and resolves
 *
 * @param request what to send where
 */
function aiHttpRequest(request) {
    let parsedUrl;
    try {
        parsedUrl = new URL(request.url);
    }
    catch {
        return Promise.reject(new AiConnectionError(`Invalid API URL: ${request.url}`));
    }
    const isHttps = parsedUrl.protocol === 'https:';
    if (!isHttps && parsedUrl.protocol !== 'http:') {
        return Promise.reject(new AiConnectionError(`Invalid API URL: ${request.url}`));
    }
    const payload = request.body === undefined ? undefined : Buffer.from(JSON.stringify(request.body), 'utf8');
    const headers = { ...request.headers };
    if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
    }
    return new Promise((resolve, reject) => {
        const options = {
            method: request.method,
            headers,
            timeout: request.timeoutMs,
            ...(isHttps && request.allowSelfSignedCerts ? { rejectUnauthorized: false } : {}),
        };
        const req = (isHttps ? https : http).request(parsedUrl, options, res => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
            res.on('error', (e) => reject(new AiConnectionError(`Connection failed: ${e.message}`)));
        });
        req.on('error', (e) => reject(new AiConnectionError(`Connection failed: ${e.message}`)));
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
//# sourceMappingURL=http.js.map