/**
 * Secret Store - all walk the model; the model holds only `credentialRef` strings;
 * therefore none of them can leak a secret. The regression test in
 * `secretsNeverSerialize.test.ts` makes that claim load-bearing.
 *
 * **Phase 7 implementation: in-memory.** Secrets live in a module-level
 * Map. Future phases will bind this interface to:
 *  - OS keychains (Keychain Access on macOS, libsecret on Linux)
 *  - Cloud secret managers (Google Secret Manager, AWS Secrets Manager,
 *    HashiCorp Vault)
 *  - Environment variables for local dev
 *
 * The interface stays the same - only the backend changes.
 *
 * **What this store DOES:**
 *  - Store secrets keyed by `credentialRef`
 *  - Resolve secrets at execution time (Pipeline runtime, DataSource
 *    connection test)
 *  - Track which refs have been accessed (for audit logging - Phase 11)
 *  - Provide an explicit `clear()` for tests
 *
 * **What this store DOES NOT:**
 *  - Participate in model serialization. Ever. The store exports no
 *    function that takes a RootContext. It cannot be accidentally
 *    included in JSON output because there's nothing to include.
 *  - Sync secrets across devices. Secrets are device-local. A map shared
 *    to another device carries the `credentialRef` strings; the
 *    receiving device must have its own secrets bound under the same
 *    refs (or prompt the user).
 *  - Export or back up secrets. Export is an explicit user action with
 *    its own security review, not a side effect of sync or save.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * The value stored for a given credentialRef. Opaque to the runtime -
 * the transport adapter (http, sql, etc.) interprets the shape it needs.
 * Typical shapes:
 *   { apiKey: 'sk_live_...' }
 *   { username: 'admin', password: '...' }
 *   { accessToken: '...', refreshToken: '...' }
 *   { clientId: '...', clientSecret: '...', authUrl: '...' }
 */
export type SecretValue = Record<string, string>

export interface SecretStore {
  /** Store a secret under a credentialRef. Overwrites any existing value. */
  set(credentialRef: string, value: SecretValue): void
  /** Retrieve a secret by credentialRef. Returns undefined if not bound. */
  get(credentialRef: string): SecretValue | undefined
  /** True if a credentialRef is bound. */
  has(credentialRef: string): boolean
  /** Unbind a single credentialRef. Returns true if something was removed. */
  delete(credentialRef: string): boolean
  /** List all currently bound credentialRefs (keys only, NEVER values). */
  listRefs(): string[]
  /** Clear all secrets. Test-only. */
  clear(): void
}

// ── Module-level singleton ─────────────────────────────────────────────────
//
// A single instance per JavaScript context (per tab). This matches the
// pattern used by useCommitLog, useSyncEngine, and useBmStore: the store
// is shared across all consumers in the same tab. Cross-tab isolation
// comes from module loading, not from per-call instantiation.

const _store = new Map<string, SecretValue>()

/**
 * Access the secret store singleton. Always returns the same instance.
 *
 * Callers: Pipeline runtime (Phase 10) and DataSource connection-test
 * handlers. Nothing else should read from this store - if a new caller
 * needs secrets, that's a design review.
 */
export function useSecretStore(): SecretStore {
  return {
    set(credentialRef, value) {
      if (!credentialRef) {
        throw new Error('SecretStore: credentialRef must be a non-empty string')
      }
      _store.set(credentialRef, value)
    },

    get(credentialRef) {
      return _store.get(credentialRef)
    },

    has(credentialRef) {
      return _store.has(credentialRef)
    },

    delete(credentialRef) {
      return _store.delete(credentialRef)
    },

    listRefs() {
      return Array.from(_store.keys())
    },

    clear() {
      _store.clear()
    },
  }
}

/** Test-only: force a clean store between tests. */
export function resetSecretStore(): void {
  _store.clear()
}
