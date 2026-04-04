import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MarkdownComponent } from 'ngx-markdown';
import { ButtonModule } from 'primeng/button';
import { CommanderApiService } from '../../commander-api.service';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

@Component({
  selector: 'app-fixture-docs',
  standalone: true,
  imports: [MarkdownComponent, ButtonModule],
  templateUrl: './fixture-docs.component.html',
  styleUrl: './fixture-docs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixtureDocsComponent {
  private readonly api = inject(CommanderApiService);

  readonly fixtureName = input<string | null>(null);

  readonly loading = signal(false);
  readonly contentLoading = signal(false);
  readonly docs = signal<string[]>([]);
  readonly selectedDoc = signal<string | null>(null);
  readonly docContent = signal<string | null>(null);
  readonly mermaidReady = signal(false);
  readonly contentError = signal<string | null>(null);

  readonly isImage = computed(() => {
    const doc = this.selectedDoc();
    if (!doc) return false;
    const ext = doc.slice(doc.lastIndexOf('.')).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });

  readonly docImageUrl = computed(() => {
    const name = this.fixtureName();
    const doc = this.selectedDoc();
    if (!name || !doc || !this.isImage()) return null;
    return `${this.api.apiBaseUrl()}/fixtures/${encodeURIComponent(name)}/docs/${encodeURIComponent(doc)}`;
  });

  constructor() {
    void this.ensureMermaidLoaded();

    effect(() => {
      const name = this.fixtureName();
      this.docs.set([]);
      this.selectedDoc.set(null);
      this.docContent.set(null);
      this.contentError.set(null);
      if (name) {
        this.loadDocs(name, null);
      }
    });
  }

  private async ensureMermaidLoaded(): Promise<void> {
    if (typeof window === 'undefined') return;
    const globalWindow = window as Window & { mermaid?: { initialize?: (...args: unknown[]) => void } };
    if (globalWindow.mermaid?.initialize) {
      this.mermaidReady.set(true);
      return;
    }
    try {
      const module = await import('mermaid');
      const mermaid = (module as { default?: unknown }).default ?? module;
      (globalWindow as Window & { mermaid?: unknown }).mermaid = mermaid;
      this.mermaidReady.set(true);
    } catch {
      this.mermaidReady.set(false);
    }
  }

  private loadDocs(fixtureName: string, preferredDoc: string | null): void {
    this.loading.set(true);
    this.contentError.set(null);
    this.api.getFixtureDocs(fixtureName).subscribe({
      next: (res) => {
        this.loading.set(false);
        const docs = res.docs ?? [];
        this.docs.set(docs);

        const nextDoc = preferredDoc && docs.includes(preferredDoc) ? preferredDoc : (docs[0] ?? null);
        if (nextDoc) {
          this.selectDoc(nextDoc);
        } else {
          this.selectedDoc.set(null);
          this.docContent.set(null);
          this.contentLoading.set(false);
        }
      },
      error: () => {
        this.loading.set(false);
        this.docs.set([]);
        this.selectedDoc.set(null);
        this.docContent.set(null);
        this.contentLoading.set(false);
        this.contentError.set('Could not refresh documentation list from the backend.');
      },
    });
  }

  refreshDocs(): void {
    const name = this.fixtureName();
    if (!name) return;
    this.loadDocs(name, this.selectedDoc());
  }

  selectDoc(filename: string): void {
    const name = this.fixtureName();
    if (!name) return;
    this.selectedDoc.set(filename);
    this.docContent.set(null);
    this.contentError.set(null);

    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      // Image URL is resolved via docImageUrl computed — no HTTP fetch needed.
      return;
    }

    this.contentLoading.set(true);
    this.api.getFixtureDocContent(name, filename).subscribe({
      next: (content) => {
        this.contentLoading.set(false);
        this.contentError.set(null);
        if (ext === '.mmd') {
          const mermaidMarkdown = ['```mermaid', content.trim(), '```'].join('\n');
          this.docContent.set(mermaidMarkdown);
          return;
        }
        this.docContent.set(content);
      },
      error: (error: unknown) => {
        this.contentLoading.set(false);
        this.docContent.set(null);
        this.contentError.set(this.describeDocError(error));
      },
    });
  }

  onImageLoadError(): void {
    this.contentError.set(
      'This image could not be loaded. It may have been removed or renamed. Use refresh to fetch the latest docs list.',
    );
  }

  private describeDocError(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 404) {
      return 'This document was not found. It may have been removed or renamed. Use refresh to update the list.';
    }
    return 'Could not load this document from the backend. Please try refreshing the docs list.';
  }
}
