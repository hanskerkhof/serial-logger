import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

@Component({
  selector: 'app-fixture-time',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, ToggleSwitchModule, FormsModule],
  templateUrl: './fixture-time.component.html',
  styleUrl: './fixture-time.component.scss',
})
export class FixtureTimeComponent {
  /** Raw `.state` object from plan_state. */
  readonly planState = input<Record<string, unknown> | null>(null);
  readonly disabled = input(false);
  /** Whether auto time-sync on discovery is enabled. */
  readonly autoEnabled = input(false);

  /** Emitted when the user clicks the clock button — parent sends the wire command. */
  readonly syncRequested = output<void>();
  /** Emitted when the auto toggle changes — parent updates the setting and syncs if turned on. */
  readonly autoEnabledChange = output<boolean>();

  protected readonly selectedFixtureTime = computed<{ synced: boolean; label: string } | null>(() => {
    const state = this.planState();
    if (state === null) return null;
    const v = state['t'];
    if (typeof v !== 'number') return null;
    if (v <= 0) return { synced: false, label: 'not synced' };
    return {
      synced: true,
      label: new Date(v * 1000).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    };
  });

  protected onAutoChange(value: boolean): void {
    this.autoEnabledChange.emit(value);
    if (value) this.syncRequested.emit();
  }
}
