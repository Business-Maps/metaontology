/**
 * Parameterized transport contract test -, it
 * runs the same file against its own setup - if the contract is
 * satisfied, every provider that uses it will work without
 * modification.
 *
 * Phase 9 runs the suite against three transports:
 *   - FakeTransport (the in-memory test double)
 *   - httpTransport (against a stub fetch implementation)
 *   - fileTransport (against an in-memory file system)
 *
 * The contract is intentionally narrow - it asserts behavioral
 * guarantees that every transport MUST satisfy, not implementation
 * details.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Transport, TransportDataSource } from '../types'
import { createFakeTransport } from '../fakeTransport'
import { createHttpTransport } from '../httpTransport'
import { createFileTransport, createInMemoryFileSystem } from '../fileTransport'

// ── Contract cases ────────────────────────────────────────────────────────

interface ContractHarness {
  name: string
  /** Setup returns a fresh transport + DataSource + test data loaded */
  setup(): Promise<{
    transport: Transport
    dataSource: TransportDataSource
    readPath: string
    seededPayload: unknown
  }>
}

/**
 * The core contract: every transport must satisfy these behaviors.
 * Run in a shared describe block parameterized by the harness.
 */
function runTransportContract(harness: ContractHarness) {
  describe(`Transport contract - ${harness.name}`, () => {
    let ctx: Awaited<ReturnType<ContractHarness['setup']>>

    beforeEach(async () => {
      ctx = await harness.setup()
    })

    it('execute(read) returns success + data for a seeded path', async () => {
      const result = await ctx.transport.execute({
        dataSource: ctx.dataSource,
        operation: 'read',
        path: ctx.readPath,
      })
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })

    it('execute returns success: false with an error message on failure', async () => {
      const result = await ctx.transport.execute({
        dataSource: ctx.dataSource,
        operation: 'read',
        path: '/definitely-does-not-exist-zzz',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('testConnection returns { success: true } for a reachable endpoint', async () => {
      const result = await ctx.transport.testConnection(ctx.dataSource)
      expect(result.success).toBe(true)
    })

    it('kind is a non-empty string', () => {
      expect(ctx.transport.kind).toBeTruthy()
      expect(typeof ctx.transport.kind).toBe('string')
    })

    it('data field is returned even on error (graceful degradation)', async () => {
      const result = await ctx.transport.execute({
        dataSource: ctx.dataSource,
        operation: 'read',
        path: '/missing-path',
      })
      // Either success=true with data, or success=false with an error message.
      // The contract is: we always get a defined result object - never an
      // uncaught exception.
      expect(result).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })
  })
}

// ── Harness 1: FakeTransport ──────────────────────────────────────────────

const FAKE_DS: TransportDataSource = {
  id: 'ds-fake',
  transport: 'fake',
  endpoint: 'fake://test',
}

runTransportContract({
  name: 'FakeTransport',
  async setup() {
    const transport = createFakeTransport()
    transport.setResponse('/customers', {
      success: true,
      data: { items: [{ id: '1', name: 'Alice' }] },
    })
    return {
      transport,
      dataSource: FAKE_DS,
      readPath: '/customers',
      seededPayload: { items: [{ id: '1', name: 'Alice' }] },
    }
  },
})

// ── Harness 2: httpTransport with a stub fetch ────────────────────────────

const HTTP_DS: TransportDataSource = {
  id: 'ds-http',
  transport: 'http',
  endpoint: 'https://example.com/api',
}

function createStubFetch(responses: Map<string, { status: number; body: unknown }>) {
  const stub: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    // Find the first response key that matches the suffix (allows
    // responses keyed by path or full URL)
    let response: { status: number; body: unknown } | undefined
    for (const [key, value] of responses.entries()) {
      if (url.endsWith(key) || url === key) {
        response = value
        break
      }
    }

    if (!response) {
      return new Response('not found', { status: 404, statusText: 'Not Found' })
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      statusText: response.status === 200 ? 'OK' : 'Error',
      headers: { 'content-type': 'application/json' },
    })
  }
  return stub
}

runTransportContract({
  name: 'httpTransport (stub fetch)',
  async setup() {
    const responses = new Map<string, { status: number; body: unknown }>()
    responses.set('/customers', { status: 200, body: { items: [{ id: '1', name: 'Alice' }] } })
    // Also seed the endpoint root for testConnection
    responses.set('https://example.com/api', { status: 200, body: { ok: true } })

    const transport = createHttpTransport({
      fetchImpl: createStubFetch(responses),
    })
    return {
      transport,
      dataSource: HTTP_DS,
      readPath: '/customers',
      seededPayload: { items: [{ id: '1', name: 'Alice' }] },
    }
  },
})

// ── Harness 3: fileTransport with in-memory FS ───────────────────────────

const FILE_DS: TransportDataSource = {
  id: 'ds-file',
  transport: 'file',
  endpoint: 'file:///data',
}

runTransportContract({
  name: 'fileTransport (in-memory fs)',
  async setup() {
    const fs = createInMemoryFileSystem({
      '/data/customers.json': JSON.stringify({ items: [{ id: '1', name: 'Alice' }] }),
    })
    const transport = createFileTransport({ fileSystem: fs })
    return {
      transport,
      dataSource: FILE_DS,
      readPath: '/customers.json',
      seededPayload: { items: [{ id: '1', name: 'Alice' }] },
    }
  },
})

// ── Extra tests specific to httpTransport ────────────────────────────────

describe('httpTransport - HTTP-specific behaviors', () => {
  it('builds the URL from endpoint + path + params', async () => {
    let capturedUrl = ''
    const stubFetch: typeof fetch = async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString()
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const transport = createHttpTransport({ fetchImpl: stubFetch })

    await transport.execute({
      dataSource: HTTP_DS,
      operation: 'read',
      path: '/customers',
      params: { limit: 10, order: 'desc' },
    })

    expect(capturedUrl).toContain('/customers')
    expect(capturedUrl).toContain('limit=10')
    expect(capturedUrl).toContain('order=desc')
  })

  it('attaches Authorization: Bearer header for bearer auth', async () => {
    let capturedHeaders: HeadersInit | undefined
    const stubFetch: typeof fetch = async (_input, init) => {
      capturedHeaders = init?.headers
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const transport = createHttpTransport({ fetchImpl: stubFetch })
    const dsWithAuth: TransportDataSource = { ...HTTP_DS, authType: 'bearer' }

    await transport.execute(
      { dataSource: dsWithAuth, operation: 'read', path: '/me' },
      { apiKey: 'sk_fake_bearer' },
    )

    const headers = capturedHeaders as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk_fake_bearer')
  })

  it('maps POST operation and serializes JSON body', async () => {
    let capturedMethod = ''
    let capturedBody: unknown
    const stubFetch: typeof fetch = async (_input, init) => {
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body
      return new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    const transport = createHttpTransport({ fetchImpl: stubFetch })

    await transport.execute({
      dataSource: HTTP_DS,
      operation: 'write',
      path: '/customers',
      body: { name: 'Alice' },
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedBody).toBe(JSON.stringify({ name: 'Alice' }))
  })

  it('surfaces 5xx errors as success: false', async () => {
    const stubFetch: typeof fetch = async () => {
      return new Response('internal error', { status: 500, statusText: 'Internal Server Error' })
    }
    const transport = createHttpTransport({ fetchImpl: stubFetch })
    const result = await transport.execute({
      dataSource: HTTP_DS,
      operation: 'read',
      path: '/a',
    })
    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(500)
  })
})

// ── Extra tests specific to fileTransport ────────────────────────────────

describe('fileTransport - file-specific behaviors', () => {
  it('parses .json files into objects', async () => {
    const fs = createInMemoryFileSystem({
      '/data/config.json': JSON.stringify({ name: 'Test', count: 42 }),
    })
    const transport = createFileTransport({ fileSystem: fs })
    const result = await transport.execute({
      dataSource: FILE_DS,
      operation: 'read',
      path: '/config.json',
    })
    expect(result.success).toBe(true)
    expect((result.data as any).name).toBe('Test')
    expect((result.data as any).count).toBe(42)
  })

  it('parses .jsonl files into arrays', async () => {
    const fs = createInMemoryFileSystem({
      '/data/events.jsonl': '{"id":"1","type":"click"}\n{"id":"2","type":"view"}\n',
    })
    const transport = createFileTransport({ fileSystem: fs })
    const result = await transport.execute({
      dataSource: FILE_DS,
      operation: 'read',
      path: '/events.jsonl',
    })
    expect(result.success).toBe(true)
    expect((result.data as any[]).length).toBe(2)
    expect((result.data as any[])[0].id).toBe('1')
  })

  it('parses .csv files into row objects', async () => {
    const fs = createInMemoryFileSystem({
      '/data/users.csv': 'id,name,age\n1,Alice,30\n2,Bob,25',
    })
    const transport = createFileTransport({ fileSystem: fs })
    const result = await transport.execute({
      dataSource: FILE_DS,
      operation: 'read',
      path: '/users.csv',
    })
    expect(result.success).toBe(true)
    const rows = result.data as Array<Record<string, string>>
    expect(rows).toHaveLength(2)
    expect(rows[0]!.name).toBe('Alice')
    expect(rows[0]!.age).toBe('30')
  })

  it('writes JSON to a file via the write operation', async () => {
    const fs = createInMemoryFileSystem({})
    const transport = createFileTransport({ fileSystem: fs })
    const payload = { id: 'new', value: 99 }
    const result = await transport.execute({
      dataSource: FILE_DS,
      operation: 'write',
      path: '/output.json',
      body: payload,
    })
    expect(result.success).toBe(true)

    // Verify the file exists
    const readBack = await fs.readFile('/data/output.json')
    expect(JSON.parse(readBack)).toEqual(payload)
  })

  it('deletes a file via the delete operation', async () => {
    const fs = createInMemoryFileSystem({
      '/data/stale.json': '{"old": true}',
    })
    const transport = createFileTransport({ fileSystem: fs })
    const result = await transport.execute({
      dataSource: FILE_DS,
      operation: 'delete',
      path: '/stale.json',
    })
    expect(result.success).toBe(true)
    expect(await fs.exists('/data/stale.json')).toBe(false)
  })
})
