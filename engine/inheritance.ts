/**
 * Inheritance resolution for the `extends` predicate.
 * When Thing B extends Thing A, B inherits A's attributes.
 * Circular chains are detected and rejected.
 */
import type { RootContext, Thing, ThingAttribute, InheritedAttributes } from '../types/context'

/**
 * Resolve all attributes for a Thing, including inherited ones via `extends` links.
 *
 * Rules:
 * - Own attributes always take precedence over inherited ones (by attribute name).
 * - Multiple levels of inheritance are supported (A extends B extends C).
 * - Circular chains are detected and truncated (the `circular` flag is set).
 * - Only Thing->Thing extends links are followed.
 */
export function resolveInheritedAttributes(root: Readonly<RootContext>, thingId: string): InheritedAttributes {
  // Find the Thing
  const thing = findThing(root, thingId)
  if (!thing) {
    return { own: [], inherited: [], all: [], chain: [], circular: false }
  }

  const own = thing.attributes ?? []
  const ownNames = new Set(own.map(a => a.name))
  const inherited: InheritedAttributes['inherited'] = []
  const chain: InheritedAttributes['chain'] = []
  const visited = new Set<string>([thingId])
  let circular = false

  // Walk the extends chain
  let currentId = thingId
  while (true) {
    // Find extends link from current thing
    const extendsLink = root.links.find(
      l => l.predicate === 'extends' && l.sourceUri === currentId,
    )
    if (!extendsLink) break

    const parentId = extendsLink.targetUri

    // Circular detection
    if (visited.has(parentId)) {
      circular = true
      break
    }
    visited.add(parentId)

    const parent = findThing(root, parentId)
    if (!parent) break

    chain.push({ uri: parent.uri, name: parent.name })

    // Inherit attributes that aren't overridden
    for (const attr of parent.attributes ?? []) {
      if (!ownNames.has(attr.name) && !inherited.some(a => a.name === attr.name)) {
        inherited.push({
          ...attr,
          inheritedFrom: parent.uri,
          inheritedFromName: parent.name,
        })
      }
    }

    currentId = parentId
  }

  // Combined: own first, then inherited (own overrides by name)
  const all: ThingAttribute[] = [...own, ...inherited]

  return { own, inherited, all, chain, circular }
}

/**
 * Get the direct parent Thing ID via `extends` link, or null.
 */
export function getExtendsParent(root: Readonly<RootContext>, thingId: string): string | null {
  const link = root.links.find(
    l => l.predicate === 'extends' && l.sourceUri === thingId,
  )
  return link?.targetUri ?? null
}

/**
 * Get all Things that directly extend the given Thing.
 */
export function getExtendsChildren(root: Readonly<RootContext>, thingId: string): string[] {
  return root.links
    .filter(l => l.predicate === 'extends' && l.targetUri === thingId)
    .map(l => l.sourceUri)
}

/**
 * Detect circular extends chains in the entire model.
 * Returns an array of Thing IDs that participate in cycles.
 */
export function detectCircularExtends(root: Readonly<RootContext>): string[] {
  const extendsLinks = root.links.filter(l => l.predicate === 'extends')
  const parentMap = new Map<string, string>()
  for (const l of extendsLinks) {
    parentMap.set(l.sourceUri, l.targetUri)
  }

  const circular: string[] = []
  for (const startId of parentMap.keys()) {
    const visited = new Set<string>()
    let current: string | undefined = startId
    while (current && !visited.has(current)) {
      visited.add(current)
      current = parentMap.get(current)
    }
    if (current && visited.has(current)) {
      // Found a cycle - collect all participants
      let c: string | undefined = current
      do {
        if (c && !circular.includes(c)) circular.push(c)
        c = parentMap.get(c!)
      } while (c && c !== current)
    }
  }

  return circular
}

/** Find a Thing by ID across root and all contexts. */
function findThing(root: Readonly<RootContext>, id: string): Thing | null {
  for (const t of root.facets.things) {
    if (t.uri === id) return t
  }
  for (const ctx of Object.values(root.contexts)) {
    for (const t of ctx.facets.things) {
      if (t.uri === id) return t
    }
  }
  return null
}
