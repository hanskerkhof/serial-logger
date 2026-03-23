import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { CmdrMessage } from '../../api/cmdr-models';

@Component({
  selector: 'app-release-notes',
  standalone: true,
  templateUrl: './release-notes.component.html',
  styleUrl: './release-notes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReleaseNotesComponent {
  readonly messages = input<CmdrMessage[]>([]);
  readonly loading  = input<boolean>(false);

  readonly index   = signal(0);
  readonly current = computed(() => this.messages()[this.index()] ?? null);
  readonly hasPrev = computed(() => this.index() < this.messages().length - 1);
  readonly hasNext = computed(() => this.index() > 0);
  readonly pageLabel = computed(() => {
    const total = this.messages().length;
    return total > 1 ? `${this.index() + 1} of ${total}` : null;
  });

  constructor() {
    // Reset to latest entry whenever a new batch of messages arrives.
    effect(() => {
      this.messages(); // track dependency
      this.index.set(0);
    });
  }

  goNewer(): void {
    if (this.hasNext()) this.index.update((i) => i - 1);
  }

  goOlder(): void {
    if (this.hasPrev()) this.index.update((i) => i + 1);
  }
}
