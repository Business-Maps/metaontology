/**
 * File Transport -. The
 * DataSource `endpoint` is a base directory URI (e.g. `file:///data`),
 * and each request's `path` is the relative file name.
 *
 * **Scope for Phase 9:**
 *  - JSON file reads (parse once, return the parsed content as `data`)
 *  - JSONL reads (parse each line, return as an array)
 *  - CSV reads (stringify parsed rows with header detection)
 *  - write = overwrite the file with `body` encoded as JSON
 *  - delete = unlink the file
 *  - list = return directory contents (no recursive walk)
 *
 * **Dependency injection:**
 *
 * The transport accepts an optional `fileSystem` callback - a minimal
 * interface with readFile / writeFile / unlink / readdir. Tests pass
 * an in-memory stub; production uses Node's `fs/promises` (or a
 * browser-compatible File System Access API wrapper).
 *
 * This indirection keeps the transport free of direct `fs` imports so
 * it can run in a browser bundle. The concrete Node implementation is
 * injected by the caller (Phase 10 Pipeline runtime will wire this up).
 */

import type {
  Transport,
  TransportRequest,
  TransportResponse,
  TransportDataSource,
} from './types'
import type { SecretValue } from '../secretStore'

export interface FileSystemLike {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  unlink(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
}

export interface FileTransportOptions {
  /** File system implementation - tests pass a stub. Required. */
  fileSystem: FileSystemLike
}

type Format = 'json' | 'jsonl' | 'csv' | 'unknown'

function inferFormat(path: string): Format {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl'
  if (lower.endsWith('.csv')) return 'csv'
  return 'unknown'
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length === 0) return []
  const headers = lines[0]!.split(',').map(h => h.trim())
  const rows: Array<Record<string, string>> = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',').map(c => c.trim())
    const row: Record<string, string> = {}
    headers.forEach((header, idx) => {
      row[header] = cells[idx] ?? ''
    })
    rows.push(row)
  }
  return rows
}

function parseJsonl(content: string): unknown[] {
  return content
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0)
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(v => v !== null)
}

function resolvePath(endpoint: string, path?: string): string {
  // Strip `file://` scheme if present and normalize trailing separator.
  const base = endpoint.replace(/^file:\/\//, '').replace(/\/$/, '')
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : ''
  return `${base}${suffix}`
}

export function createFileTransport(options: FileTransportOptions): Transport {
  const { fileSystem } = options

  async function execute<T = unknown>(
    request: TransportRequest,
    _credentials?: SecretValue | null,
  ): Promise<TransportResponse<T>> {
    const fullPath = resolvePath(request.dataSource.endpoint, request.path)

    try {
      switch (request.operation) {
        case 'read':
        case 'list': {
          // For read, we return the file contents; for list, we return
          // the directory contents if the path resolves to a directory.
          if (request.operation === 'list' && request.path === undefined) {
            // List the endpoint root
            const entries = await fileSystem.readdir(fullPath)
            return { success: true, data: entries as unknown as T }
          }

          const exists = await fileSystem.exists(fullPath)
          if (!exists) {
            return { success: false, statusCode: 404, error: `File not found: ${fullPath}` }
          }

          const content = await fileSystem.readFile(fullPath)
          const format = inferFormat(fullPath)
          let parsed: unknown
          switch (format) {
            case 'json':
              parsed = JSON.parse(content)
              break
            case 'jsonl':
              parsed = parseJsonl(content)
              break
            case 'csv':
              parsed = parseCsv(content)
              break
            default:
              parsed = content // return raw text for unknown formats
          }
          return { success: true, data: parsed as T }
        }

        case 'write': {
          const encoded = JSON.stringify(request.body, null, 2)
          await fileSystem.writeFile(fullPath, encoded)
          return { success: true, data: request.body as T }
        }

        case 'delete': {
          await fileSystem.unlink(fullPath)
          return { success: true }
        }
      }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  async function testConnection(dataSource: TransportDataSource) {
    try {
      const base = resolvePath(dataSource.endpoint, undefined)
      const exists = await fileSystem.exists(base)
      if (exists) return { success: true }
      return { success: false, error: `Base path "${base}" does not exist` }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  return {
    kind: 'file',
    execute,
    testConnection,
  }
}

/**
 * Create an in-memory file system for tests. Storage is a Map keyed by
 * absolute path; `exists` and `readdir` walk prefixes.
 */
export function createInMemoryFileSystem(seed: Record<string, string> = {}): FileSystemLike {
  const files = new Map<string, string>()
  for (const [path, content] of Object.entries(seed)) {
    files.set(path, content)
  }

  return {
    async readFile(path) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      return content
    },
    async writeFile(path, data) {
      files.set(path, data)
    },
    async unlink(path) {
      files.delete(path)
    },
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const entries = new Set<string>()
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const relative = key.slice(prefix.length)
          const first = relative.split('/')[0]!
          entries.add(first)
        }
      }
      return Array.from(entries).sort()
    },
    async exists(path) {
      if (files.has(path)) return true
      // Also return true for directory paths that prefix a file
      const prefix = path.endsWith('/') ? path : `${path}/`
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) return true
      }
      return false
    },
  }
}
