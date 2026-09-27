import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { evidencePassageSchema } from '@shared/models/theme-evidence';

import {
  extractThemeSource,
  MAX_EXTRACTION_CANDIDATES,
  MAX_EXTRACTION_DEPTH,
  MAX_EXTRACTION_NODES,
  MAX_PASSAGE_CHARACTERS,
  THEME_SOURCE_EXTRACTOR_VERSION,
} from './theme-source-extraction';
import type { RetrievedThemeSource } from './theme-source-retrieval';

function source(
  input: string | Buffer,
  mediaType: 'text/html' | 'text/plain' = 'text/html'
): RetrievedThemeSource {
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return {
    body,
    contentHash: createHash('sha256').update(body).digest('hex'),
    mediaType,
    charset: 'utf-8',
  } as RetrievedThemeSource;
}

function texts(result: ReturnType<typeof extractThemeSource>): string[] {
  expect(result.ok).toBe(true);
  return result.ok ? result.passages.map((passage) => passage.text) : [];
}

describe('deterministic theme source extraction', () => {
  it('extracts Wikipedia-shaped prose while excluding chrome, TOC, references and tables', () => {
    const result = extractThemeSource(
      source(`
      <html><body><header><p>Site header</p></header><main id="content">
        <nav><p>Navigation</p></nav><div id="mw-content-text"><div class="mw-parser-output">
          <div class="shortdescription">Short description</div><div id="toc"><p>Contents</p></div>
          <div class="infobox"><p>Infobox claim</p></div><h1>Montréal</h1>
          <p>Montréal is in Québec.</p><div class="mw-heading"><h2>History</h2></div>
          <p>The city hosted Expo 67.</p><ul><li>One event</li><li>Another event</li></ul>
          <table><tr><td><p>Table-only claim</p></td></tr></table>
          <div class="reflist"><p>Reference claim</p></div>
        </div></div></main><footer><p>Site footer</p></footer></body></html>`)
    );
    expect(texts(result)).toEqual([
      'Montréal',
      'Montréal is in Québec.',
      'History',
      'The city hosted Expo 67.',
      'One event',
      'Another event',
    ]);
    if (result.ok) {
      expect(result.extractorVersion).toBe(THEME_SOURCE_EXTRACTOR_VERSION);
      expect(result.passages.map((passage) => passage.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
      for (const passage of result.passages) {
        expect(
          evidencePassageSchema.safeParse({
            ...passage,
            id: '00000000-0000-4000-8000-000000000001',
            documentId: '00000000-0000-4000-8000-000000000002',
          }).success
        ).toBe(true);
        expect(passage.contentHash).toBe(createHash('sha256').update(passage.text).digest('hex'));
      }
    }
  });

  it('selects generic main, then article, then body without publisher-specific rules', () => {
    expect(
      texts(
        extractThemeSource(
          source(
            '<body><p>Outside</p><article><p>Article</p></article><main><p>Main</p></main></body>'
          )
        )
      )
    ).toEqual(['Main']);
    expect(
      texts(
        extractThemeSource(source('<body><p>Outside</p><article><p>Article</p></article></body>'))
      )
    ).toEqual(['Article']);
    expect(texts(extractThemeSource(source('<body><p>Body</p></body>')))).toEqual(['Body']);
  });

  it('normalizes entities, accents, emoji, whitespace and BR before hashing', () => {
    const result = extractThemeSource(
      source('<main><p>Café &amp; thé<br>😀   fin&nbsp;!</p></main>')
    );
    expect(texts(result)).toEqual(['Café & thé 😀 fin !']);
    if (result.ok)
      expect(result.passages[0].contentHash).toBe(
        createHash('sha256').update('Café & thé 😀 fin !').digest('hex')
      );
  });

  it('handles plain text paragraphs in order and removes normalized duplicates deterministically', () => {
    const input = source(
      'First line\r\nsecond line\r\n\r\nRepeated   text\n\nRepeated text\n\nLast 😀',
      'text/plain'
    );
    const first = extractThemeSource(input);
    expect(extractThemeSource(input)).toEqual(first);
    expect(texts(first)).toEqual(['First line second line', 'Repeated text', 'Last 😀']);
    if (first.ok) {
      expect(first.passages.map((passage) => passage.locator)).toEqual([
        'text:1',
        'text:2',
        'text:4',
      ]);
      expect(first.passages.map((passage) => passage.ordinal)).toEqual([0, 1, 2]);
    }
  });

  it('deduplicates HTML passages after normalization while preserving the first locator', () => {
    const input = source('<main><p>A  sentence.</p><p>A sentence.</p><p>Next.</p></main>');
    const first = extractThemeSource(input);
    expect(extractThemeSource(input)).toEqual(first);
    expect(texts(first)).toEqual(['A sentence.', 'Next.']);
    if (first.ok) {
      expect(first.passages[0].locator).toContain('/p[1]');
      expect(first.passages[1].ordinal).toBe(1);
    }
  });

  it('keeps nested list items separately in document order', () => {
    expect(
      texts(
        extractThemeSource(
          source('<main><ul><li>Outer<ul><li>Inner</li></ul></li><li>Next</li></ul></main>')
        )
      )
    ).toEqual(['Outer', 'Inner', 'Next']);
  });

  it('keeps nested block boundaries while joining inline content', () => {
    expect(
      texts(
        extractThemeSource(
          source(
            '<main><ul><li><p>First <span>place</span>: 1</p><p>2nd place: 3</p></li></ul></main>'
          )
        )
      )
    ).toEqual(['First place: 1 2nd place: 3']);
    expect(
      texts(
        extractThemeSource(
          source('<main><ul><li><div>First fact.</div><div>Second fact.</div></li></ul></main>')
        )
      )
    ).toEqual(['First fact. Second fact.']);
  });

  it('retains legitimate social-history prose while removing exact chrome classes', () => {
    expect(
      texts(
        extractThemeSource(
          source(
            '<main><section class="social-history"><p>Social history matters.</p></section><div class="navbox-items"><p>Navigation only.</p></div></main>'
          )
        )
      )
    ).toEqual(['Social history matters.']);
  });

  it('honors UTF-8 HTML meta declarations and rejects unsupported or malformed ones', () => {
    const utf8 = source('<meta charset="UTF8"><main><p>Québec is a province.</p></main>');
    utf8.charset = null;
    expect(texts(extractThemeSource(utf8))).toEqual(['Québec is a province.']);
    expect(
      texts(
        extractThemeSource(
          source(
            '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><main><p>Valid.</p></main>'
          )
        )
      )
    ).toEqual(['Valid.']);
    for (const html of [
      '<meta charset="windows-1252"><main><p>Wrong encoding.</p></main>',
      '<meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><main><p>Conflicting.</p></main>',
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8; extra=1"><main><p>Malformed.</p></main>',
    ]) {
      const input = source(html);
      input.charset = null;
      expect(extractThemeSource(input)).toMatchObject({
        ok: false,
        failure: { code: 'unsupported_charset' },
      });
    }
    expect(
      extractThemeSource(
        source('<meta charset="windows-1252"><main><p>Conflicts with HTTP UTF-8.</p></main>')
      )
    ).toMatchObject({ ok: false, failure: { code: 'unsupported_charset' } });
  });

  it('rejects material parse corruption but accepts ordinary HTML recovery', () => {
    expect(extractThemeSource(source('<main><p>Fact\u0000word</p></main>'))).toMatchObject({
      ok: false,
      failure: { code: 'unreadable_content' },
    });
    expect(extractThemeSource(source('<main><p>Fact</p><di'))).toMatchObject({
      ok: false,
      failure: { code: 'unreadable_content' },
    });
    for (const html of [
      '<main><p>Invalid &#xD800; scalar.</p></main>',
      '<main><p>Invalid &#x110000; scalar.</p></main>',
      '<main><p>Valid prose.</p><!-- unclosed',
    ]) {
      expect(extractThemeSource(source(html))).toMatchObject({
        ok: false,
        failure: { code: 'unreadable_content' },
      });
    }
    expect(texts(extractThemeSource(source('<main><p>First<p>Second</main>')))).toEqual([
      'First',
      'Second',
    ]);
  });

  it('withholds mathematical notation but retains normal citation superscripts', () => {
    expect(
      texts(
        extractThemeSource(
          source('<main><p>2<sup>3</sup> equals eight.</p><p>Ordinary fact.</p></main>')
        )
      )
    ).toEqual(['Ordinary fact.']);
    expect(
      texts(
        extractThemeSource(
          source('<main><p>Area <math><mn>2</mn></math> square.</p><p>Another fact.</p></main>')
        )
      )
    ).toEqual(['Another fact.']);
    expect(
      extractThemeSource(source('<main><p>H<sub>2</sub>O is water.</p></main>'))
    ).toMatchObject({
      ok: false,
      failure: { code: 'no_passages' },
    });
    expect(
      texts(
        extractThemeSource(
          source(
            '<main><p>Montréal hosted Expo 67.<sup class="reference"><a href="#cite_note-1">[1]</a></sup> It drew visitors.</p></main>'
          )
        )
      )
    ).toEqual(['Montréal hosted Expo 67. It drew visitors.']);
  });

  it('excludes hidden, landmarks, forms, embedded content and table-only pages', () => {
    const html = `<main><p hidden>Hidden</p><p class="visually-hidden">Class hidden</p><div aria-hidden="true"><p>ARIA</p></div>
      <div style="display: none"><p>Style</p></div><div role="navigation"><p>Landmark</p></div>
      <div aria-label="Table of contents"><p>TOC</p></div>
      <aside><p>Aside</p></aside><form><p>Form</p></form><template><p>Template</p></template>
      <noscript><p>No script</p></noscript><script><p>Script</p></script>
      <iframe><p>Frame</p></iframe><table><tr><td><p>Table</p></td></tr></table></main>`;
    expect(extractThemeSource(source(html))).toMatchObject({
      ok: false,
      failure: { code: 'no_passages' },
    });
  });

  it('fails closed on a changed body hash, invalid bytes and unsupported charset', () => {
    const changed = source('<main><p>Original</p></main>');
    changed.body = Buffer.from('<main><p>Changed</p></main>');
    expect(extractThemeSource(changed)).toMatchObject({
      ok: false,
      failure: { code: 'body_hash_mismatch' },
    });
    expect(extractThemeSource(source(Buffer.from([0xff, 0xfe]), 'text/plain'))).toMatchObject({
      ok: false,
      failure: { code: 'unreadable_content' },
    });
    for (const text of ['A\0B', 'A\u0001B', 'A\u007fB', 'A\ufdd0B', 'A\u{1ffff}B']) {
      expect(extractThemeSource(source(text, 'text/plain'))).toMatchObject({
        ok: false,
        failure: { code: 'unreadable_content' },
      });
    }
    expect(texts(extractThemeSource(source('A\tB\r\nC', 'text/plain')))).toEqual(['A B C']);
    const charset = source('Text', 'text/plain');
    charset.charset = 'iso-8859-1' as 'utf-8';
    expect(extractThemeSource(charset)).toMatchObject({
      ok: false,
      failure: { code: 'unsupported_charset' },
    });
    charset.charset = null;
    expect(texts(extractThemeSource(charset))).toEqual(['Text']);
  });

  it('fails the entire extraction on passage, candidate and depth bounds', () => {
    expect(
      extractThemeSource(source('x'.repeat(MAX_PASSAGE_CHARACTERS + 1), 'text/plain'))
    ).toMatchObject({ ok: false, failure: { code: 'resource_limit' } });
    expect(
      extractThemeSource(
        source('<main>' + '<p>x</p>'.repeat(MAX_EXTRACTION_CANDIDATES + 1) + '</main>')
      )
    ).toMatchObject({ ok: false, failure: { code: 'resource_limit' } });
    expect(
      extractThemeSource(
        source(
          '<main>' +
            '<div>'.repeat(MAX_EXTRACTION_DEPTH + 1) +
            '<p>x</p>' +
            '</div>'.repeat(MAX_EXTRACTION_DEPTH + 1) +
            '</main>'
        )
      )
    ).toMatchObject({ ok: false, failure: { code: 'resource_limit' } });
    expect(
      extractThemeSource(
        source('<main>' + '<span></span>'.repeat(MAX_EXTRACTION_NODES + 1) + '<p>x</p></main>')
      )
    ).toMatchObject({ ok: false, failure: { code: 'resource_limit' } });
  });
});
