import { describe, it, expect, beforeEach } from 'vitest'
import { useSecretStore, resetSecretStore } from '../secretStore'

beforeEach(() => {
  resetSecretStore()
})

describe('secretStore - basic CRUD', () => {
  it('set stores a secret under a credentialRef', () => {
    const store = useSecretStore()
    store.set('stripe_sk', { apiKey: 'sk_live_fake_12345' })
    expect(store.has('stripe_sk')).toBe(true)
  })

  it('get retrieves a stored secret', () => {
    const store = useSecretStore()
    store.set('shopify', { apiKey: 'sa_fake', accessToken: 'at_fake' })
    expect(store.get('shopify')).toEqual({ apiKey: 'sa_fake', accessToken: 'at_fake' })
  })

  it('get returns undefined for an unbound credentialRef', () => {
    const store = useSecretStore()
    expect(store.get('never-set')).toBeUndefined()
    expect(store.has('never-set')).toBe(false)
  })

  it('set overwrites an existing credentialRef', () => {
    const store = useSecretStore()
    store.set('api', { apiKey: 'old' })
    store.set('api', { apiKey: 'new' })
    expect(store.get('api')?.apiKey).toBe('new')
  })

  it('delete unbinds a credentialRef', () => {
    const store = useSecretStore()
    store.set('temp', { apiKey: 'temp-secret' })
    const removed = store.delete('temp')
    expect(removed).toBe(true)
    expect(store.has('temp')).toBe(false)
  })

  it('delete returns false for an unbound credentialRef', () => {
    const store = useSecretStore()
    expect(store.delete('never-existed')).toBe(false)
  })

  it('rejects empty credentialRef on set', () => {
    const store = useSecretStore()
    expect(() => store.set('', { apiKey: 'x' })).toThrow(/non-empty/)
  })
})

describe('secretStore - listRefs', () => {
  it('returns an empty array when nothing is stored', () => {
    const store = useSecretStore()
    expect(store.listRefs()).toEqual([])
  })

  it('returns all bound credentialRefs', () => {
    const store = useSecretStore()
    store.set('stripe', { apiKey: 's' })
    store.set('shopify', { apiKey: 'sh' })
    store.set('postgres', { username: 'u', password: 'p' })

    const refs = store.listRefs().sort()
    expect(refs).toEqual(['postgres', 'shopify', 'stripe'])
  })

  it('listRefs MUST NOT include the secret values', () => {
    const store = useSecretStore()
    store.set('stripe', { apiKey: 'sk_live_fake_should_never_be_in_a_list' })

    const refs = store.listRefs()
    // The ref is a key, not a value. A bug that accidentally returned
    // the secret values would include the literal string.
    for (const ref of refs) {
      expect(ref).not.toContain('sk_live_fake_should_never_be_in_a_list')
    }
    expect(JSON.stringify(refs)).not.toContain('sk_live_fake_should_never_be_in_a_list')
  })
})

describe('secretStore - singleton identity', () => {
  it('useSecretStore returns a stable singleton across calls', () => {
    const a = useSecretStore()
    a.set('persist', { apiKey: 'x' })
    // A second call to useSecretStore sees the same backing store.
    const b = useSecretStore()
    expect(b.get('persist')?.apiKey).toBe('x')
  })

  it('resetSecretStore clears between tests', () => {
    const store = useSecretStore()
    store.set('before', { apiKey: 'x' })
    resetSecretStore()
    expect(store.has('before')).toBe(false)
  })
})
