/**
 * The API keys of the central credential store (`system.credentials.*`, type `ai`).
 *
 * The store holds the secrets of the whole system - a database password, the login of a camera - so
 * only an entry stored as an AI credential is ever handed out here. With a subscription the keys are
 * kept in memory and follow every edit in the credential manager without a restart of the adapter.
 */
import type { Credentials as CredentialsApi } from '@iobroker/adapter-core';

type CredentialsModule = typeof CredentialsApi;

let credentialsModule: CredentialsModule | null | undefined;

/**
 * The credential API of `@iobroker/adapter-core`, loaded on first use. Loading adapter-core looks for
 * the js-controller and throws without one - which must not keep the rest of this package (providers,
 * settings, the tool loop) from being used, e.g. in tests or tools
 */
function api(): CredentialsModule | null {
    if (credentialsModule === undefined) {
        try {
            credentialsModule =
                (require('@iobroker/adapter-core') as { Credentials?: CredentialsModule }).Credentials || null;
        } catch {
            credentialsModule = null;
        }
    }
    return credentialsModule;
}

/** One selectable AI credential - id and name, never the secret */
export interface AiCredentialEntry {
    id: string;
    name: string;
}

/** The key out of a credential, or `''` when it is none of type `ai` */
function keyOf(info: { type?: string; values?: Record<string, unknown> } | null | undefined): string {
    if (info?.type !== 'ai') {
        return '';
    }
    // the `key` form is the normal one for an API key, `login` (password) the fallback
    const values = info.values || {};
    const key = values.key ?? values.password;
    return typeof key === 'string' ? key.trim() : '';
}

/** Reads AI keys from the credential store and keeps the subscribed ones fresh */
export class AiCredentialStore {
    private readonly cache = new Map<string, string>();
    private unsubscribers: (() => Promise<void>)[] = [];

    constructor(private readonly adapter: ioBroker.Adapter) {}

    /** Whether the running js-controller has a credential store (7.2 and newer) */
    static isSupported(): boolean {
        return !!api()?.getCredentials;
    }

    /** All AI credentials, for a selection in the GUI */
    async list(): Promise<AiCredentialEntry[]> {
        const credentials = api();
        if (!credentials?.listCredentials) {
            return [];
        }
        const list = await credentials.listCredentials(this.adapter, 'ai');
        return list.map(entry => ({ id: entry.id, name: entry.name }));
    }

    /**
     * The decrypted key of an entry. `''` (and a warning in the log) when the entry does not exist, is
     * not an AI credential, or the controller has no credential store
     *
     * @param id full id, e.g. `system.credentials.anthropic`
     */
    async getKey(id: string): Promise<string> {
        id = (id || '').trim();
        if (!id) {
            return '';
        }
        const cached = this.cache.get(id);
        if (cached !== undefined) {
            return cached;
        }
        if (!AiCredentialStore.isSupported()) {
            this.adapter.log.warn(`Cannot read AI credential "${id}": js-controller 7.2 or newer is required`);
            return '';
        }
        try {
            const info = await api()!.getCredentials(this.adapter, id);
            if (info?.type !== 'ai') {
                this.adapter.log.warn(`Cannot read AI credential "${id}": it is not an AI credential`);
                return '';
            }
            return keyOf(info);
        } catch (e) {
            this.adapter.log.warn(`Cannot read AI credential "${id}": ${e instanceof Error ? e.message : String(e)}`);
            return '';
        }
    }

    /**
     * Keep these entries in memory and follow their changes. Replaces an earlier subscription
     *
     * @param ids the credential ids the configuration names
     */
    async subscribe(ids: string[]): Promise<void> {
        await this.unsubscribe();
        const unique = [...new Set(ids.map(id => (id || '').trim()).filter(id => id))];
        if (!unique.length) {
            return;
        }
        const credentials = api();
        if (!credentials?.subscribeCredentials) {
            this.adapter.log.warn('Cannot subscribe AI credentials: js-controller 7.2 or newer is required');
            return;
        }
        for (const id of unique) {
            try {
                const unsubscribe = await credentials.subscribeCredentials(this.adapter, id, (changedId, info) => {
                    if (info) {
                        // a changed entry is checked like a read one - it may have become another type
                        this.cache.set(changedId, keyOf(info));
                        this.adapter.log.debug(`AI credential "${changedId}" updated`);
                    } else {
                        this.cache.delete(changedId);
                        this.adapter.log.debug(`AI credential "${changedId}" was deleted`);
                    }
                });
                this.unsubscribers.push(unsubscribe);
                // the handler only fires on later changes
                this.cache.delete(id);
                this.cache.set(id, await this.getKey(id));
            } catch (e) {
                this.adapter.log.warn(
                    `Cannot subscribe to AI credential "${id}": ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
    }

    /** End all subscriptions and forget the keys */
    async unsubscribe(): Promise<void> {
        const unsubscribers = this.unsubscribers;
        this.unsubscribers = [];
        this.cache.clear();
        for (const unsubscribe of unsubscribers) {
            try {
                await unsubscribe();
            } catch (e) {
                this.adapter.log.warn(
                    `Cannot unsubscribe from AI credential: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
    }
}
