import { nanoid } from 'nanoid'
import { migrateAttributeType } from '../meta/ontology'
import { FACET_TYPES } from '../meta/facets'
import { parseStringToDoc } from '../content/parseStringToDoc'

/**
 * A versioned schema migration. Runs on any model whose schemaVersion
 * is lower than this migration's version number.
 */
export interface Migration {
  version: number
  description: string
  migrate: (model: any) => void
}

/**
 * Ordered list of all client schema migrations.
 *
 * Each migration mutates the model in place. Migrations are idempotent -
 * running one on a model that already has the target structure is a no-op.
 * New migrations append here; old ones are never removed.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Ensure symbols[] on all containers; normalize attribute types; ensure facet arrays and top-level fields',
    migrate(model) {
      // 1. Ensure symbols[] on all containers (unified from ideas+inscriptions)
      if (!model.symbols) model.symbols = []
      for (const ctx of Object.values(model.contexts ?? {})) {
        if (!(ctx as any).symbols) (ctx as any).symbols = []
      }

      // 2. Ensure facets and facet arrays on all containers
      const ensureFacets = (c: any) => {
        if (!c.facets || typeof c.facets !== 'object') c.facets = {}
        for (const ft of FACET_TYPES) {
          if (!Array.isArray(c.facets[ft])) c.facets[ft] = []
        }
      }
      ensureFacets(model)
      for (const ctx of Object.values(model.contexts ?? {})) ensureFacets(ctx)

      // 3. Migrate legacy attribute types (number→decimal, other→text)
      const migrateAttrs = (c: any) => {
        for (const thing of c.facets?.things ?? []) {
          for (const attr of thing.attributes ?? []) {
            attr.type = migrateAttributeType(attr.type)
          }
        }
      }
      migrateAttrs(model)
      for (const ctx of Object.values(model.contexts ?? {})) migrateAttrs(ctx)

      // 4. Ensure top-level fields
      if (!Array.isArray(model.links)) model.links = []
      if (!model.contexts || typeof model.contexts !== 'object') model.contexts = {}
      if (!model.meta) model.meta = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    },
  },
  {
    version: 2,
    description: 'Collapse removed SymbolMode values (doc, code) to card; cards now grow vertically to fit content',
    migrate(model) {
      const normalizeSymbols = (syms: any[] | undefined) => {
        if (!Array.isArray(syms)) return
        for (const s of syms) {
          if (s && (s.mode === 'doc' || s.mode === 'code')) s.mode = 'card'
        }
      }
      normalizeSymbols(model.symbols)
      for (const ctx of Object.values(model.contexts ?? {})) {
        normalizeSymbols((ctx as any).symbols)
      }
    },
  },
  {
    version: 3,
    description: 'Populate Symbol.contentDoc from legacy `content` string on every symbol that lacks one. Lossless: preserves every mention, every line break, every piece of prose. Runs idempotently — symbols that already have contentDoc are skipped.',
    migrate(model) {
      const upgradeSymbols = (syms: any[] | undefined) => {
        if (!Array.isArray(syms)) return
        for (const s of syms) {
          if (!s) continue
          // Already upgraded — leave it. Idempotency means running the
          // migration twice (e.g. on a model that was partially
          // processed elsewhere) is a no-op.
          if (s.contentDoc && typeof s.contentDoc === 'object') continue
          // Defensive: legacy `content` might be missing or non-string
          // on unusually shaped data. Treat anything else as empty.
          const content = typeof s.content === 'string' ? s.content : ''
          s.contentDoc = parseStringToDoc(content)
        }
      }
      upgradeSymbols(model.symbols)
      for (const ctx of Object.values(model.contexts ?? {})) {
        upgradeSymbols((ctx as any).symbols)
      }
    },
  },
  {
    version: 4,
    description: 'Promote single Symbol.attachment / Interface.media to attachments[] (with stable attachmentId), and stamp metadata.attachmentId on existing annotation links so dots stay anchored to the screenshot they were drawn on.',
    migrate(model) {
      // Index of source-entity-uri → first attachmentId, used to backfill
      // annotation link metadata. Built as we lift attachments so that the
      // mapping reflects the post-migration shape.
      const sourceToAttachmentId = new Map<string, string>()

      const liftSymbol = (s: any) => {
        if (!s) return
        if (Array.isArray(s.attachments)) {
          // Already migrated. Index for backfill if anything is present.
          const aid = s.attachments[0]?.attachmentId
          if (s.uri && aid) sourceToAttachmentId.set(s.uri, aid)
          return
        }
        if (s.attachment) {
          const attachmentId = nanoid()
          s.attachments = [{ ...s.attachment, attachmentId }]
          delete s.attachment
          if (s.uri) sourceToAttachmentId.set(s.uri, attachmentId)
        }
      }

      const liftInterface = (iface: any) => {
        if (!iface) return
        if (Array.isArray(iface.attachments)) {
          const aid = iface.attachments[0]?.attachmentId
          if (iface.uri && aid) sourceToAttachmentId.set(iface.uri, aid)
          return
        }
        if (iface.media) {
          const attachmentId = nanoid()
          iface.attachments = [{ ...iface.media, attachmentId }]
          delete iface.media
          if (iface.uri) sourceToAttachmentId.set(iface.uri, attachmentId)
        }
      }

      const liftContainer = (c: any) => {
        for (const s of c?.symbols ?? []) liftSymbol(s)
        for (const iface of c?.facets?.interfaces ?? []) liftInterface(iface)
      }

      liftContainer(model)
      for (const ctx of Object.values(model.contexts ?? {})) liftContainer(ctx)

      // Backfill annotation links. Pre-migration, each Symbol/Interface had
      // at most one attachment, so the mapping is unambiguous: every
      // annotation sourced from an entity points at that entity's only
      // attachment. Idempotent — links that already carry an attachmentId
      // are left alone.
      for (const link of model.links ?? []) {
        if (link?.predicate !== 'annotates') continue
        if (link.metadata?.attachmentId) continue
        const aid = sourceToAttachmentId.get(link.sourceUri)
        if (!aid) continue
        if (!link.metadata) link.metadata = {}
        link.metadata.attachmentId = aid
      }
    },
  },
]

/** The current schema version - equals the number of migrations. */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length
