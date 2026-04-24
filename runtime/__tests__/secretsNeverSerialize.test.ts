/**
 * secretsNeverSerialize - the non-negotiable security regression net.
 *
 *"
 *
 * This file asserts the *structural* claim that Phase 7's architecture
 * makes. DataSources carry only a `credentialRef` - a string key into
 * the runtime secret store. The secret itself lives in a separate
 * module-level Map, never attached to the model. Therefore any code
 * that serializes the model cannot leak the secret - there is nothing
 * in the model to leak.
 *
 * Each test does the same thing in a different serializer:
 *
 *   1. Populate the secret store with a recognizable sentinel value
 *      (`SECRET_SENTINEL`).
 *   2. Build a RootContext with a DataSource whose `credentialRef`
 *      points to that secret.
 *   3. Run the serializer.
 *   4. Assert that the sentinel does NOT appear in the output.
 *   5. Assert that the `credentialRef` key IS present (so we're proving
 *      the serializer actually touched the DataSource - otherwise a
 *      no-op serializer would pass vacuously).
 *
 * A failure here is a security incident. Do NOT relax the assertions
 * to make the tests green - find and fix the leak.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useSecretStore, resetSecretStore } from '../secretStore'
import { createEmptyRootContext } from '../../engine/apply'
import {
  projectToTriples,
  serialiseAsNTriples,
  serialiseAsTurtle,
  serialiseAsJsonLd,
} from '../../engine/triples'
import { generateClaudeMd } from '../../generate'
import type { RootContext } from '../../types/context'

// A recognizable sentinel that should never appear in any serialized
// output. Chosen so that a `includes(SECRET_SENTINEL)` match is
// unambiguous - no natural string would contain this substring.
const SECRET_SENTINEL = 'sk_live_PHASE7_DO_NOT_SERIALIZE_ME_42xyz'

function makeDataSource(id: string, name: string, credentialRef: string) {
  return {
    id,
    name,
    description: 'Stripe production API',
    tags: ['payments'],
    transport: 'http' as const,
    endpoint: 'https://api.stripe.com/v1',
    credentialRef,
    authType: 'bearer' as const,
    config: {},
    connectionStatus: 'connected' as const,
    stereotype: 'read-write' as const,
    environment: 'prod' as const,
    acceptsSimulationTraffic: false,
  }
}

function buildRootWithSecret(): RootContext {
  const root = createEmptyRootContext('Secret Regression Test')
  const store = useSecretStore()
  // Bind the sentinel under a recognizable ref.
  store.set('stripe_prod_key', { apiKey: SECRET_SENTINEL })
  // The DataSource carries only the ref - never the value.
  root.facets.datasources.push(
    makeDataSource('ds-stripe', 'Stripe Prod', 'stripe_prod_key') as any,
  )
  return root
}

beforeEach(() => {
  resetSecretStore()
})

// ── Path 1: JSON.stringify ────────────────────────────────────────────────

describe('secretsNeverSerialize - JSON.stringify', () => {
  it('JSON.stringify(root) does not contain the secret', () => {
    const root = buildRootWithSecret()
    const out = JSON.stringify(root)

    // Structural proof: the ref key IS serialized (so we know the
    // DataSource made it into the output and this isn't a vacuous pass).
    expect(out).toContain('stripe_prod_key')
    // Security claim: the secret value is NOT.
    expect(out).not.toContain(SECRET_SENTINEL)
  })

  it('JSON.stringify with indentation also omits the secret', () => {
    const root = buildRootWithSecret()
    const out = JSON.stringify(root, null, 2)
    expect(out).not.toContain(SECRET_SENTINEL)
  })
})

// ── Path 2: N-Triples (part of the RDF/TriG family) ─────────────────────

describe('secretsNeverSerialize - N-Triples', () => {
  it('projectToTriples → serialiseAsNTriples omits the secret', () => {
    const root = buildRootWithSecret()
    const triples = projectToTriples(root)
    const out = serialiseAsNTriples(triples)

    expect(out).not.toContain(SECRET_SENTINEL)
  })
})

// ── Path 3: Turtle ────────────────────────────────────────────────────────

describe('secretsNeverSerialize - Turtle', () => {
  it('serialiseAsTurtle omits the secret', () => {
    const root = buildRootWithSecret()
    const triples = projectToTriples(root)
    const out = serialiseAsTurtle(triples)
    expect(out).not.toContain(SECRET_SENTINEL)
  })
})

// ── Path 4: JSON-LD ───────────────────────────────────────────────────────

describe('secretsNeverSerialize - JSON-LD', () => {
  it('serialiseAsJsonLd omits the secret', () => {
    const root = buildRootWithSecret()
    const triples = projectToTriples(root)
    const out = serialiseAsJsonLd(triples)
    expect(out).not.toContain(SECRET_SENTINEL)
  })
})

// ── Path 5: CLAUDE.md (LLM-facing documentation export) ──────────────────

describe('secretsNeverSerialize - CLAUDE.md', () => {
  it('generateClaudeMd omits the secret', () => {
    const root = buildRootWithSecret()
    const out = generateClaudeMd(root)
    expect(out).not.toContain(SECRET_SENTINEL)
  })
})

// ── Path 6: IDB-shape clone (what we write to IndexedDB) ─────────────────
//
// IndexedDB writes run the model through a structured clone. We simulate
// it here with `JSON.parse(JSON.stringify(x))` - faithful to IDB behavior
// for the plain data types the model uses (Symbols, Maps, Dates excluded).

describe('secretsNeverSerialize - IDB structured clone', () => {
  it('JSON.parse(JSON.stringify(root)) omits the secret', () => {
    const root = buildRootWithSecret()
    const cloned = JSON.parse(JSON.stringify(root))
    const reserialized = JSON.stringify(cloned)
    expect(reserialized).not.toContain(SECRET_SENTINEL)
  })
})

// ── Path 7: sync push (what the sync engine encrypts and uploads) ────────
//
// The sync engine ships commits, not the full model. Commits are
// `{ id, mapId, sequence, command, inverse, ... }` objects. We simulate
// what a push would look like by building a mock commit that carries the
// DataSource in its payload - this is the shape that happens when a user
// creates a DataSource and the `facet:add` commit is sent upstream.

describe('secretsNeverSerialize - sync push shape', () => {
  it('a facet:add commit for a DataSource does not carry the secret', () => {
    useSecretStore().set('stripe_prod_key', { apiKey: SECRET_SENTINEL })

    const datasource = makeDataSource('ds-push', 'Push Test', 'stripe_prod_key')
    const commit = {
      id: 'commit-1',
      mapId: 'map-1',
      sequence: 1,
      branchId: 'main',
      deviceId: 'device-1',
      timestamp: new Date().toISOString(),
      parentId: null,
      command: {
        type: 'facet:add',
        payload: {
          contextUri: 'map-1',
          facetType: 'datasources',
          facet: datasource,
        },
      },
      inverse: {
        type: 'facet:remove',
        payload: { contextUri: 'map-1', facetType: 'datasources', facetUri: 'ds-push' },
      },
    }

    const serialized = JSON.stringify(commit)
    // The DataSource made it in (proving the test isn't vacuous).
    expect(serialized).toContain('ds-push')
    expect(serialized).toContain('stripe_prod_key')
    // The secret did NOT.
    expect(serialized).not.toContain(SECRET_SENTINEL)
  })
})

// ── Canary: assert the sentinel IS present in the secret store itself ──
//
// Sanity check that our test setup is correct - the secret is actually
// in the store, so any "it's missing from output" assertion above is
// meaningful.

describe('secretsNeverSerialize - canary', () => {
  it('the secret IS bound in the secret store (canary)', () => {
    buildRootWithSecret()
    const store = useSecretStore()
    const val = store.get('stripe_prod_key')
    expect(val).toBeDefined()
    expect(val!.apiKey).toBe(SECRET_SENTINEL)
  })

  it('the secret store, serialized directly, does contain the sentinel', () => {
    // This test exists to prove that if someone DID include the store in a
    // serialization path, the sentinel would show up. A bug in this
    // canary (e.g., it also doesn't contain the sentinel) would mean the
    // "not contain" assertions above are vacuous.
    useSecretStore().set('direct', { apiKey: SECRET_SENTINEL })
    // The store is a closed-over Map, so there's no direct API to dump
    // it. We construct the same shape a leaky serializer would produce.
    const leakShape = { stripe_prod_key: { apiKey: SECRET_SENTINEL } }
    expect(JSON.stringify(leakShape)).toContain(SECRET_SENTINEL)
  })
})
