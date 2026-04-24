import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from './registry'

/**
 * Run all pending schema migrations on a model, then stamp the current version.
 *
 * Documents without `schemaVersion` are treated as version 0 (pre-migration era).
 * Each migration runs only if the document's version is below the migration's version.
 * After all pending migrations, `schemaVersion` is set to CURRENT_SCHEMA_VERSION.
 *
 * Safe to call on any model - already-current models skip all migrations.
 */
export function migrateModel(model: any): void {
  const docVersion = model.schemaVersion ?? 0
  if (docVersion >= CURRENT_SCHEMA_VERSION) return

  for (const migration of MIGRATIONS) {
    if (migration.version > docVersion) {
      migration.migrate(model)
    }
  }
  model.schemaVersion = CURRENT_SCHEMA_VERSION
}
