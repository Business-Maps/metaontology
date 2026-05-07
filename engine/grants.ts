/**
 * Grant evaluator — pure functions to resolve what capabilities a user has
 * by walking the Identity -> Grant -> grantedTo graph, including extends
 * (role hierarchy) and belongsTo (group membership) inheritance.
 *
 * No Vue, no async, no side effects. Receives a RootContext and a userId,
 * returns a resolved capability. Follows the same discipline as applyCommand.
 */

import type { RootContext, Facet, FacetContainer } from '../types/context'

// ── Identity URI helpers ──────────────────────────────────────────────────

const IDENTITY_PREFIX = 'bm:identity:'

export function toIdentityUri(authUserId: string): string {
  return `${IDENTITY_PREFIX}${authUserId}`
}

export function fromIdentityUri(identityUri: string): string | null {
  if (!identityUri.startsWith(IDENTITY_PREFIX)) return null
  return identityUri.slice(IDENTITY_PREFIX.length)
}

// ── Capability hierarchy ──────────────────────────────────────────────────

export type Capability = 'owner' | 'editor' | 'viewer'

const CAPABILITY_RANK: Record<Capability, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
}

function isCapability(value: unknown): value is Capability {
  return value === 'owner' || value === 'editor' || value === 'viewer'
}

function higherCapability(a: Capability, b: Capability): Capability {
  return CAPABILITY_RANK[a] >= CAPABILITY_RANK[b] ? a : b
}

// ── Grant resolution types ────────────────────────────────────────────────

export interface GrantEntry {
  grantUri: string
  capability: Capability
  scope: string
}

export interface ResolvedGrants {
  userId: string
  personaUri: string | null
  capability: Capability
  grants: GrantEntry[]
}

const NO_GRANTS: ResolvedGrants = {
  userId: '',
  personaUri: null,
  capability: 'viewer',
  grants: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────

function allContainers(root: RootContext): FacetContainer[] {
  return [root as FacetContainer, ...Object.values(root.contexts)]
}

/**
 * Find a BMIdentity persona by its authUserId attribute.
 * Scans all containers for any persona that has a matching authUserId.
 */
function findPersonaByUserId(root: RootContext, userId: string): Facet | null {
  const identityUri = toIdentityUri(userId)
  for (const container of allContainers(root)) {
    for (const persona of container.facets.personas) {
      // Match by identityUri attribute (primary) or by uri convention (fallback)
      const p = persona as unknown as Record<string, unknown>
      if (p.identityUri === identityUri || p.authUserId === userId) {
        return persona
      }
      // Also match by URI convention: persona:{userId}
      if (persona.uri === `persona:${userId}`) {
        return persona
      }
    }
  }
  return null
}

/**
 * Find a Thing by URI across all containers (used to locate Grant Things).
 */
function findThingByUri(root: RootContext, thingUri: string): Facet | null {
  for (const container of allContainers(root)) {
    const found = container.facets.things.find(t => t.uri === thingUri)
    if (found) return found
  }
  return null
}

// ── Core evaluator ────────────────────────────────────────────────────────

/**
 * Evaluate the effective grants for a userId by walking
 * Persona -> grantedTo <- Grant, plus extends and belongsTo inheritance.
 *
 * Pure, sync, no side effects.
 */
export function evaluateGrants(
  root: RootContext,
  userId: string,
): ResolvedGrants {
  if (!userId) return { ...NO_GRANTS, userId }

  const persona = findPersonaByUserId(root, userId)
  if (!persona) return { ...NO_GRANTS, userId }

  const visited = new Set<string>()
  const allGrants: GrantEntry[] = []

  function collectGrants(personaUri: string): void {
    if (visited.has(personaUri)) return // Circular guard
    visited.add(personaUri)

    // 1. Direct grants on this persona
    for (const link of root.links) {
      if ((link.predicate as string) === 'grantedTo' && link.targetUri === personaUri) {
        const grantThing = findThingByUri(root, link.sourceUri)
        if (grantThing) {
          const gt = grantThing as unknown as Record<string, unknown>
          const cap = gt.capability
          if (isCapability(cap)) {
            allGrants.push({
              grantUri: grantThing.uri,
              capability: cap,
              scope: (gt.scope as string) ?? '*',
            })
          }
        }
      }
    }

    // 2. Walk extends chain (role hierarchy)
    for (const link of root.links) {
      if ((link.predicate as string) === 'extends' && link.sourceUri === personaUri) {
        collectGrants(link.targetUri)
      }
    }

    // 3. Walk belongsTo links (group membership)
    for (const link of root.links) {
      if ((link.predicate as string) === 'belongsTo' && link.sourceUri === personaUri) {
        collectGrants(link.targetUri)
      }
    }
  }

  collectGrants(persona.uri)

  // Resolve highest capability across all collected grants
  let highest: Capability = 'viewer'
  for (const g of allGrants) {
    highest = higherCapability(highest, g.capability)
  }

  // If no grants found but persona exists, default to viewer (read access)
  return {
    userId,
    personaUri: persona.uri,
    capability: allGrants.length > 0 ? highest : 'viewer',
    grants: allGrants,
  }
}

/**
 * Check if a userId has at least the given capability level.
 * owner > editor > viewer.
 */
export function hasCapability(
  root: RootContext,
  userId: string,
  required: Capability,
): boolean {
  const resolved = evaluateGrants(root, userId)
  return CAPABILITY_RANK[resolved.capability] >= CAPABILITY_RANK[required]
}

/**
 * List all identities in the model with their resolved capabilities.
 * Used by WorkspaceSettings to display the collaborators list from the model.
 */
export function listIdentities(root: RootContext): ResolvedGrants[] {
  const results: ResolvedGrants[] = []
  const seen = new Set<string>()

  for (const container of allContainers(root)) {
    for (const persona of container.facets.personas) {
      const p = persona as unknown as Record<string, unknown>
      const userId = (p.authUserId as string) ?? fromIdentityUri((p.identityUri as string) ?? '')
      if (!userId || seen.has(userId)) continue
      seen.add(userId)
      results.push(evaluateGrants(root, userId))
    }
  }

  return results
}
