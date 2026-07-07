import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CopyToClipboardComponent } from '../copy-to-clipboard/copy-to-clipboard.component';
import { PlaybackMsPipe } from '../pipes/playback-ms.pipe';

/**
 * Compact status readout for the ERBARME_DICH_TRACKS plan, shown above the
 * track/transport buttons. Reads the raw `state` sub-object of the fixture's
 * plan_state (produced by the plan's writeStateJson):
 *   current_track, track_count, playing, paused, tape_position_ms, path.
 *
 * tape_position_ms is rendered with the shared `playbackMs` pipe (m:ss / h:mm:ss).
 */
@Component({
  selector: 'app-erbarme-plan-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlaybackMsPipe, CopyToClipboardComponent],
  templateUrl: './erbarme-plan-state.component.html',
  styleUrl: './erbarme-plan-state.component.scss',
})
export class ErbarmePlanStateComponent {
  /** Raw `state` object from ERBARME_DICH_TRACKS plan_state (null before first query). */
  readonly planState = input<Record<string, unknown> | null>(null);

  private num(key: string): number | null {
    const v = this.planState()?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  protected readonly hasState = computed(() => this.planState() != null);
  protected readonly currentTrack = computed(() => this.num('current_track'));
  protected readonly trackCount = computed(() => this.num('track_count'));
  protected readonly tapePositionMs = computed(() => this.num('tape_position_ms'));

  protected readonly path = computed(() => {
    const v = this.planState()?.['path'];
    return typeof v === 'string' ? v : '';
  });

  private readonly playing = computed(() => this.planState()?.['playing'] === true);
  private readonly paused = computed(() => this.planState()?.['paused'] === true);

  /** Single human label from the two booleans: playing → paused → stopped. */
  protected readonly statusLabel = computed(() =>
    this.playing() ? 'Playing' : this.paused() ? 'Paused' : 'Stopped',
  );
  protected readonly statusMod = computed(() =>
    this.playing() ? 'playing' : this.paused() ? 'paused' : 'stopped',
  );
}
