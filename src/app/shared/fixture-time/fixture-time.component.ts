import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';

function formatEpochSeconds(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Auto-sync-on-discovery lives entirely in the API now (CMDR_hello_api.py's
 * `_maybe_auto_sync_fixture_time()`, fired from `_cache_plan_state()` for
 * every fixture regardless of whether any FE is open) — this component only
 * shows the current sync status and offers a manual clock button.
 */
@Component({
  selector: 'app-fixture-time',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule],
  templateUrl: './fixture-time.component.html',
  styleUrl: './fixture-time.component.scss',
})
export class FixtureTimeComponent {
  /** Raw `.state` object from plan_state. */
  readonly planState = input<Record<string, unknown> | null>(null);
  readonly disabled = input(false);

  /** Emitted when the user clicks the clock button — parent sends the wire command. */
  readonly syncRequested = output<void>();

  /**
   * Last real `_t` the fixture reported, plus the browser time it arrived —
   * the label below ticks locally between plan_state pushes by adding
   * elapsed wall-clock time to this baseline, then re-baselines (correcting
   * any local drift) the moment a fresh `_t` comes in.
   */
  private readonly baseline = signal<{ epochSeconds: number; receivedAtMs: number } | null>(null);

  /** Advances once a second purely to force selectedFixtureTime to recompute. */
  private readonly tick = signal(0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const intervalId = setInterval(() => this.tick.update((n) => n + 1), 1000);
    destroyRef.onDestroy(() => clearInterval(intervalId));

    // Re-baselines on every planState change (including a fixture switch,
    // which must drop any stale baseline from the previously selected
    // fixture rather than keep ticking its time forward).
    effect(() => {
      const state = this.planState();
      const v = state?.['_t'];
      this.baseline.set(typeof v === 'number' && v > 0 ? { epochSeconds: v, receivedAtMs: Date.now() } : null);
    });
  }

  protected readonly selectedFixtureTime = computed<{ synced: boolean; label: string } | null>(() => {
    this.tick();
    const state = this.planState();
    if (state === null) return null;
    const v = state['_t'];
    if (typeof v !== 'number') return null;
    const b = this.baseline();
    if (v <= 0 || b === null) return { synced: false, label: 'not synced' };
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - b.receivedAtMs) / 1000));
    return { synced: true, label: formatEpochSeconds(b.epochSeconds + elapsedSeconds) };
  });
}
