import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';
import { CommanderApiService } from '../../commander-api.service';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

@Component({
  selector: 'app-fixture-docs',
  standalone: true,
  imports: [MarkdownComponent],
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
    effect(() => {
      const name = this.fixtureName();
      this.docs.set([]);
      this.selectedDoc.set(null);
      this.docContent.set(null);
      if (name) {
        this.loadDocs(name);
      }
    });
  }

  private loadDocs(fixtureName: string): void {
    this.loading.set(true);
    this.api.getFixtureDocs(fixtureName).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.docs.set(res.docs ?? []);
        if (res.docs?.length) {
          this.selectDoc(res.docs[0]);
        }
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  selectDoc(filename: string): void {
    const name = this.fixtureName();
    if (!name) return;
    this.selectedDoc.set(filename);
    this.docContent.set(null);

    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      // Image URL is resolved via docImageUrl computed — no HTTP fetch needed.
      return;
    }

    this.contentLoading.set(true);
    this.api.getFixtureDocContent(name, filename).subscribe({
      next: (content) => {
        this.contentLoading.set(false);
        this.docContent.set(content);
      },
      error: () => {
        this.contentLoading.set(false);
        this.docContent.set('_Failed to load document._');
      },
    });
  }
}
