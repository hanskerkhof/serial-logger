import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';
import { CmdrMessage } from '../../api/cmdr-models';

@Component({
  selector: 'app-release-notes',
  standalone: true,
  imports: [MarkdownComponent],
  templateUrl: './release-notes.component.html',
  styleUrl: './release-notes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReleaseNotesComponent {
  readonly messages = input<CmdrMessage[]>([]);
  readonly loading = input<boolean>(false);
  readonly total = input<number | null>(null);
  readonly offset = input<number>(0);

  readonly olderPageRequested = output<void>();
  readonly newerPageRequested = output<void>();

  readonly index = signal(0);
  readonly current = computed(() => this.messages()[this.index()] ?? null);
  readonly position = computed(() => this.offset() + this.index() + 1);
  readonly effectiveTotal = computed(() => this.total() ?? this.messages().length);
  readonly hasPrev = computed(() => this.position() < this.effectiveTotal());
  readonly hasNext = computed(() => this.position() > 1);
  readonly pageLabel = computed(() => {
    const total = this.effectiveTotal();
    return total > 1 ? `${this.position()} of ${total}` : null;
  });

  private pendingBoundaryNav: 'older' | 'newer' | null = null;

  constructor() {
    // Keep cursor intuitive when a new API page is loaded from boundary navigation.
    effect(() => {
      this.messages(); // track dependency
      const pending = this.pendingBoundaryNav;
      this.pendingBoundaryNav = null;
      if (pending === 'newer') {
        const lastIndex = Math.max(0, this.messages().length - 1);
        this.index.set(lastIndex);
      } else {
        this.index.set(0);
      }
    });
  }

  goNewer(): void {
    if (this.index() > 0) {
      this.index.update((i) => i - 1);
      return;
    }
    if (this.hasNext()) {
      this.pendingBoundaryNav = 'newer';
      this.newerPageRequested.emit();
    }
  }

  goOlder(): void {
    if (this.index() < this.messages().length - 1) {
      this.index.update((i) => i + 1);
      return;
    }
    if (this.hasPrev()) {
      this.pendingBoundaryNav = 'older';
      this.olderPageRequested.emit();
    }
  }
}
