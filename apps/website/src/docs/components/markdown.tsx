"use client";
/*
 * Editorial markdown components.
 *
 * All components use CSS variables from globals.css (no prefix).
 * Conflicting names with shadcn: --brand-primary, --brand-secondary,
 * --link-accent, --page-border.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createTocDb, searchToc, type SearchState } from "./search";
import type {
  TocNodeType,
  VisualLevel,
  TocTreeNode,
  FlatTocItem,
} from "./toc-tree";

export type { TocNodeType, VisualLevel, TocTreeNode, FlatTocItem };
import Prism from "prismjs";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";

/* Custom "diagram" language for ASCII/Unicode box-drawing diagrams.
   Tokenizes box-drawing chars as neutral structure, text as highlighted labels. */
Prism.languages.diagram = {
  "box-drawing": /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬╭╮╯╰┊┈╌┄╶╴╵╷]+/,
  "line-char": /[-_|<>]+/,
  label: /[^\s┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬╭╮╯╰┊┈╌┄╶╴╵╷\-_|<>]+/,
};

/* =========================================================================
   Typography primitives — reduced set after merging near-identical values.
   4 weights (regular/prose/heading/bold), 2 line-heights (heading/prose).
   Mirrors CSS variables in globals.css. Used in inline styles for type safety.
   ========================================================================= */

const WEIGHT = { regular: 400, prose: 475, heading: 560, bold: 700 } as const;
const ACTIVE_SECTION_PROBE_OFFSET = 60;
type ManualExpansionMode = "open" | "closed";

function getHrefFragment(href: string): string {
  return href.includes("#") ? href.slice(href.indexOf("#")) : href;
}

function getTargetIdFromHref(href: string): string {
  return getHrefFragment(href).replace(/^#/, "");
}

function isPlainAnchorNavigationClick(
  event: React.MouseEvent<HTMLAnchorElement>,
) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

function ChevronIcon({
  expanded,
  style,
}: {
  expanded: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "12px",
        height: "12px",
        cursor: "pointer",
        ...style,
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="12"
        height="12"
        style={{
          transition: "transform 0.15s ease",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        }}
      >
        <path
          d="M6 4l4 4-4 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/* =========================================================================
   TOC sidebar (fixed left)
   ========================================================================= */

export type HeadingLevel = 1 | 2 | 3;

/* Multi-page TOC tree types. Pages are root nodes that contain headings or
   nested sub-pages. The recursive tree is flattened to FlatTocItem[] before
   rendering, clamping visual depth to 4 levels (0-3) so the sidebar never
   gets too wide regardless of page nesting depth. */

/* TocNodeType, VisualLevel, TocTreeNode, FlatTocItem — defined in toc-tree.ts,
   re-exported above for backward compatibility. */

const headingTagByLevel: Record<HeadingLevel, "h1" | "h2" | "h3"> = {
  1: "h1",
  2: "h2",
  3: "h3",
};

type PendingNavigation = {
  itemId: string;
  targetId: string;
};

function getHeaderHeight(): number {
  const root = document.querySelector<HTMLElement>(".docs-root");
  const headerHeight = root
    ? Number.parseFloat(
        getComputedStyle(root).getPropertyValue("--header-height"),
      )
    : 0;
  return Number.isFinite(headerHeight) ? headerHeight : 0;
}

function isNavigationInterruptKey(event: KeyboardEvent): boolean {
  return [
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
  ].includes(event.key);
}

/* flattenTocTree and helpers moved to toc-tree.ts (server-safe, no 'use client'). */

/** Single useSyncExternalStore that handles both initial hash and scroll-based
 *  active heading tracking. Server snapshot returns fallbackId to avoid
 *  hydration mismatch. Hash is read inside subscribe (not during render) to
 *  keep render pure. All callbacks are stable via useCallback. */
function useActiveTocId({ fallbackId }: { fallbackId: string }) {
  const activeRef = useRef(fallbackId);
  const lastScrollYRef = useRef(0);
  const scrollDirectionRef = useRef<"up" | "down">("down");

  const subscribe = useCallback((onStoreChange: () => void) => {
    const emit = (next: string) => {
      if (activeRef.current === next) {
        return;
      }
      activeRef.current = next;
      onStoreChange();
    };

    // Read hash on first subscribe to fix flash on initial paint
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      emit(hash);
    }

    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('[data-toc-heading="true"][id]'),
    );
    let rafId = 0;
    lastScrollYRef.current = window.scrollY;

    const computeActive = () => {
      if (headings.length === 0) {
        return;
      }

      const safeHeaderHeight = getHeaderHeight();
      const viewportTop = window.scrollY + safeHeaderHeight;
      const viewportBottom = window.scrollY + window.innerHeight;

      const sections = headings.map((heading, index) => {
        const top = window.scrollY + heading.getBoundingClientRect().top;
        const nextHeading = headings[index + 1];
        const bottom = nextHeading
          ? window.scrollY + nextHeading.getBoundingClientRect().top
          : document.documentElement.scrollHeight;
        const anchor = top + ACTIVE_SECTION_PROBE_OFFSET;

        return { id: heading.id, top, bottom, anchor };
      });

      const firstSection = sections[0];
      if (firstSection && viewportTop <= firstSection.anchor) {
        emit(firstSection.id);
        return;
      }

      const visibleSections = sections.filter((section) => {
        return (
          section.anchor >= viewportTop && section.anchor <= viewportBottom
        );
      });

      if (visibleSections.length > 0) {
        emit(visibleSections[visibleSections.length - 1].id);
        return;
      }

      if (scrollDirectionRef.current === "up") {
        const nextVisibleFromBottom = sections.find((section) => {
          return section.anchor > viewportBottom;
        });

        if (nextVisibleFromBottom) {
          emit(nextVisibleFromBottom.id);
          return;
        }

        emit(sections[sections.length - 1].id);
        return;
      }

      const passedSections = sections.filter((section) => {
        return section.anchor < viewportTop;
      });

      if (passedSections.length > 0) {
        emit(passedSections[passedSections.length - 1].id);
        return;
      }

      emit(sections[0].id);
    };

    const scheduleCompute = () => {
      if (rafId !== 0) {
        return;
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        computeActive();
      });
    };

    const handleScroll = () => {
      const nextScrollY = window.scrollY;

      if (nextScrollY > lastScrollYRef.current) {
        scrollDirectionRef.current = "down";
      } else if (nextScrollY < lastScrollYRef.current) {
        scrollDirectionRef.current = "up";
      }

      lastScrollYRef.current = nextScrollY;
      scheduleCompute();
    };

    const handleHistoryNavigation = () => {
      const nextHash = window.location.hash.replace(/^#/, "");
      if (nextHash) {
        emit(nextHash);
      }
      scheduleCompute();
    };

    computeActive();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", scheduleCompute);
    window.addEventListener("hashchange", handleHistoryNavigation);
    window.addEventListener("popstate", handleHistoryNavigation);

    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", scheduleCompute);
      window.removeEventListener("hashchange", handleHistoryNavigation);
      window.removeEventListener("popstate", handleHistoryNavigation);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    return activeRef.current;
  }, []);

  const getServerSnapshot = useCallback(() => {
    return fallbackId;
  }, [fallbackId]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function TocLink({
  item,
  isActive,
  chevron,
  onToggle,
  onNavigate,
  dimmed,
  isMatched,
  isHighlighted,
  linkRef,
}: {
  item: FlatTocItem;
  isActive: boolean;
  chevron?: { expanded: boolean; lockedOpen?: boolean };
  onToggle?: () => void;
  onNavigate?: (item: FlatTocItem, link: HTMLAnchorElement) => void;
  /** Search: dim non-matching items to opacity 0.3 */
  dimmed?: boolean;
  /** Search: item matched the query */
  isMatched?: boolean;
  /** Search: arrow-key highlighted item */
  isHighlighted?: boolean;
  linkRef?: React.Ref<HTMLAnchorElement>;
}) {
  const effectiveActive = isActive && !dimmed;
  const defaultColor = effectiveActive
    ? "var(--text-primary)"
    : dimmed
      ? "var(--text-tertiary)"
      : "var(--text-secondary)";
  const defaultPrefixColor = effectiveActive
    ? "var(--text-secondary)"
    : "var(--text-tertiary)";
  const defaultChevronColor = chevron?.lockedOpen
    ? "var(--text-primary)"
    : defaultPrefixColor;
  const bg = isHighlighted
    ? "var(--border-subtle)"
    : effectiveActive
      ? "var(--border-subtle)"
      : "transparent";
  const fontWeight = isMatched ? 450 : WEIGHT.regular;
  return (
    <a
      ref={linkRef}
      href={item.href}
      className="docs-toc-link block no-underline"
      aria-current={effectiveActive ? "location" : undefined}
      tabIndex={dimmed ? -1 : 0}
      style={
        {
          ["--toc-link-color" as "--toc-link-color"]: defaultColor,
          ["--toc-link-bg" as "--toc-link-bg"]: bg,
          ["--toc-link-opacity" as "--toc-link-opacity"]: dimmed ? 0.22 : 1,
          ["--toc-link-font-weight" as "--toc-link-font-weight"]: fontWeight,
        } as React.CSSProperties
      }
      onClick={(e) => {
        if (!onNavigate || !isPlainAnchorNavigationClick(e)) {
          return;
        }
        e.preventDefault();
        onNavigate(item, e.currentTarget);
      }}
      onMouseEnter={(e) => {
        if (!effectiveActive && !dimmed) {
          e.currentTarget.style.setProperty(
            "--toc-link-color",
            "var(--text-primary)",
          );
          e.currentTarget.style.setProperty(
            "--toc-link-bg",
            "var(--border-subtle)",
          );
          const chevronEl = e.currentTarget.querySelector<HTMLElement>(
            '[data-toc-chevron="true"]',
          );
          chevronEl?.style.setProperty(
            "--toc-prefix-color",
            "var(--text-primary)",
          );
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.setProperty("--toc-link-color", defaultColor);
        e.currentTarget.style.setProperty("--toc-link-bg", bg);
        const chevronEl = e.currentTarget.querySelector<HTMLElement>(
          '[data-toc-chevron="true"]',
        );
        chevronEl?.style.setProperty("--toc-prefix-color", defaultChevronColor);
      }}
    >
      <span
        aria-hidden="true"
        className="docs-toc-link-prefix"
        style={
          {
            ["--toc-prefix-color" as "--toc-prefix-color"]: defaultPrefixColor,
          } as React.CSSProperties
        }
      >
        {item.prefix}
      </span>
      <span className="docs-toc-link-label">{item.label}</span>
      {chevron && (
        <span
          data-toc-chevron="true"
          className="docs-toc-chevron"
          style={
            {
              ["--toc-prefix-color" as "--toc-prefix-color"]:
                defaultChevronColor,
            } as React.CSSProperties
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle?.();
          }}
        >
          <ChevronIcon
            expanded={chevron.expanded}
            style={{ marginLeft: "4px" }}
          />
        </span>
      )}
    </a>
  );
}

export function TableOfContents({
  items,
  logo: _logo,
}: {
  items: FlatTocItem[];
  logo?: string;
}) {
  const firstNavigableItem = items.find((item) => {
    return item.href.startsWith("#");
  });
  const fallbackId = getTargetIdFromHref(firstNavigableItem?.href ?? "");
  const activeHeadingId = useActiveTocId({ fallbackId });
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);

  const expandableIds = useMemo(() => {
    return new Set(
      items
        .map((i) => {
          return i.parentId;
        })
        .filter(Boolean) as string[],
    );
  }, [items]);

  /* Lookup map for walking the parent chain */
  const itemById = useMemo(() => {
    return new Map(
      items.map((i) => {
        return [i.id, i] as const;
      }),
    );
  }, [items]);

  const preferredItemIdByHref = useMemo(() => {
    const next = new Map<string, string>();
    for (const item of items) {
      next.set(item.href, item.id);
    }
    return next;
  }, [items]);

  const activeItemId =
    preferredItemIdByHref.get(`#${activeHeadingId}`) ??
    firstNavigableItem?.id ??
    items[0]?.id ??
    null;
  const selectedItemId = pendingNavigation?.itemId ?? activeItemId;

  const defaultExpandedIds = useMemo(() => {
    return new Set(
      items
        .filter((item) => {
          return item.type === "group";
        })
        .map((item) => {
          return item.id;
        }),
    );
  }, [items]);

  const passiveExpandedIds = useMemo(() => {
    const next = new Set(defaultExpandedIds);
    if (!selectedItemId) {
      return next;
    }

    if (expandableIds.has(selectedItemId)) {
      next.add(selectedItemId);
    }

    let current = itemById.get(selectedItemId);
    while (current?.parentId) {
      next.add(current.parentId);
      current = itemById.get(current.parentId);
    }

    return next;
  }, [selectedItemId, expandableIds, itemById, defaultExpandedIds]);

  const [manualExpansion, setManualExpansion] = useState<
    Map<string, ManualExpansionMode>
  >(() => {
    return new Map();
  });

  useEffect(() => {
    setManualExpansion((prev) => {
      let next: Map<string, ManualExpansionMode> | null = null;

      for (const [id, mode] of prev) {
        if (mode === "closed" && !passiveExpandedIds.has(id)) {
          next ??= new Map(prev);
          next.delete(id);
        }
      }

      return next ?? prev;
    });
  }, [passiveExpandedIds]);

  useEffect(() => {
    if (!pendingNavigation) {
      return;
    }

    if (activeHeadingId === pendingNavigation.targetId) {
      setPendingNavigation(null);
      return;
    }

    const target = document.getElementById(pendingNavigation.targetId);
    if (!target) {
      setPendingNavigation(null);
      return;
    }

    let rafId = 0;

    const clearPendingNavigation = () => {
      setPendingNavigation((current) => {
        return current?.targetId === pendingNavigation.targetId
          ? null
          : current;
      });
    };

    const handleUserInterrupt = () => {
      clearPendingNavigation();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isNavigationInterruptKey(event)) {
        handleUserInterrupt();
      }
    };

    const checkTargetPosition = () => {
      const distanceFromViewportTop =
        target.getBoundingClientRect().top - getHeaderHeight();

      if (Math.abs(distanceFromViewportTop) <= 4) {
        clearPendingNavigation();
        return;
      }

      rafId = window.requestAnimationFrame(checkTargetPosition);
    };

    rafId = window.requestAnimationFrame(checkTargetPosition);
    window.addEventListener("wheel", handleUserInterrupt, { passive: true });
    window.addEventListener("touchstart", handleUserInterrupt, {
      passive: true,
    });
    window.addEventListener("mousedown", handleUserInterrupt);
    window.addEventListener("popstate", handleUserInterrupt);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("wheel", handleUserInterrupt);
      window.removeEventListener("touchstart", handleUserInterrupt);
      window.removeEventListener("mousedown", handleUserInterrupt);
      window.removeEventListener("popstate", handleUserInterrupt);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeHeadingId, pendingNavigation]);

  const navigateToItem = useCallback(
    (item: FlatTocItem, link?: HTMLAnchorElement | null) => {
      const targetId = getTargetIdFromHref(item.href);
      const target = targetId ? document.getElementById(targetId) : null;

      if (!targetId || !target) {
        return;
      }

      setPendingNavigation({ itemId: item.id, targetId });

      const nextHash = `#${targetId}`;
      const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
      if (window.location.hash === nextHash) {
        window.history.replaceState(window.history.state, "", nextUrl);
      } else {
        window.history.pushState(window.history.state, "", nextUrl);
      }

      link?.focus();
      target.scrollIntoView({ block: "start" });
    },
    [],
  );

  const toggle = useCallback(
    (id: string) => {
      setManualExpansion((prev) => {
        const next = new Map(prev);
        const override = next.get(id);
        const isExpanded =
          override === "open"
            ? true
            : override === "closed"
              ? false
              : passiveExpandedIds.has(id);

        if (!isExpanded) {
          next.set(id, "open");
          return next;
        }

        if (passiveExpandedIds.has(id)) {
          next.set(id, "closed");
        } else {
          next.delete(id);
        }

        return next;
      });
    },
    [passiveExpandedIds],
  );

  // --- Search state ---
  // useTransition makes typing non-blocking: setQuery is urgent (input stays
  // responsive), while the TOC re-render from setSearchState is deferred and
  // interruptible — new keystrokes cancel in-progress renders automatically.
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const highlightedRef = useRef<HTMLAnchorElement>(null);
  const [isPending, startTransition] = useTransition();

  // Build Orama search DB once
  const db = useMemo(() => {
    return createTocDb({ items });
  }, [items]);

  const [searchState, setSearchState] = useState<SearchState>({
    matchedIds: null,
    expandOverrideIds: null,
    dimmedIds: null,
    focusableIds: null,
  });

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      startTransition(() => {
        const state = searchToc({ db, query: value, items });
        setSearchState(state);
        setHighlightedIndex(0);
      });
    },
    [db, items],
  );

  // Scroll highlighted item into view (only when search is active)
  useEffect(() => {
    if (!searchState.focusableIds) {
      return;
    }
    highlightedRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, searchState.focusableIds]);

  // Global / hotkey to focus search input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          (e.target as HTMLElement).isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleQueryChange("");
        searchInputRef.current?.blur();
        return;
      }
      const focusable = searchState.focusableIds;
      if (!focusable || focusable.length === 0) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          return Math.min(prev + 1, focusable.length - 1);
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          return Math.max(prev - 1, 0);
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const itemId = focusable[highlightedIndex];
        const item = itemId ? itemById.get(itemId) : undefined;
        if (item) {
          navigateToItem(item);
          handleQueryChange("");
          searchInputRef.current?.blur();
        }
      }
    },
    [
      searchState.focusableIds,
      highlightedIndex,
      handleQueryChange,
      itemById,
      navigateToItem,
    ],
  );

  const isSearchActive = searchState.matchedIds !== null;

  /* Merge search expand overrides into the expanded set so matched items
     inside collapsed branches become visible during search. */
  const effectiveExpandedIds = useMemo(() => {
    const next = new Set(defaultExpandedIds);

    for (const id of passiveExpandedIds) {
      next.add(id);
    }

    for (const [id, mode] of manualExpansion) {
      if (mode === "open") {
        next.add(id);
      } else {
        next.delete(id);
      }
    }

    if (isSearchActive && searchState.expandOverrideIds) {
      for (const id of searchState.expandOverrideIds) {
        next.add(id);
      }
    }

    return next;
  }, [
    defaultExpandedIds,
    passiveExpandedIds,
    manualExpansion,
    isSearchActive,
    searchState.expandOverrideIds,
  ]);

  /* Compute visible items: an item is visible if all its ancestors are
     effectively expanded. Since items are in document order, parents
     always come before children so a single forward pass works. */
  const visibleItems = useMemo(() => {
    const visible = new Set<string>();
    return items.filter((item) => {
      if (item.parentId === null) {
        visible.add(item.id);
        return true;
      }
      if (
        effectiveExpandedIds.has(item.parentId) &&
        visible.has(item.parentId)
      ) {
        visible.add(item.id);
        return true;
      }
      return false;
    });
  }, [items, effectiveExpandedIds]);

  return (
    <aside className="docs-toc">
      {/* Search input with / hotkey badge — stays pinned at top */}
      <div className="docs-toc-search">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => {
            handleQueryChange(e.target.value);
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search..."
          className="docs-toc-search-input"
          style={{ opacity: isPending ? 0.5 : 1 }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--text-tertiary)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--page-border)";
          }}
        />
        {/* Hotkey badge — hidden when input has text */}
        {!query && (
          <span aria-hidden="true" className="docs-toc-hotkey">
            /
          </span>
        )}
      </div>

      <nav aria-label="Table of contents" className="docs-toc-nav">
        {visibleItems.map((item, i) => {
          const isExpandable =
            item.type !== "group" && expandableIds.has(item.id);
          const isExpanded = effectiveExpandedIds.has(item.id);
          const isLockedOpen = manualExpansion.get(item.id) === "open";
          const isDimmed =
            isSearchActive && searchState.dimmedIds?.has(item.id);
          const isMatched =
            isSearchActive && Boolean(searchState.matchedIds?.has(item.id));
          const highlightedId = isSearchActive
            ? searchState.focusableIds?.[highlightedIndex]
            : undefined;
          const isHighlighted = highlightedId === item.id;
          const marginTop =
            i === 0 ? undefined : item.visualLevel === 0 ? "7px" : "1px";
          return (
            <div key={item.id} style={marginTop ? { marginTop } : undefined}>
              <TocLink
                item={item}
                isActive={item.id === selectedItemId}
                chevron={
                  isExpandable
                    ? { expanded: isExpanded, lockedOpen: isLockedOpen }
                    : undefined
                }
                onToggle={
                  isExpandable
                    ? () => {
                        toggle(item.id);
                      }
                    : undefined
                }
                onNavigate={navigateToItem}
                dimmed={isDimmed || false}
                isMatched={isMatched}
                isHighlighted={isHighlighted}
                linkRef={isHighlighted ? highlightedRef : undefined}
              />
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

/* =========================================================================
   Back button (fixed top-right)
   ========================================================================= */

export function BackButton() {
  return (
    <a
      href="/"
      className="docs-back-button fixed top-5 right-5 z-[100000] flex h-10 w-10 items-center justify-center rounded-full no-underline"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M12.25 7H1.75M1.75 7L6.125 2.625M1.75 7L6.125 11.375"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}

/* =========================================================================
   Typography
   ========================================================================= */

export function SectionHeading({
  id,
  level = 1,
  children,
}: {
  id: string;
  level?: HeadingLevel;
  children: React.ReactNode;
}) {
  level ||= 1;
  const Tag = headingTagByLevel[level] || "h4";

  return (
    <Tag
      id={id}
      data-toc-heading="true"
      data-toc-level={level}
      className={`docs-section-heading docs-section-heading-${level}`}
      style={{
        scrollMarginTop: "var(--header-height)",
      }}
    >
      <span
        className={level === 1 ? "docs-section-heading-text-nowrap" : undefined}
      >
        {children}
      </span>
      {level === 1 ? <span className="docs-section-heading-rule" /> : null}
    </Tag>
  );
}

export function P({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`editorial-prose docs-prose-p ${className}`}>{children}</p>
  );
}

export function Caption({ children }: { children: React.ReactNode }) {
  return <p className="docs-caption">{children}</p>;
}

export function Blockquote({ children }: { children: React.ReactNode }) {
  return <blockquote className="docs-blockquote">{children}</blockquote>;
}

export function A({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const isExternal = /^(https?:)?\/\//.test(href);

  return (
    <a
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="docs-link"
    >
      {children}
    </a>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="inline-code">{children}</code>;
}

/* =========================================================================
   Layout
   ========================================================================= */

export function Bleed({ children }: { children: React.ReactNode }) {
  return <div className="docs-bleed">{children}</div>;
}

export function Divider() {
  return (
    <div className="docs-divider">
      <div className="docs-divider-line" />
    </div>
  );
}

export function Section({
  id,
  title,
  level = 1,
  children,
}: {
  id: string;
  title: string;
  level?: HeadingLevel;
  children: React.ReactNode;
}) {
  return (
    <>
      <SectionHeading id={id} level={level}>
        {title}
      </SectionHeading>
      {children}
    </>
  );
}

export function OL({ children }: { children: React.ReactNode }) {
  return <ol className="docs-list docs-list-ordered m-0 pl-5">{children}</ol>;
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className="docs-list docs-list-unordered m-0 pl-5">{children}</ul>;
}

export function Li({ children }: { children: React.ReactNode }) {
  return <li className="docs-list-item">{children}</li>;
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children }: { children: React.ReactNode }) {
  return <tr>{children}</tr>;
}

export function TH({ children }: { children: React.ReactNode }) {
  return <th className="docs-table-header">{children}</th>;
}

export function TD({ children }: { children: React.ReactNode }) {
  return <td className="docs-table-cell">{children}</td>;
}

function Callout({
  tone,
  label,
  children,
}: {
  tone: "note" | "tip" | "warning";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`docs-callout docs-callout-${tone}`}>
      <div className="docs-callout-label">{label}</div>
      <div className="docs-callout-body">{children}</div>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <Callout tone="note" label="Note">
      {children}
    </Callout>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <Callout tone="tip" label="Tip">
      {children}
    </Callout>
  );
}

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <Callout tone="warning" label="Warning">
      {children}
    </Callout>
  );
}

export function Steps({ children }: { children: React.ReactNode }) {
  return <div className="docs-steps">{children}</div>;
}

export function Step({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="docs-step">
      <div className="docs-step-badge" aria-hidden="true" />
      <div className="docs-step-content">
        <h4 className="docs-step-title">{title}</h4>
        <div className="docs-step-body">{children}</div>
      </div>
    </section>
  );
}

export function CardGroup({
  cols = 2,
  children,
}: {
  cols?: number | string;
  children: React.ReactNode;
}) {
  const parsed =
    typeof cols === "number" ? cols : Number.parseInt(String(cols), 10);
  const columns = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 3)
    : 2;

  return (
    <div
      className="docs-card-grid"
      style={
        {
          ["--docs-card-columns" as "--docs-card-columns"]: String(columns),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function Columns({
  cols = 2,
  children,
}: {
  cols?: number | string;
  children: React.ReactNode;
}) {
  return <CardGroup cols={cols}>{children}</CardGroup>;
}

export function Card({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
  icon?: string;
}) {
  const isExternal = /^(https?:)?\/\//.test(href);

  return (
    <a
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="docs-card no-underline"
    >
      <div className="docs-card-title">{title}</div>
      <div className="docs-card-body">{children}</div>
    </a>
  );
}

export function Tabs({ children }: { children: React.ReactNode }) {
  return <div className="docs-tabs">{children}</div>;
}

export function Tab({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="docs-tab-panel">
      <h4 className="docs-tab-title">{title}</h4>
      <div className="docs-tab-body">{children}</div>
    </section>
  );
}

export function CodeGroup({ children }: { children: React.ReactNode }) {
  return <div className="docs-code-group">{children}</div>;
}

function FieldRow({
  label,
  type,
  required,
  children,
}: {
  label: string;
  type?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="docs-field">
      <div className="docs-field-header">
        <code className="docs-field-name">{label}</code>
        {type ? <code className="docs-field-type">{type}</code> : null}
        {required ? (
          <span className="docs-field-required">required</span>
        ) : null}
      </div>
      <div className="docs-field-body">{children}</div>
    </div>
  );
}

export function ParamField({
  path,
  type,
  required,
  children,
}: {
  path?: string;
  type?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <FieldRow label={path ?? "parameter"} type={type} required={required}>
      {children}
    </FieldRow>
  );
}

export function ResponseField({
  name,
  type,
  required,
  children,
}: {
  name?: string;
  type?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <FieldRow label={name ?? "response"} type={type} required={required}>
      {children}
    </FieldRow>
  );
}

export function AccordionGroup({ children }: { children: React.ReactNode }) {
  return <div className="docs-accordion-group">{children}</div>;
}

export function Accordion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="docs-accordion">
      <h4 className="docs-accordion-title">{title}</h4>
      <div className="docs-accordion-body">{children}</div>
    </section>
  );
}

export function Expandable({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="docs-expandable">
      <h5 className="docs-expandable-title">{title}</h5>
      <div className="docs-expandable-body">{children}</div>
    </section>
  );
}

/* =========================================================================
   Code block with Prism syntax highlighting and line numbers
   ========================================================================= */

export function CodeBlock({
  children,
  lang = "jsx",
  title,
  lineHeight = "1.85",
  showLineNumbers = true,
}: {
  children: string;
  lang?: string;
  title?: string;
  lineHeight?: string;
  showLineNumbers?: boolean;
}) {
  const lines = children.split("\n");

  /* Use Prism.highlight() to get highlighted HTML as a string. Works on both
     server and client (no DOM dependency), avoiding hydration mismatch issues
     that occur with useEffect + highlightElement. */
  const highlightedHtml = useMemo(() => {
    const grammar = lang ? Prism.languages[lang] : undefined;
    if (!grammar) {
      return undefined;
    }
    return Prism.highlight(children, grammar, lang);
  }, [children, lang]);

  return (
    <figure className="m-0 bleed">
      <div className="relative">
        {title && <div className="docs-code-title">{title}</div>}
        <pre className="docs-code-pre overflow-x-auto">
          <div
            className="docs-code-body flex"
            style={
              {
                ["--docs-code-line-height" as "--docs-code-line-height"]:
                  lineHeight,
              } as React.CSSProperties
            }
          >
            {showLineNumbers && (
              <span
                className="docs-code-line-numbers select-none shrink-0"
                aria-hidden="true"
              >
                {lines.map((_, i) => {
                  return (
                    <span key={i} className="block">
                      {i + 1}
                    </span>
                  );
                })}
              </span>
            )}
            {highlightedHtml ? (
              <code
                style={
                  {
                    ["--docs-code-line-height" as "--docs-code-line-height"]:
                      lineHeight,
                  } as React.CSSProperties
                }
                className={`docs-code-content ${lang ? `language-${lang}` : ""}`.trim()}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : (
              <code
                className={`docs-code-content ${lang ? `language-${lang}` : ""}`.trim()}
                style={
                  {
                    ["--docs-code-line-height" as "--docs-code-line-height"]:
                      lineHeight,
                  } as React.CSSProperties
                }
              >
                {children}
              </code>
            )}
          </div>
        </pre>
      </div>
    </figure>
  );
}

/* =========================================================================
   Pixelated placeholder image
   Uses a tiny pre-generated image with CSS image-rendering: pixelated
   (nearest-neighbor / point sampling in GPU terms) for a crisp mosaic
   effect. The real image fades in on top once loaded — no flash because
   the placeholder stays underneath and the real image starts at opacity 0.
   ========================================================================= */

export function PixelatedImage({
  src,
  placeholder,
  alt,
  width,
  height,
  className = "",
  style,
}: {
  src: string;
  /**
   * Base64 data URI of the tiny pixelated placeholder image (~2–4KB PNG).
   * Injected automatically by the server-side mdast image processor
   * (website/src/lib/image-cache.ts) — no need to pass manually in MDX.
   * The processor reads each image from public/, generates a 64px-wide
   * placeholder with sharp, and caches it as JSON in .cache/images/.
   */
  placeholder?: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [loaded, setLoaded] = useState(false);

  // Handles both the normal onLoad event and the case where the image is
  // already cached (img.complete is true before React mounts the handler).
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  return (
    <div
      className={`docs-media-frame ${className}`.trim()}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: `min(${width}px, 100%)`,
        aspectRatio: `${width} / ${height}`,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Placeholder: tiny image rendered with nearest-neighbor sampling */}
      {placeholder && (
        <img
          src={placeholder}
          alt=""
          aria-hidden
          width={width}
          height={height}
          className="docs-media-placeholder"
        />
      )}
      {/* Real image: starts invisible, fades in over the placeholder */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        onLoad={() => {
          setLoaded(true);
        }}
        className="docs-media-image"
        style={{ opacity: !placeholder || loaded ? 1 : 0 }}
      />
    </div>
  );
}

/* =========================================================================
   Lazy video with pixelated poster placeholder
   Same visual pattern as PixelatedImage but for <video> elements.
   Poster layers (pixelated → real) show through the transparent video element.
   Video uses native loading="lazy" + preload="none" so zero bytes are
   downloaded until the element is near the viewport and the user clicks play.
   No custom IntersectionObserver needed — all native HTML attributes.
   ========================================================================= */

export function LazyVideo({
  src,
  poster,
  placeholderPoster,
  width,
  height,
  type = "video/mp4",
  className = "",
  style,
}: {
  src: string;
  poster: string;
  /**
   * URL of the tiny pixelated poster placeholder. Use a static import so Vite
   * inlines it as a base64 data URI (all placeholders are < 4KB, well under
   * Vite's default assetsInlineLimit of 4096 bytes). This makes the
   * placeholder available synchronously on first render with zero HTTP
   * requests. Do NOT use dynamic imports or public/ paths — dynamic imports
   * add a microtask delay, and public/ files bypass Vite's asset pipeline.
   *
   * @example
   * ```tsx
   * import placeholderPoster from "../assets/placeholders/placeholder-demo-poster.png";
   * <LazyVideo placeholderPoster={placeholderPoster} poster="/demo-poster.png" ... />
   * ```
   */
  placeholderPoster: string;
  width: number;
  height: number;
  type?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [posterLoaded, setPosterLoaded] = useState(false);

  // Handles cached poster images (same pattern as PixelatedImage)
  const posterRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setPosterLoaded(true);
    }
  }, []);

  return (
    <div
      className={`docs-media-frame ${className}`.trim()}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: `${width}px`,
        aspectRatio: `${width} / ${height}`,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Pixelated poster placeholder: loads instantly (~500 bytes) */}
      <img
        src={placeholderPoster}
        alt=""
        aria-hidden
        width={width}
        height={height}
        className="docs-media-placeholder"
      />
      {/* Real poster: fades in over the pixelated placeholder */}
      <img
        ref={posterRef}
        src={poster}
        alt=""
        aria-hidden
        width={width}
        height={height}
        onLoad={() => {
          setPosterLoaded(true);
        }}
        className="docs-media-poster"
        style={{ opacity: posterLoaded ? 1 : 0 }}
      />
      {/* Video: transparent until playing, native lazy + no preload.
          Controls float on top of poster layers. No poster attr needed
          because the img layers handle the visual placeholder.
          loading="lazy" is a newer HTML attr not yet in React's TS types. */}
      <video
        controls
        preload="none"
        {...({
          loading: "lazy",
        } as React.VideoHTMLAttributes<HTMLVideoElement>)}
        width={width}
        height={height}
        className="docs-media-video"
      >
        <source src={src} type={type} />
      </video>
    </div>
  );
}

/* =========================================================================
   Chart placeholder (dark box with animated line)
   ========================================================================= */

export function ChartPlaceholder({
  height = 200,
  label,
}: {
  height?: number;
  label?: string;
}) {
  return (
    <div className="bleed">
      <div
        className="docs-chart-placeholder w-full overflow-hidden relative"
        style={{ height: `${height}px` }}
      >
        <svg
          viewBox="0 0 550 200"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,140 C30,135 60,120 90,125 C120,130 150,100 180,95 C210,90 240,110 270,105 C300,100 330,80 360,85 C390,90 420,70 450,65 C480,60 510,75 550,60"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
          />
          <path
            d="M0,140 C30,135 60,120 90,125 C120,130 150,100 180,95 C210,90 240,110 270,105 C300,100 330,80 360,85 C390,90 420,70 450,65 C480,60 510,75 550,60 L550,200 L0,200 Z"
            fill="url(#chartFill)"
          />
          <circle cx="550" cy="60" r="4" fill="#3b82f6">
            <animate
              attributeName="r"
              values="4;6;4"
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="1;0.6;1"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
        {label && (
          <div className="docs-chart-label absolute top-3 right-3 rounded px-2 py-1 text-xs">
            {label}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   Comparison table
   ========================================================================= */

export function ComparisonTable({
  title,
  headers,
  rows,
}: {
  title?: string;
  headers: [string, string, string];
  rows: Array<[string, string, string]>;
}) {
  return (
    <div className="docs-comparison-table-wrap w-full max-w-full overflow-x-auto">
      {title && <div className="docs-comparison-table-title">{title}</div>}
      <table className="docs-comparison-table w-full">
        <thead>
          <tr>
            {headers.map((header) => {
              return (
                <th
                  key={header}
                  className="docs-comparison-table-header text-left"
                >
                  {header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(([feature, them, us]) => {
            return (
              <tr key={feature}>
                <td className="docs-comparison-table-cell docs-comparison-table-cell-code docs-comparison-table-cell-nowrap">
                  {feature}
                </td>
                <td className="docs-comparison-table-cell docs-comparison-table-cell-code docs-comparison-table-cell-nowrap">
                  {them}
                </td>
                <td className="docs-comparison-table-cell docs-comparison-table-cell-code">
                  {us}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================================
   Tab bar — Mintlify/Notion-style top navigation tabs
   Active tab has 1.5px bottom indicator + faux bold via text-shadow.
   ========================================================================= */

export type TabItem = {
  label: string;
  href: string;
};

/* =========================================================================
   Aside — MDX component for right-sidebar content.
   On desktop, extracted from content flow and rendered in grid column 5
   via SectionRow. On mobile, renders inline as a styled callout.
   ========================================================================= */

/** Aside is a marker component for MDX. On desktop, its children are extracted
 *  by the section grouping logic and rendered in the right sidebar slot.
 *  On mobile, SectionRow renders it inline. The component itself is a pass-through. */
export function Aside({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** FullWidth is a marker component for MDX. Its children become a section that
 *  spans both the content and aside columns in the grid layout. */
export function FullWidth({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* =========================================================================
   SectionRow — renders one content section as a grid row.
   Content goes in column 3, aside in column 5 (sticky).
   ========================================================================= */

export function SectionRow({
  content,
  aside,
}: {
  content: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="contents lg:grid lg:grid-cols-subgrid lg:col-[2/-1]">
      <div className="slot-main flex flex-col gap-5 lg:col-[1] lg:overflow-visible text-(length:--type-body-size)">
        {content}
      </div>
      {aside && (
        <div className="docs-section-aside flex flex-col gap-3 my-2 p-3 rounded-(--border-radius-md) border border-(--border-subtle) text-(length:--type-toc-size) leading-[1.5] text-(color:--text-tree-label) lg:col-[2] lg:sticky lg:top-(--sticky-top) lg:self-start lg:max-h-[calc(100vh-var(--header-height))] lg:overflow-y-auto lg:my-[4px]">
          {aside}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Sidebar banner — Seline-style CTA card for the right gutter.
   Tinted background, short text, full-width button, optional corner image.
   ========================================================================= */

export function SidebarBanner({
  text,
  buttonLabel,
  buttonHref,
  imageUrl,
}: {
  text: React.ReactNode;
  buttonLabel: string;
  buttonHref: string;
  imageUrl?: string;
}) {
  return (
    <div className="docs-sidebar-banner">
      {text}
      <a href={buttonHref} className="docs-sidebar-banner-button no-underline">
        {buttonLabel}
      </a>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          width={144}
          height={144}
          className="docs-sidebar-banner-image"
        />
      )}
    </div>
  );
}

function TabLink({ tab, isActive }: { tab: TabItem; isActive: boolean }) {
  const isExternal = tab.href.startsWith("http");
  return (
    <a
      href={tab.href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`docs-tab-link slot-tab no-underline text-(length:--type-toc-size) font-[475] [font-family:var(--font-primary)] ${isActive ? "docs-tab-link-active" : ""}`}
    >
      {tab.label}
      <div data-tab-indicator className="docs-tab-indicator" />
    </a>
  );
}

/* =========================================================================
   Page shell — CSS grid layout with named areas.

   Desktop (lg+):
     "tabs    tabs   ."
     "toc     content ."

   Mobile:
     "tabs"
     "content"

   The grid centers the content column. The TOC column is sticky.
   ========================================================================= */

export type HeaderLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

export type EditorialSection = {
  content: React.ReactNode;
  aside?: React.ReactNode;
  fullWidth?: boolean;
};

export function EditorialPage({
  toc,
  logo,
  tabs,
  activeTab,
  showHeader = true,
  sidebar,
  headerLinks,
  children,
  sections,
}: {
  toc: FlatTocItem[];
  logo?: string;
  tabs?: TabItem[];
  activeTab?: string;
  showHeader?: boolean;
  sidebar?: React.ReactNode;
  headerLinks?: HeaderLink[];
  children?: React.ReactNode;
  /** When provided, renders section rows with aside support instead of flat children */
  sections?: EditorialSection[];
}) {
  const hasTabBar = showHeader && tabs && tabs.length > 0;

  return (
    <div className="slot-page flex flex-col min-h-screen bg-(--bg) text-(color:--text-primary) [font-family:var(--font-primary)] antialiased [text-rendering:optimizeLegibility]">
      {/* Header + Tab bar: full-width, sticky at top */}
      {showHeader && (
        <div className="slot-navbar">
          {/* Top row: logo + right links */}
          <div className="mx-auto flex items-center justify-between px-(--mobile-padding) py-(--header-padding-y) lg:max-w-(--grid-max-width) lg:px-0">
            <a href="/" className="slot-logo no-underline flex items-center">
              {logo ? (
                <div
                  role="img"
                  aria-label="playwriter"
                  style={{
                    height: "var(--logo-height)",
                    /* aspect ratio from SVG viewBox: 730/201 ≈ 3.63 */
                    aspectRatio: "730 / 201",
                    backgroundColor: "var(--logo-color)",
                    maskImage: `url(${logo})`,
                    maskSize: "contain",
                    maskRepeat: "no-repeat",
                    WebkitMaskImage: `url(${logo})`,
                    WebkitMaskSize: "contain",
                    WebkitMaskRepeat: "no-repeat",
                  }}
                />
              ) : (
                <span className="text-[18px] font-[300] [font-family:var(--font-secondary)] tracking-[-0.02em]">
                  Libretto
                </span>
              )}
            </a>
            <div className="flex items-center gap-4">
              {/* Icon links */}
              {headerLinks && headerLinks.length > 0 && (
                <div className="flex items-center gap-3">
                  {headerLinks.map((link) => {
                    return (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={link.label}
                        className="no-underline flex items-center text-(color:--text-secondary) transition-colors duration-150 hover:text-(color:--text-primary)"
                      >
                        {link.icon}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Tab row */}
          {hasTabBar && (
            <div className="slot-tabbar">
              <div className="mx-auto flex h-(--tab-bar-height) max-w-full items-stretch gap-6 overflow-x-auto px-(--mobile-padding) lg:max-w-(--grid-max-width) lg:px-0">
                {tabs.map((tab) => {
                  return (
                    <TabLink
                      key={tab.href}
                      tab={tab}
                      isActive={tab.href === (activeTab ?? tabs[0].href)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 max-w-full mx-auto px-(--mobile-padding) lg:grid-cols-[var(--grid-toc-width)_var(--grid-content-width)_var(--grid-sidebar-width)] lg:gap-x-(--grid-gap) lg:max-w-(--grid-max-width) lg:px-0">
        {/* TOC sidebar: sticky within its grid cell */}
        <div className="slot-sidebar-left">
          <div
            className="docs-sidebar-sticky"
            style={{
              top: hasTabBar ? "var(--sticky-top)" : "0px",
              maxHeight: hasTabBar
                ? "calc(100vh - var(--sticky-top))"
                : "100vh",
            }}
          >
            <TableOfContents items={toc} logo={logo} />
          </div>
        </div>

        {sections ? (
          <>
            {/* Section-based layout: each section is a subgrid row with
                content in column 3 and optional aside in column 5 (sticky). */}
            <div className="contents lg:grid lg:grid-cols-subgrid lg:col-[2/-1]">
              <div className="slot-main flex flex-col gap-5 lg:col-[1] lg:overflow-visible text-(length:--type-body-size)"></div>
            </div>
            {sections.map((section, i) => {
              if (section.fullWidth) {
                return (
                  <div
                    key={i}
                    className="lg:col-[2/-1] text-(length:--type-body-size) my-5"
                  >
                    <div className="flex flex-col gap-5">{section.content}</div>
                  </div>
                );
              }
              return (
                <SectionRow
                  key={i}
                  content={section.content}
                  aside={section.aside}
                />
              );
            })}
          </>
        ) : (
          <>
            {/* Flat layout: single article column + optional static sidebar */}
            <div className="slot-main pb-24 lg:col-[2] text-(length:--type-body-size)">
              <article className="flex flex-col gap-[20px]">{children}</article>
            </div>

            <div className="slot-sidebar-right">
              <div
                className="docs-sidebar-right-sticky"
                style={{ top: hasTabBar ? "var(--sticky-top)" : "12px" }}
              >
                {sidebar}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
