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
export declare class AiConnectionError extends Error {
}
/**
 * Why a connection failed, readable. When a host has several addresses (`localhost` = `::1` and
 * `127.0.0.1`), Node tries them all and throws an `AggregateError` with an empty message; the reason is
 * then only in its `errors` and `code`
 *
 * @param e what `http.request` emitted
 * @param url where the request went
 */
export declare function describeConnectionError(e: Error, url: URL): string;
/**
 * Send the request and collect the answer. Rejects only when no answer came at all - an HTTP error
 * status is an answer and resolves
 *
 * @param request what to send where
 */
export declare function aiHttpRequest(request: AiHttpRequest): Promise<AiHttpResponse>;
