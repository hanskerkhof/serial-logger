import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-fixture-time',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule],
  templateUrl: './fixture-time.component.html',
  styleUrl: './fixture-time.component.scss',
})
export class FixtureTimeComponent {
  /** Raw `.state` object from plan_state (the same object passed to other plan-state components). */
  readonly planState = input<Record<string, unknown> | null>(null);
  readonly disabled = input(false);

  /** Emitted when the user clicks Sync Time — parent should send the wire command. */
  readonly syncRequested = output<void>();

  protected readonly syncedEpoch = computed(() => {
    const v = this.planState()?.['t'];
    return typeof v === 'number' && v > 0 ? v : 0;
  });

  protected readonly displayTime = computed(() => {
    const epoch = this.syncedEpoch();
    if (epoch === 0) return null;
    return new Date(epoch * 1000).toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  });
}
