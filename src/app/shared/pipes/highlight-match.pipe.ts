import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Wraps every case-insensitive occurrence of `search` inside `text` in a
 * `<mark>` element, for use with `[innerHTML]`:
 *
 *   <span [innerHTML]="fixture.fixture_name | highlightMatch: filterText()"></span>
 *
 * The input is HTML-escaped first, so arbitrary text is safe to pass; only the
 * generated <mark> tags survive into the sanitized output. An empty or
 * whitespace-only `search` returns the escaped text unchanged.
 *
 * `markClass` overrides the CSS class on the generated element (default
 * `highlight-match`).
 */
@Pipe({ name: 'highlightMatch' })
export class HighlightMatchPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(
    text: string | null | undefined,
    search: string | null | undefined,
    markClass = 'highlight-match',
  ): SafeHtml {
    const source = text ?? '';
    const escaped = this.escapeHtml(source);
    const needle = (search ?? '').trim();
    if (!needle) return this.sanitizer.bypassSecurityTrustHtml(escaped);

    const pattern = new RegExp(this.escapeRegExp(this.escapeHtml(needle)), 'gi');
    const highlighted = escaped.replace(
      pattern,
      (match) => `<mark class="${markClass}">${match}</mark>`,
    );
    return this.sanitizer.bypassSecurityTrustHtml(highlighted);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
