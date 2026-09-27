import { createHash } from 'node:crypto';

import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import { THEME_RELIABILITY_CONTRACT_VERSION } from '@shared/models/theme-evidence';

import { MAX_SOURCE_BYTES } from './theme-source-https';
import type { RetrievedThemeSource } from './theme-source-retrieval';

export const THEME_SOURCE_EXTRACTOR_VERSION = 'theme-source-extractor-v1' as const;
export const MAX_PASSAGE_CHARACTERS = 12_000;
export const MAX_EXTRACTION_NODES = 100_000;
export const MAX_EXTRACTION_DEPTH = 256;
export const MAX_EXTRACTION_CANDIDATES = 10_000;
const MAX_EXTRACTED_CHARACTERS = 500_000;

export interface ThemePassageCandidate {
  contractVersion: typeof THEME_RELIABILITY_CONTRACT_VERSION;
  ordinal: number;
  locator: string;
  text: string;
  contentHash: string;
}

export type ThemeSourceExtractionResult =
  | {
      ok: true;
      extractorVersion: typeof THEME_SOURCE_EXTRACTOR_VERSION;
      passages: ThemePassageCandidate[];
    }
  | {
      ok: false;
      failure: {
        extractorVersion: typeof THEME_SOURCE_EXTRACTOR_VERSION;
        code:
          | 'invalid_source'
          | 'body_hash_mismatch'
          | 'unsupported_charset'
          | 'unreadable_content'
          | 'resource_limit'
          | 'no_passages';
      };
    };

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

const EXCLUDED_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'nav',
  'aside',
  'footer',
  'header',
  'form',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'canvas',
  'svg',
  'math',
  'table',
  'input',
  'button',
  'select',
  'textarea',
  'dialog',
]);
const CHROME_TOKENS = new Set([
  'toc',
  'table-of-contents',
  'navbox',
  'infobox',
  'sidebar',
  'reflist',
  'references',
  'reference',
  'footnotes',
  'metadata',
  'hatnote',
  'shortdescription',
  'mw-editsection',
  'mw-jump-link',
  'mw-ref',
  'site-header',
  'site-footer',
  'page-header',
  'page-footer',
  'breadcrumb',
  'breadcrumbs',
  'pagination',
  'toolbar',
  'advert',
  'advertisement',
  'cookie',
  'share',
  'social',
  'hidden',
  'visually-hidden',
  'sr-only',
  'd-none',
]);
const CHROME_PREFIXES = [
  'toc-',
  'mw-toc-',
  'vector-toc-',
  'navbox-',
  'infobox-',
  'sidebar-',
  'reflist-',
  'reference-',
  'mw-editsection-',
  'mw-jump-link-',
  'mw-ref-',
];
const PROSE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li']);
const BLOCK_TAGS = new Set([
  'article',
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'main',
  'p',
  'section',
]);
const CORRUPT_PARSE_ERRORS = new Set([
  'control-character-in-input-stream',
  'surrogate-in-input-stream',
  'unexpected-null-character',
  'null-character-reference',
  'eof-before-tag-name',
  'eof-in-tag',
  'eof-in-cdata',
  'eof-in-script-html-comment-like-text',
  'eof-in-element-that-can-contain-only-text',
  'duplicate-attribute',
  'missing-attribute-value',
]);

type FailureCode = Extract<ThemeSourceExtractionResult, { ok: false }>['failure']['code'];

function failed(code: FailureCode): ThemeSourceExtractionResult {
  return { ok: false, failure: { extractorVersion: THEME_SOURCE_EXTRACTOR_VERSION, code } };
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function children(node: Node): Node[] {
  return 'childNodes' in node ? node.childNodes : [];
}

function attribute(node: Element, name: string): string | undefined {
  return node.attrs.find((attr) => attr.name === name)?.value;
}

function isChromeToken(value: string): boolean {
  const token = value.toLowerCase();
  return CHROME_TOKENS.has(token) || CHROME_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function hiddenOrChrome(node: Element): boolean {
  if (node.attrs.some((attr) => attr.name === 'hidden' || attr.name === 'inert')) return true;
  if (attribute(node, 'aria-hidden')?.toLowerCase() === 'true') return true;
  if (
    /^(navigation|complementary|search|banner|contentinfo|form)$/i.test(
      attribute(node, 'role') ?? ''
    )
  )
    return true;
  if (
    [attribute(node, 'id') ?? '', ...(attribute(node, 'class') ?? '').split(/\s+/)].some(
      isChromeToken
    )
  )
    return true;
  if (/\b(?:table of contents|page navigation)\b/i.test(attribute(node, 'aria-label') ?? ''))
    return true;
  const style = attribute(node, 'style') ?? '';
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(
    style
  );
}

function excluded(node: Element): boolean {
  return (
    EXCLUDED_TAGS.has(node.tagName) ||
    node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
    hiddenOrChrome(node)
  );
}

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function textOf(root: Node): { text: string; unsupportedNotation: boolean } {
  const chunks: string[] = [];
  const stack: (Node | 'boundary')[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === 'boundary') {
      chunks.push(' ');
      continue;
    }
    if ('value' in node && node.nodeName === '#text') {
      chunks.push(node.value);
    } else if (isElement(node)) {
      if (node !== root && hiddenOrChrome(node)) continue;
      if (
        node.tagName === 'math' ||
        node.namespaceURI === 'http://www.w3.org/1998/Math/MathML' ||
        node.tagName === 'sup' ||
        node.tagName === 'sub'
      )
        return { text: '', unsupportedNotation: true };
      if (node !== root && (excluded(node) || node.tagName === 'ul' || node.tagName === 'ol'))
        continue;
      if (node.tagName === 'br') {
        chunks.push(' ');
        continue;
      }
      if (node !== root && BLOCK_TAGS.has(node.tagName)) chunks.push(' ');
      if (node !== root && BLOCK_TAGS.has(node.tagName)) stack.push('boundary');
      for (const child of children(node).slice().reverse()) stack.push(child);
    } else {
      for (const child of children(node).slice().reverse()) stack.push(child);
    }
  }
  return { text: normalize(chunks.join('')), unsupportedNotation: false };
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isUtf8Label(label: string): boolean {
  return ['utf-8', 'utf8', 'unicode-1-1-utf-8'].includes(label.trim().toLowerCase());
}

function validMetaEncoding(node: Element): boolean {
  if (node.tagName !== 'meta') return true;
  const charset = attribute(node, 'charset');
  if (charset !== undefined && !isUtf8Label(charset)) return false;
  if (attribute(node, 'http-equiv')?.trim().toLowerCase() === 'content-type') {
    const content = attribute(node, 'content') ?? '';
    const declaration =
      /^\s*text\/html\s*;\s*charset\s*=\s*(?:"([a-zA-Z0-9._-]+)"|([a-zA-Z0-9._-]+))\s*$/i.exec(
        content
      );
    if (!declaration || !isUtf8Label(declaration[1] ?? declaration[2])) return false;
  }
  return true;
}

function makePassages(
  candidates: { locator: string; text: string }[]
): ThemeSourceExtractionResult {
  const seen = new Set<string>();
  const passages: ThemePassageCandidate[] = [];
  let totalCharacters = 0;
  for (const candidate of candidates) {
    const text = normalize(candidate.text);
    if (!text) continue;
    totalCharacters += text.length;
    if (text.length > MAX_PASSAGE_CHARACTERS || totalCharacters > MAX_EXTRACTED_CHARACTERS)
      return failed('resource_limit');
    const contentHash = hash(text);
    if (seen.has(contentHash)) continue;
    seen.add(contentHash);
    passages.push({
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      ordinal: passages.length,
      locator: candidate.locator,
      text,
      contentHash,
    });
  }
  return passages.length
    ? { ok: true, extractorVersion: THEME_SOURCE_EXTRACTOR_VERSION, passages }
    : failed('no_passages');
}

function extractHtml(html: string): ThemeSourceExtractionResult {
  let corrupt = false;
  const document = parse(html, {
    onParseError: (error) => {
      if (CORRUPT_PARSE_ERRORS.has(error.code)) corrupt = true;
    },
  });
  if (corrupt) return failed('unreadable_content');
  type Frame = { node: Node; path: string; depth: number; hidden: boolean };
  const frames: Frame[] = [{ node: document, path: '', depth: 0, hidden: false }];
  const visible: Frame[] = [];
  let visited = 0;
  let selectedMain: Node | null = null;
  let selectedArticle: Node | null = null;
  let selectedBody: Node | null = null;
  while (frames.length) {
    const frame = frames.pop()!;
    if (++visited > MAX_EXTRACTION_NODES || frame.depth > MAX_EXTRACTION_DEPTH)
      return failed('resource_limit');
    if (isElement(frame.node) && !validMetaEncoding(frame.node))
      return failed('unsupported_charset');
    const hidden = frame.hidden || (isElement(frame.node) && excluded(frame.node));
    if (!hidden) visible.push(frame);
    if (!hidden && isElement(frame.node)) {
      if (frame.node.tagName === 'main' && !selectedMain) selectedMain = frame.node;
      if (frame.node.tagName === 'article' && !selectedArticle) selectedArticle = frame.node;
      if (frame.node.tagName === 'body' && !selectedBody) selectedBody = frame.node;
    }
    const counts = new Map<string, number>();
    const childFrames = children(frame.node).map((child) => {
      const tag = isElement(child) ? child.tagName : child.nodeName;
      const ordinal = (counts.get(tag) ?? 0) + 1;
      counts.set(tag, ordinal);
      return {
        node: child,
        path: `${frame.path}/${tag}[${ordinal}]`,
        depth: frame.depth + 1,
        hidden,
      };
    });
    for (const child of childFrames.reverse()) frames.push(child);
  }

  const root = selectedMain ?? selectedArticle ?? selectedBody;
  if (!root) return failed('no_passages');
  const rootIndex = visible.findIndex((frame) => frame.node === root);
  const rootPath = visible[rootIndex].path;
  const candidates: { locator: string; text: string }[] = [];
  let candidateCount = 0;
  for (let index = rootIndex; index < visible.length; index++) {
    const frame = visible[index];
    if (index > rootIndex && !frame.path.startsWith(`${rootPath}/`)) continue;
    if (!isElement(frame.node) || !PROSE_TAGS.has(frame.node.tagName)) continue;
    const ancestor = frame.node.parentNode;
    let nested = false;
    let current = ancestor;
    while (current && current !== root) {
      if (
        isElement(current) &&
        PROSE_TAGS.has(current.tagName) &&
        !(frame.node.tagName === 'li' && current.tagName === 'li')
      ) {
        nested = true;
        break;
      }
      current = 'parentNode' in current ? current.parentNode : null;
    }
    if (nested) continue;
    if (++candidateCount > MAX_EXTRACTION_CANDIDATES) return failed('resource_limit');
    const path = `html:${frame.path}`;
    const content = textOf(frame.node);
    if (!content.unsupportedNotation)
      candidates.push({
        locator: path.length <= 500 ? path : `html:sha256:${hash(path)}`,
        text: content.text,
      });
  }
  return makePassages(candidates);
}

/** Pure, synchronous conversion of already retrieved bytes into provenance-ready passage candidates. */
export function extractThemeSource(source: RetrievedThemeSource): ThemeSourceExtractionResult {
  if (
    !Buffer.isBuffer(source.body) ||
    source.body.length === 0 ||
    source.body.length > MAX_SOURCE_BYTES ||
    (source.mediaType !== 'text/html' && source.mediaType !== 'text/plain') ||
    !/^[a-f0-9]{64}$/.test(source.contentHash)
  )
    return failed('invalid_source');
  if (source.charset !== null && source.charset !== 'utf-8') return failed('unsupported_charset');
  if (createHash('sha256').update(source.body).digest('hex') !== source.contentHash)
    return failed('body_hash_mismatch');
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.body);
  } catch {
    return failed('unreadable_content');
  }
  if (source.mediaType === 'text/plain') {
    const parts = decoded.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
    if (parts.length > MAX_EXTRACTION_CANDIDATES) return failed('resource_limit');
    return makePassages(parts.map((text, index) => ({ locator: `text:${index + 1}`, text })));
  }
  try {
    return extractHtml(decoded);
  } catch {
    return failed('unreadable_content');
  }
}
