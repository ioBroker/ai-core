/** One selectable AI credential - id and name, never the secret */
export interface AiCredentialEntry {
    id: string;
    name: string;
}
/** Reads AI keys from the credential store and keeps the subscribed ones fresh */
export declare class AiCredentialStore {
    private readonly adapter;
    private readonly cache;
    private unsubscribers;
    constructor(adapter: ioBroker.Adapter);
    /** Whether the running js-controller has a credential store (7.2 and newer) */
    static isSupported(): boolean;
    /** All AI credentials, for a selection in the GUI */
    list(): Promise<AiCredentialEntry[]>;
    /**
     * The decrypted key of an entry. `''` (and a warning in the log) when the entry does not exist, is
     * not an AI credential, or the controller has no credential store
     *
     * @param id full id, e.g. `system.credentials.anthropic`
     */
    getKey(id: string): Promise<string>;
    /**
     * Keep these entries in memory and follow their changes. Replaces an earlier subscription
     *
     * @param ids the credential ids the configuration names
     */
    subscribe(ids: string[]): Promise<void>;
    /** End all subscriptions and forget the keys */
    unsubscribe(): Promise<void>;
}
