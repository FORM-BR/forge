/**
 * Wire types for the Tavily search API (`POST https://api.tavily.com/search`).
 * Types only — no runtime code. Tavily returns a flat `results[]`; each entry
 * carries a URL, optional title, extracted page `content`, and an optional
 * `published_date`. The optional `answer` is Tavily's generated summary.
 *
 * @module @deepseek-ai/dsh-web-search-tavily/types
 */

/** Request body sent to Tavily's search endpoint. */
export interface TavilySearchRequest {
  query: string
  /** Retrieval depth: `basic` costs one credit per search, `advanced` two. */
  search_depth: 'basic' | 'advanced'
  /** Ask Tavily to generate an answer summary across the results. */
  include_answer: boolean
  /** Raw page content is never requested; `content` is the extracted snippet. */
  include_raw_content: boolean
  /** Image results are never requested; the seam's sources are citations. */
  include_images: boolean
  /** Tavily's result-count control; the seam still enforces the bound on return. */
  max_results?: number
}

/** One entry of Tavily's flat `results[]`. */
export interface TavilyResult {
  url?: string | null
  title?: string | null
  /** Extracted page content; the seam maps it to `snippet`. */
  content?: string | null
  published_date?: string | null
  /** Tavily's relevance score; the seam has no field for it. */
  score?: number
}

/** Tavily's search response envelope. */
export interface TavilySearchResponse {
  /** Generated answer summary; mapped to the seam result's `content`. */
  answer?: string | null
  results?: TavilyResult[]
}

/** Tavily's error response envelope (best-effort; fields vary by failure). */
export interface TavilyError {
  /** Tavily reports most failures under `detail`, as a string or a wrapper. */
  detail?: string | { error?: string }
  error?: string
  message?: string
}
