/**
 * Central model choices for server-side trivia content work.
 *
 * Keep the request options together because GPT-5.4 mini uses the
 * `max_completion_tokens` API and explicit no-reasoning mode for low latency.
 */
export const TRIVIA_AI_REQUEST_CONFIG = {
  model: 'gpt-5.4-mini',
  reasoning_effort: 'none',
} as const;

// Dispute analysis intentionally remains on GPT-4o.
export const DISPUTE_ANALYSIS_MODEL = 'gpt-4o' as const;