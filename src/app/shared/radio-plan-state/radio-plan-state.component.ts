import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,  // used for volumeDraft and stationFilter
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CopyToClipboardComponent } from '../copy-to-clipboard/copy-to-clipboard.component';

// Mirrors StreamState enum in BAUKLANK_RADIO firmware.
// Values must stay in sync with the C++ enum — they are transmitted as integers.
export const RADIO_STREAM_STATES: Record<number, { label: string; mod: string }> = {
  0: { label: 'Stopped',   mod: 'stopped' },
  1: { label: 'Buffering', mod: 'buffering' },
  2: { label: 'Playing',   mod: 'playing' },
  3: { label: 'Error',     mod: 'error' },
  4: { label: 'Timeout',   mod: 'timeout' },
};

// Mirrors the cq field computed in BAUKLANK_RADIO writeStateJson().
// 0=Poor 1=Fair 2=Good 3=Excellent, derived from RSSI + HTTP stall + zero-read drops.
const RADIO_CONN_QUALITY: Record<number, { label: string; mod: string }> = {
  0: { label: 'Poor',      mod: 'poor' },
  1: { label: 'Fair',      mod: 'fair' },
  2: { label: 'Good',      mod: 'good' },
  3: { label: 'Excellent', mod: 'excellent' },
};

export interface RadioStationOption {
  label: string;
  value: number;
  url?: string;
}

@Component({
  selector: 'app-radio-plan-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, SelectModule, SliderModule, ToggleSwitchModule, CopyToClipboardComponent],
  templateUrl: './radio-plan-state.component.html',
  styleUrl: './radio-plan-state.component.scss',
})
export class RadioPlanStateComponent {
  /** Raw `state` object from BK_PASSIVE_PS plan_state. */
  readonly planState   = input<Record<string, unknown> | null>(null);
  /** Station options from the fixture's custom_command_ui (include `url` for the URL row). */
  readonly stationOptions = input<RadioStationOption[]>([]);
  readonly disabled = input(false);

  /** Emitted when the user selects a different station. */
  readonly stationChangeRequested = output<number>();
  /** Emitted on slider release with the new volume (0–30). */
  readonly volumeChangeRequested = output<number>();
  /** Emitted when the user toggles the record switch (true = start, false = stop). */
  readonly recordingChangeRequested = output<boolean>();

  // ── derived state ─────────────────────────────────────────────────────────

  protected readonly streamState = computed(() => {
    const v = this.planState()?.['ss'];
    return typeof v === 'number' ? v : 0;
  });

  protected readonly streamStateMeta = computed(
    () => RADIO_STREAM_STATES[this.streamState()] ?? RADIO_STREAM_STATES[0],
  );

  protected readonly currentStation = computed(() => {
    const v = this.planState()?.['si'];
    return typeof v === 'number' ? v : null;
  });

  // Station name resolved from fixture metadata (stationOptions) by index — not from plan state.
  protected readonly stationName = computed(() => {
    const idx = this.currentStation();
    if (idx === null) return '';
    return this.stationOptions().find(o => o.value === idx)?.label ?? '';
  });

  protected readonly stationUrl = computed(() => {
    const station = this.currentStation();
    if (station === null) return '';
    const opt = this.stationOptions().find(o => o.value === station);
    return opt?.url ?? '';
  });

  protected readonly streamTitle = computed(() => {
    const v = this.planState()?.['st'];
    return typeof v === 'string' ? v.trim() : '';
  });

  protected readonly elapsedMs = computed(() => {
    const v = this.planState()?.['se_ms'];
    return typeof v === 'number' && v > 0 ? v : 0;
  });

  protected readonly elapsedFormatted = computed(() => this.formatElapsed(this.elapsedMs()));

  // ── connection reliability ─────────────────────────────────────────────────

  protected readonly rssiDbm = computed(() => {
    const v = this.planState()?.['rssi'];
    return typeof v === 'number' ? v : null;
  });

  protected readonly stallMs = computed(() => {
    const v = this.planState()?.['stall'];
    return typeof v === 'number' ? v : 0;
  });

  protected readonly drops = computed(() => {
    const v = this.planState()?.['drops'];
    return typeof v === 'number' ? v : 0;
  });

  protected readonly connQuality = computed(() => {
    const rssi = this.rssiDbm();
    if (rssi === null) return null;
    const stall = this.stallMs();
    const drops = this.drops();
    if (rssi < -80 || stall > 100 || drops > 0) return 0;
    if (rssi < -70 || stall > 50)               return 1;
    if (rssi < -65 || stall > 30)               return 2;
    return 3;
  });

  protected readonly connQualityMeta = computed(
    () => RADIO_CONN_QUALITY[this.connQuality() ?? -1] ?? null,
  );

  protected readonly planStateVolume = computed(() => {
    const v = this.planState()?.['v'];
    return typeof v === 'number' ? v : 20;
  });

  protected readonly sdReady = computed(() => {
    const v = this.planState()?.['sd'];
    return typeof v === 'number' ? v === 1 : false;
  });

  // Synced from plan_state `rec` field; writable for immediate UI feedback on toggle click.
  protected readonly recordingActive = linkedSignal(() => {
    const v = this.planState()?.['rec'];
    return typeof v === 'number' ? v === 1 : false;
  });

  protected onRecordingToggle(value: boolean): void {
    this.recordingActive.set(value);
    this.recordingChangeRequested.emit(value);
  }

  // Local draft during drag — shows immediately without waiting for plan state round-trip.
  protected readonly volumeDraft = signal<number | null>(null);
  protected readonly displayVolume = computed(() => this.volumeDraft() ?? this.planStateVolume());

  protected onVolumeInput(value: number): void {
    this.volumeDraft.set(value);
  }

  protected onVolumeRelease(value: number): void {
    this.volumeDraft.set(null);
    this.volumeChangeRequested.emit(value);
  }

  // ── station selector ───────────────────────────────────────────────────────

  protected readonly stationFilter = signal<string | null>(null);

  protected readonly selectedStation = computed(() => this.currentStation());

  protected onStationChange(value: number): void {
    this.stationChangeRequested.emit(value);
  }

  protected prevStation(): void {
    const opts = this.stationOptions();
    if (!opts.length) return;
    const cur = this.currentStation() ?? 0;
    const idx = opts.findIndex(o => o.value === cur);
    const prev = idx <= 0 ? opts.length - 1 : idx - 1;
    this.onStationChange(opts[prev].value);
  }

  protected nextStation(): void {
    const opts = this.stationOptions();
    if (!opts.length) return;
    const cur = this.currentStation() ?? 0;
    const idx = opts.findIndex(o => o.value === cur);
    const next = idx < 0 || idx >= opts.length - 1 ? 0 : idx + 1;
    this.onStationChange(opts[next].value);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private formatElapsed(ms: number): string {
    if (ms <= 0) return '00:00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}
