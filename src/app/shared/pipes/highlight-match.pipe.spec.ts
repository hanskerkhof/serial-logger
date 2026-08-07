import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HighlightMatchPipe } from './highlight-match.pipe';

describe('HighlightMatchPipe', () => {
  let pipe: HighlightMatchPipe;
  let sanitizer: DomSanitizer;

  const html = (value: SafeHtml): string =>
    String(sanitizer.sanitize(SecurityContext.HTML, value) ?? '');

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [HighlightMatchPipe] });
    pipe = TestBed.inject(HighlightMatchPipe);
    sanitizer = TestBed.inject(DomSanitizer);
  });

  it('returns the text unchanged when the search term is empty', () => {
    expect(html(pipe.transform('BK_KLANK_1', ''))).toBe('BK_KLANK_1');
    expect(html(pipe.transform('BK_KLANK_1', '   '))).toBe('BK_KLANK_1');
    expect(html(pipe.transform('BK_KLANK_1', null))).toBe('BK_KLANK_1');
  });

  it('wraps every case-insensitive match in a mark element', () => {
    expect(html(pipe.transform('BK_KLANK_klank', 'klank'))).toBe(
      'BK_<mark class="highlight-match">KLANK</mark>_<mark class="highlight-match">klank</mark>',
    );
  });

  it('ignores surrounding whitespace in the search term', () => {
    expect(html(pipe.transform('TRIPTYCH', '  tri  '))).toBe(
      '<mark class="highlight-match">TRI</mark>PTYCH',
    );
  });

  it('treats regex metacharacters as literal text', () => {
    expect(html(pipe.transform('a.b', '.'))).toBe('a<mark class="highlight-match">.</mark>b');
    expect(html(pipe.transform('ab', '.'))).toBe('ab');
  });

  it('escapes HTML in the source text', () => {
    const result = html(pipe.transform('<script>x</script>', 'script'));
    expect(result).not.toContain('<script>');
    expect(result).toContain('<mark class="highlight-match">script</mark>');
  });

  it('honours a custom mark class', () => {
    expect(html(pipe.transform('PARTY', 'par', 'custom-mark'))).toBe(
      '<mark class="custom-mark">PAR</mark>TY',
    );
  });

  it('handles null and undefined text', () => {
    expect(html(pipe.transform(null, 'x'))).toBe('');
    expect(html(pipe.transform(undefined, 'x'))).toBe('');
  });
});
