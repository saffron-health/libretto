/*
 * TOC search powered by Orama — full-text, typo-tolerant, in-memory.
 * Reference: https://www.mintlify.com/oramasearch/orama/quickstart.md
 *
 * Operates directly on FlatTocItem[] — no intermediate SearchEntry type.
 * Each flat item already carries parentId for deriving which groups to
 * expand and which items to dim. Scales to thousands
 * of entries — Orama searches in ~20us, derive pass is O(n).
 */

import { create, insertMultiple, search, type AnyOrama } from '@orama/orama'
import type { FlatTocItem } from './markdown'

const tocSchema = {
  id: 'string',
  title: 'string',
  href: 'string',
} as const

/** Create and populate an Orama DB from flat TOC items. Synchronous. */
export function createTocDb({ items }: { items: FlatTocItem[] }): AnyOrama {
  const db = create({ schema: tocSchema })
  /* insertMultiple is sync with default components. We cast away the union
     return type since we know no async components are configured. */
  insertMultiple(db, items.map((item) => {
    return { id: item.id, title: item.label, href: item.href }
  })) as string[]
  return db
}

export type SearchState = {
  /** Set of item ids that matched the query. null = no active search. */
  matchedIds: Set<string> | null
  /** Set of parent ids to force-expand. null = no override. */
  expandOverrideIds: Set<string> | null
  /** Set of item ids to dim (opacity 0.3). null = no dimming. */
  dimmedIds: Set<string> | null
  /** Ordered list of item ids focusable via arrow keys. null = all focusable. */
  focusableIds: string[] | null
}

const emptySearchState: SearchState = {
  matchedIds: null,
  expandOverrideIds: null,
  dimmedIds: null,
  focusableIds: null,
}

/** Search the TOC DB. Returns null matchedIds when query is empty (show all).
 *  Walks up the parentId chain to expand all ancestors of matched items. */
export function searchToc({ db, query, items }: {
  db: AnyOrama
  query: string
  items: FlatTocItem[]
}): SearchState {
  const trimmed = query.trim()
  if (!trimmed) {
    return emptySearchState
  }

  const results = search(db, {
    term: trimmed,
    properties: ['title'],
    tolerance: 1,
    limit: items.length,
  }) as { hits: Array<{ id: string; score: number; document: { id: string; title: string; href: string } }> }

  if (results.hits.length === 0) {
    return {
      matchedIds: new Set(),
      expandOverrideIds: new Set(),
      dimmedIds: new Set(items.map((i) => { return i.id })),
      focusableIds: [],
    }
  }

  const itemById = new Map(items.map((i) => { return [i.id, i] as const }))

  const matchedIds = new Set(results.hits.map((hit) => { return hit.document.id }))
  const expandOverrideIds = new Set<string>()

  for (const item of items) {
    if (matchedIds.has(item.id)) {
      /* Walk up the parent chain to expand all ancestors */
      let current: FlatTocItem | undefined = item
      while (current?.parentId) {
        expandOverrideIds.add(current.parentId)
        current = itemById.get(current.parentId)
      }
      /* If the matched item itself has children, expand it too */
      expandOverrideIds.add(item.id)
    }
  }

  const dimmedIds = new Set(
    items
      .filter((i) => { return !matchedIds.has(i.id) })
      .map((i) => { return i.id }),
  )

  /* Focusable in document order — only matched items */
  const focusableIds = items
    .filter((i) => { return matchedIds.has(i.id) })
    .map((i) => { return i.id })

  return { matchedIds, expandOverrideIds, dimmedIds, focusableIds }
}
