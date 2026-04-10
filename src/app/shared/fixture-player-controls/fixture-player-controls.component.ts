import { ChangeDetectionStrategy, Component, DestroyRef, WritableSignal, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { CmdrPlayerCapabilities } from '../../api/cmdr-models';
import { CopyToClipboardComponent } from '../copy-to-clipboard/copy-to-clipboard.component';

export interface PlayerTrack {
  index: number;
  name: string;
  duration_ms: number;
}

export interface FixturePlayerCommandRequest {
  command: string;
  kind?: 'setVolume';
  volume?: number;
  requestId?: string;
}

export interface VolumeSyncResultEvent {
  requestId: string;
  status: 'confirmed' | 'failed' | 'mismatch';
  authoritativeVolume?: number;
  message?: string;
}

/** DY players (DY-HV20T, DY-SV5W): 5 presets, no Bass (EQ range 0x00–0x04). */
const EQ_PRESETS_DY = [
  { label: 'Normal', value: 0 },
  { label: 'Pop', value: 1 },
  { label: 'Rock', value: 2 },
  { label: 'Jazz', value: 3 },
  { label: 'Classic', value: 4 },
];

/** MD / DF players (YX5300-based): 6 presets including Bass (EQ range 0x00–0x05). */
const EQ_PRESETS_ALL = [
  { label: 'Normal', value: 0 },
  { label: 'Pop', value: 1 },
  { label: 'Rock', value: 2 },
  { label: 'Jazz', value: 3 },
  { label: 'Classic', value: 4 },
  { label: 'Bass', value: 5 },
];

@Component({
  selector: 'app-fixture-player-controls',
  standalone: true,
  imports: [ButtonModule, SelectModule, SliderModule, FormsModule, CopyToClipboardComponent],
  templateUrl: './fixture-player-controls.component.html',
  styleUrl: './fixture-player-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixturePlayerControlsComponent {
  private static readonly VOLUME_SYNC_TIMEOUT_MS = 5000;
  private static readonly VOLUME_KEYBOARD_COMMIT_DEBOUNCE_MS = 800;

  readonly player = input<CmdrPlayerCapabilities | null>(null);
  readonly playerType = input<string | null>(null);
  readonly playerState = input<{ volume?: number; eq?: number; trackIndex?: number; playerStatus?: string } | null>(null);
  readonly volumeSyncResult = input<VolumeSyncResultEvent | null>(null);
  readonly planTracks = input<PlayerTrack[] | null>(null);
  readonly disabled = input<boolean>(false);

  readonly commandRequested = output<FixturePlayerCommandRequest>();
  readonly volumeSyncIssue = output<string>();

  readonly analogOverride = signal(false);
  readonly isVolumeDragging = signal(false);
  readonly isVolumeFocused = signal(false);
  readonly pendingVolumeTarget = signal<number | null>(null);
  readonly pendingVolumeRequestId = signal<string | null>(null);
  /** Per-input animation phase: filling → fading → idle */
  readonly fadeInMsPhase     = signal<'idle' | 'filling' | 'fading'>('idle');
  readonly fadeMsPhase       = signal<'idle' | 'filling' | 'fading'>('idle');
  readonly fadeInMsDirection = signal<'ltr' | 'rtl'>('ltr');
  readonly fadeMsDirection   = signal<'ltr' | 'rtl'>('ltr');

  private readonly destroyRef = inject(DestroyRef);
  private readonly fadeInTimers = { t1: 0 as ReturnType<typeof setTimeout>, t2: 0 as ReturnType<typeof setTimeout> };
  private readonly fadeTimers   = { t1: 0 as ReturnType<typeof setTimeout>, t2: 0 as ReturnType<typeof setTimeout> };
  private volumeSyncTimeout: ReturnType<typeof setTimeout> | null = null;
  private volumeKeyboardCommitTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly lastAuthoritativeVolume = signal<number | null>(null);

  private startInputAnimation(
    phase: WritableSignal<'idle' | 'filling' | 'fading'>,
    direction: WritableSignal<'ltr' | 'rtl'>,
    dir: 'ltr' | 'rtl',
    durationMs: number,
    timers: { t1: ReturnType<typeof setTimeout>; t2: ReturnType<typeof setTimeout> },
  ): void {
    direction.set(dir);
    clearTimeout(timers.t1);
    clearTimeout(timers.t2);
    phase.set('idle');                                           // reset so ::before is removed
    timers.t1 = setTimeout(() => {
      phase.set('filling');
      timers.t2 = setTimeout(() => {
        phase.set('fading');                                     // switch to fade-out transition
        timers.t1 = setTimeout(() => phase.set('idle'), 2000);  // clean up after 2 s fade
      }, durationMs);
    }, 0);                                                       // next tick restarts CSS animation
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.fadeInTimers.t1); clearTimeout(this.fadeInTimers.t2);
      clearTimeout(this.fadeTimers.t1);   clearTimeout(this.fadeTimers.t2);
      this.clearVolumeSyncTimeout();
      this.clearVolumeKeyboardCommitTimeout();
    });
    // Sync live fixture state into controls when plan_state arrives.
    effect(() => {
      const ps = this.playerState();
      if (!ps) return;
      if (ps.volume !== undefined) {
        this.lastAuthoritativeVolume.set(ps.volume);
        if (!this.isVolumeDragging() && !this.isVolumeFocused()) {
          const pendingTarget = this.pendingVolumeTarget();
          if (pendingTarget !== null) {
            if (ps.volume === pendingTarget) {
              this.clearPendingVolumeSync();
              if (this.volumeLevel() !== ps.volume) this.volumeLevel.set(ps.volume);
            } else {
              if (this.volumeLevel() !== pendingTarget) this.volumeLevel.set(pendingTarget);
            }
          } else {
            if (this.volumeLevel() !== ps.volume) this.volumeLevel.set(ps.volume);
          }
        }
      }
      if (ps.eq !== undefined) this.eqPreset.set(ps.eq);
      // Only sync track if > 0 — currentTrack is 0 before any track has played.
      if (ps.trackIndex !== undefined && ps.trackIndex > 0) this.trackNumber.set(ps.trackIndex);
    });

    effect(() => {
      const event = this.volumeSyncResult();
      if (!event) return;
      const pendingRequestId = this.pendingVolumeRequestId();
      if (!pendingRequestId || event.requestId !== pendingRequestId) return;
      if (event.status === 'confirmed') {
        this.clearPendingVolumeSync();
        if (typeof event.authoritativeVolume === 'number') {
          this.volumeLevel.set(event.authoritativeVolume);
          this.lastAuthoritativeVolume.set(event.authoritativeVolume);
        }
        return;
      }
      if (event.status === 'failed' || event.status === 'mismatch') {
        const fallback =
          typeof event.authoritativeVolume === 'number'
            ? event.authoritativeVolume
            : this.lastAuthoritativeVolume();
        this.clearPendingVolumeSync();
        if (typeof fallback === 'number') this.volumeLevel.set(fallback);
        if (event.message) this.volumeSyncIssue.emit(event.message);
      }
    });

    // Clamp eqPreset to the highest valid index when player type changes.
    effect(() => {
      const presets = this.eqPresets();
      const maxVal = presets[presets.length - 1].value;
      if (this.eqPreset() > maxVal) this.eqPreset.set(maxVal);
    });
  }

  protected readonly currentPlayerStatus = computed(() => this.playerState()?.playerStatus ?? null);

  protected readonly trackOptions = computed(() => {
    const tracks = this.planTracks();
    if (!tracks) return null;
    return [...tracks].sort((a, b) => a.index - b.index).map(t => ({
      label: `${t.index} \u2014 ${t.name} (${(t.duration_ms / 1000).toFixed(1)}s)`,
      value: t.index,
    }));
  });
  protected readonly selectedTrackName = computed(() => {
    const selectedTrackNumber = this.trackNumber();
    if (selectedTrackNumber === null) return null;
    const selectedTrack = this.planTracks()?.find((track) => track.index === selectedTrackNumber);
    return selectedTrack?.name ?? null;
  });

  readonly trackFilter = signal<string | null>(null);

  readonly trackNumber = signal<number | null>(null);
  readonly volumeLevel = signal<number>(50);
  readonly fadeToVolume = signal<number>(30);
  readonly fadeInVolume = signal<number>(30);
  readonly fadeInDurationMs = signal<number>(3000);
  readonly fadeDurationMs = signal<number>(3000);
  readonly eqPreset = signal<number>(0);

  /**
   * EQ preset list keyed on player type:
   *   DY_PLAYER / XY_PLAYER → 5 presets (Normal–Classic, 0–4; no Bass)
   *   MD_PLAYER / DF_PLAYER → 6 presets (Normal–Bass, 0–5)
   *   AK_PLAYER             → 5 presets (firmware no-ops the command)
   *   unknown               → 6 presets (safe default)
   */
  readonly eqPresets = computed(() => {
    const t = this.playerType()?.toUpperCase() ?? '';
    return t.includes('DY') || t.includes('XY') ? EQ_PRESETS_DY : EQ_PRESETS_ALL;
  });

  playSound(): void {
    const track = this.trackNumber();
    if (track === null) return;
    this.commandRequested.emit({ command: `cmd;playSound;track=${track};` });
  }

  stopSound(): void {
    this.commandRequested.emit({ command: 'cmd;stopSound;' });
  }

  fadeIn(): void {
    const track = this.trackNumber();
    if (track === null) return;
    this.commandRequested.emit({
      command: `cmd;fadeIn;track=${track};volume=${this.fadeInVolume()};duration=${this.fadeInDurationMs()};`,
    });
    this.startInputAnimation(this.fadeInMsPhase, this.fadeInMsDirection, 'ltr', this.fadeInDurationMs(), this.fadeInTimers);
  }

  fadeTo(): void {
    this.commandRequested.emit({ command: `cmd;fadeTo;volume=${this.fadeToVolume()};duration=${this.fadeDurationMs()};` });
    const dir = this.fadeToVolume() >= this.volumeLevel() ? 'ltr' : 'rtl';
    this.startInputAnimation(this.fadeMsPhase, this.fadeMsDirection, dir, this.fadeDurationMs(), this.fadeTimers);
  }

  fadeOut(): void {
    this.commandRequested.emit({ command: `cmd;fadeOut;duration=${this.fadeDurationMs()};` });
    this.startInputAnimation(this.fadeMsPhase, this.fadeMsDirection, 'rtl', this.fadeDurationMs(), this.fadeTimers);
  }

  setVolume(): void {
    const volume = this.volumeLevel();
    const authoritativeVolume = this.lastAuthoritativeVolume();
    if (authoritativeVolume !== null && volume === authoritativeVolume) {
      this.clearPendingVolumeSync();
      return;
    }
    const requestId = `vol-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
    this.pendingVolumeTarget.set(volume);
    this.pendingVolumeRequestId.set(requestId);
    this.startVolumeSyncTimeout(requestId);
    this.commandRequested.emit({
      command: `cmd;setVolume;volume=${volume};`,
      kind: 'setVolume',
      volume,
      requestId,
    });
  }

  setEqualizer(): void {
    this.commandRequested.emit({ command: `cmd;setEqualizer;preset=${this.eqPreset()};` });
  }

  onTrackInput(event: Event): void {
    const val = +(event.target as HTMLInputElement).value;
    this.trackNumber.set(val > 0 ? val : null);
  }

  onVolumeInput(value: number): void {
    this.volumeLevel.set(value);
    if (this.isVolumeFocused() && !this.isVolumeDragging()) {
      this.scheduleVolumeKeyboardCommit();
    }
  }

  onVolumePointerDown(event: Event): void {
    this.onVolumeDragStart();
    const target = event.target as HTMLElement | null;
    const handle =
      (target?.closest('.p-slider-handle') as HTMLElement | null) ??
      (target?.querySelector('.p-slider-handle') as HTMLElement | null);
    handle?.focus();
  }

  onVolumeDragStart(): void {
    this.clearVolumeKeyboardCommitTimeout();
    this.isVolumeDragging.set(true);
  }

  onVolumeDragEnd(): void {
    this.isVolumeDragging.set(false);
  }

  onVolumeFocusIn(): void {
    this.isVolumeFocused.set(true);
  }

  onVolumeFocusOut(): void {
    this.clearVolumeKeyboardCommitTimeout();
    this.isVolumeFocused.set(false);
    this.onVolumeDragEnd();
  }

  onVolumeSlideEnd(): void {
    this.onVolumeDragEnd();
    this.setVolume();
  }

  onFadeToVolumeInput(value: number): void {
    this.fadeToVolume.set(value);
  }

  onFadeInVolumeInput(value: number): void {
    this.fadeInVolume.set(value);
  }

  onFadeInDurationInput(event: Event): void {
    this.fadeInDurationMs.set(Math.min(15000, Math.max(1000, +(event.target as HTMLInputElement).value)));
  }

  onFadeDurationInput(event: Event): void {
    this.fadeDurationMs.set(Math.min(15000, Math.max(1000, +(event.target as HTMLInputElement).value)));
  }

  private clearPendingVolumeSync(): void {
    this.pendingVolumeTarget.set(null);
    this.pendingVolumeRequestId.set(null);
    this.clearVolumeSyncTimeout();
  }

  private clearVolumeSyncTimeout(): void {
    if (this.volumeSyncTimeout) {
      clearTimeout(this.volumeSyncTimeout);
      this.volumeSyncTimeout = null;
    }
  }

  private clearVolumeKeyboardCommitTimeout(): void {
    if (this.volumeKeyboardCommitTimeout) {
      clearTimeout(this.volumeKeyboardCommitTimeout);
      this.volumeKeyboardCommitTimeout = null;
    }
  }

  private scheduleVolumeKeyboardCommit(): void {
    this.clearVolumeKeyboardCommitTimeout();
    this.volumeKeyboardCommitTimeout = setTimeout(() => {
      this.volumeKeyboardCommitTimeout = null;
      if (!this.isVolumeFocused() || this.isVolumeDragging()) return;
      this.setVolume();
    }, FixturePlayerControlsComponent.VOLUME_KEYBOARD_COMMIT_DEBOUNCE_MS);
  }

  private startVolumeSyncTimeout(requestId: string): void {
    this.clearVolumeSyncTimeout();
    this.volumeSyncTimeout = setTimeout(() => {
      if (this.pendingVolumeRequestId() !== requestId) return;
      const fallback = this.lastAuthoritativeVolume();
      this.clearPendingVolumeSync();
      if (typeof fallback === 'number') this.volumeLevel.set(fallback);
      this.volumeSyncIssue.emit('Volume update not confirmed (timeout) — reverted to authoritative value.');
    }, FixturePlayerControlsComponent.VOLUME_SYNC_TIMEOUT_MS);
  }
}
