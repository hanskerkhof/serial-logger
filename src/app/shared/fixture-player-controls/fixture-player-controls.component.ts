import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild, WritableSignal, computed, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { TooltipModule } from 'primeng/tooltip';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CmdrPlayerCapabilities } from '../../api/cmdr-models';
import { CopyToClipboardComponent } from '../copy-to-clipboard/copy-to-clipboard.component';
import { formatPlaybackMs } from '../pipes/playback-ms.pipe';

export interface PlayerTrack {
  index: number;
  name: string;
  duration_ms: number;
}

export interface FixturePlayerCommandRequest {
  command: string;
  kind?: 'setVolume';
  volume?: number;
  volumeScale?: 30 | 100;
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
  imports: [ButtonModule, SelectModule, SliderModule, ToggleSwitchModule, TooltipModule, FormsModule, CopyToClipboardComponent],
  templateUrl: './fixture-player-controls.component.html',
  styleUrl: './fixture-player-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixturePlayerControlsComponent {
  private static readonly VOLUME_SYNC_TIMEOUT_MS = 5000;
  private static readonly VOLUME_KEYBOARD_COMMIT_DEBOUNCE_MS = 800;

  readonly player = input<CmdrPlayerCapabilities | null>(null);
  readonly playerType = input<string | null>(null);
  readonly defaultVolume = input<number | null>(null);
  readonly playerState = input<{ volume?: number; eq?: number; trackIndex?: number; playerStatus?: string; elapsedMs?: number; durationMs?: number } | null>(null);
  readonly volumeSyncResult = input<VolumeSyncResultEvent | null>(null);
  readonly planTracks = input<PlayerTrack[] | null>(null);
  readonly planStatus = input<string | null>(null);
  readonly liveUpdateEnabled = input<boolean>(true);
  readonly disabled = input<boolean>(false);
  readonly analogVolumeEnabled = input<boolean | null>(null);

  protected readonly autoPlayTooltip = computed(() =>
    this.liveUpdateEnabled()
      ? 'Keep FE open for this fixture for Auto play to work.'
      : 'Keep FE open for this fixture and enable Live update for Auto play to work.',
  );

  readonly commandRequested = output<FixturePlayerCommandRequest>();
  readonly volumeSyncIssue = output<string>();

  readonly autoPlay = signal(false);
  readonly analogOverride = signal(false);
  // Optimistic local state for the analog-volume toggle; resets to server value when input updates.
  protected readonly localAnalogVolumeEnabled = linkedSignal(() => this.analogVolumeEnabled() ?? true);
  readonly isTrackSelectOpen = signal(false);
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
  /** Plain (non-signal) fields — used inside effects to track previous values without creating reactive dependencies. */
  private _autoPlayPrevStatus: string | null = null;
  private _autoPlayWasOn = false;
  /** Fallback timer: fires after poll-interval + buffer for sounds shorter than one poll cycle. */
  private _autoPlayFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly AUTO_PLAY_FALLBACK_MS = 1500; // 1 s poll + 500 ms buffer
  private volumeKeyboardCommitTimeout: ReturnType<typeof setTimeout> | null = null;
  private volumeRefocusTimeout: ReturnType<typeof setTimeout> | null = null;
  private keepVolumeFocusAfterSync = false;
  private readonly lastAuthoritativeVolume = signal<number | null>(null);
  private readonly lastAuthoritativeTrack = signal<number | null>(null);
  @ViewChild('volumeSliderHost', { read: ElementRef })
  private volumeSliderHost?: ElementRef<HTMLElement>;

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
      this.clearVolumeRefocusTimeout();
      this.clearAutoPlayFallbackTimer();
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
      // Track sync is paused while the track selector is open so user selection doesn't snap back.
      if (ps.trackIndex !== undefined && ps.trackIndex > 0) {
        this.lastAuthoritativeTrack.set(ps.trackIndex);
        if (!this.isTrackSelectOpen()) this.trackNumber.set(ps.trackIndex);
      }
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

    // Auto-play: two behaviours driven by a single effect.
    // 1. Toggle turned ON  → immediately play the selected track (or the first track).
    // 2. Track ends (PLAYING → STOPPED) → advance to the next track and play it.
    // Both are disabled while a plan is RUNNING.
    // Plain fields for prev-values avoid circular reactive dependencies.
    effect(() => {
      const isOn      = this.autoPlay();
      const status    = this.currentPlayerStatus();
      const planRunning = this.planStatus() === 'RUNNING';
      const wasPlaying  = this._autoPlayPrevStatus === 'PLAYING';
      const justTurnedOn = isOn && !this._autoPlayWasOn;

      this._autoPlayPrevStatus = status;
      this._autoPlayWasOn      = isOn;

      if (planRunning || this.disabled()) return;

      if (justTurnedOn) {
        // If a sound is already playing, just arm auto-play without restarting it.
        // Prime _autoPlayPrevStatus so the PLAYING→STOPPED transition is detected
        // correctly when the current track eventually finishes.
        if (status === 'PLAYING') {
          this._autoPlayPrevStatus = 'PLAYING';
          return;
        }
        // Play current selection, or fall back to the first track in the list.
        // Use emitPlayTrack (not playSound) to keep auto-play on.
        setTimeout(() => {
          const opts = this.trackOptions();
          if (!opts || opts.length === 0) return;
          const current = this.trackNumber();
          const track = (current !== null && opts.some(o => o.value === current))
            ? current
            : opts[0].value;
          this.trackNumber.set(track);
          this.emitPlayTrack(track);
        }, 0);
        return;
      }

      if (isOn && wasPlaying && status === 'STOPPED') {
        this.clearAutoPlayFallbackTimer(); // reactive path won — cancel the safety net
        setTimeout(() => this.nextTrack(), 0);
      }
    });
  }

  protected readonly currentPlayerStatus = computed(() => this.playerState()?.playerStatus ?? null);

  protected readonly playbackTimeLabel = computed(() => {
    const state = this.playerState();
    if (state?.playerStatus !== 'PLAYING' || state?.elapsedMs === undefined) return null;
    const elapsed = formatPlaybackMs(state.elapsedMs);
    const duration = state.durationMs ? formatPlaybackMs(state.durationMs) : null;
    return duration ? `${elapsed} / ${duration}` : elapsed;
  });

  protected readonly trackOptions = computed(() => {
    const tracks = this.planTracks();
    if (!tracks) return null;
    return [...tracks].sort((a, b) => a.index - b.index).map(t => ({
      label: `${t.index} \u2014 ${t.name} (${(t.duration_ms / 1000).toFixed(1)}s \u00b7 ${formatPlaybackMs(t.duration_ms)})`,
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
  readonly volumeLevel = signal<number>(15);
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
    this.disableAutoPlay();           // manual button — turn off auto-play
    this.emitPlayTrack(track);
  }

  /** Emits a play command without touching auto-play state. Used by the auto-play system. */
  private emitPlayTrack(track: number): void {
    this._autoPlayPrevStatus = 'PLAYING';
    this.commandRequested.emit({ command: `cmd;playSound;track=${track};` });
    this.scheduleAutoPlayFallbackIfNeeded();
  }

  stopSound(): void {
    this.disableAutoPlay();
    this.commandRequested.emit({ command: 'cmd;stopSound;' });
  }

  fadeIn(): void {
    const track = this.trackNumber();
    if (track === null) return;
    this.disableAutoPlay();
    this.commandRequested.emit({
      command: `cmd;fadeIn;track=${track};volume_scale=30;volume=${this.fadeInVolume()};duration=${this.fadeInDurationMs()};`,
    });
    this.startInputAnimation(this.fadeInMsPhase, this.fadeInMsDirection, 'ltr', this.fadeInDurationMs(), this.fadeInTimers);
  }

  fadeTo(): void {
    this.commandRequested.emit({ command: `cmd;fadeTo;volume_scale=30;volume=${this.fadeToVolume()};duration=${this.fadeDurationMs()};` });
    const dir = this.fadeToVolume() >= this.volumeLevel() ? 'ltr' : 'rtl';
    this.startInputAnimation(this.fadeMsPhase, this.fadeMsDirection, dir, this.fadeDurationMs(), this.fadeTimers);
  }

  fadeOut(): void {
    this.disableAutoPlay();
    this.commandRequested.emit({ command: `cmd;fadeOut;duration=${this.fadeDurationMs()};` });
    this.startInputAnimation(this.fadeMsPhase, this.fadeMsDirection, 'rtl', this.fadeDurationMs(), this.fadeTimers);
  }

  setVolume(keepFocusAfterSync = false): void {
    const volume = this.volumeLevel();
    this.keepVolumeFocusAfterSync = keepFocusAfterSync;
    if (keepFocusAfterSync) {
      this.scheduleVolumeRefocus();
    }
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
      command: `cmd;setVolume;volume_scale=30;volume=${volume};`,
      kind: 'setVolume',
      volume,
      volumeScale: 30,
      requestId,
    });
  }

  onAnalogVolumeToggle(enabled: boolean): void {
    this.localAnalogVolumeEnabled.set(enabled);
    this.commandRequested.emit({ command: `cmd;analogVolume;enabled=${enabled ? '1' : '0'};` });
  }

  applyDefaultVolume(): void {
    const dv = this.defaultVolume();
    if (dv === null) return;
    this.volumeLevel.set(dv);
    this.setVolume();
  }

  setEqualizer(): void {
    this.commandRequested.emit({ command: `cmd;setEqualizer;preset=${this.eqPreset()};` });
  }

  onTrackInput(event: Event): void {
    const val = +(event.target as HTMLInputElement).value;
    this.trackNumber.set(val > 0 ? val : null);
  }

  onTrackSelectOpen(): void {
    this.isTrackSelectOpen.set(true);
  }

  onTrackSelectClose(): void {
    this.isTrackSelectOpen.set(false);
  }

  onTrackSelectChange(track: number): void {
    this.trackNumber.set(track);
    if (!Number.isFinite(track) || track <= 0) return;
    const authoritativeTrack = this.lastAuthoritativeTrack();
    if (authoritativeTrack !== null && authoritativeTrack === track) return;
    this.emitPlayTrack(track);
  }

  prevTrack(): void {
    const opts = this.trackOptions();
    if (!opts || opts.length === 0) return;
    const current = this.trackNumber();
    const idx = current !== null ? opts.findIndex(o => o.value === current) : -1;
    const prevIdx = idx <= 0 ? opts.length - 1 : idx - 1;
    this.onTrackSelectChange(opts[prevIdx].value);
  }

  nextTrack(): void {
    const opts = this.trackOptions();
    if (!opts || opts.length === 0) return;
    const current = this.trackNumber();
    const idx = current !== null ? opts.findIndex(o => o.value === current) : -1;
    const nextIdx = idx < 0 || idx >= opts.length - 1 ? 0 : idx + 1;
    this.onTrackSelectChange(opts[nextIdx].value);
  }

  onVolumeInput(value: number): void {
    this.volumeLevel.set(value);
    if (this.isVolumeFocused() && !this.isVolumeDragging()) {
      this.scheduleVolumeKeyboardCommit();
    }
  }

  onVolumePointerDown(event: Event): void {
    this.keepVolumeFocusAfterSync = false;
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

  onVolumeFocusOut(event?: FocusEvent): void {
    this.clearVolumeKeyboardCommitTimeout();
    this.isVolumeFocused.set(false);
    this.onVolumeDragEnd();
    const nextTarget = event?.relatedTarget as Node | null;
    if (this.keepVolumeFocusAfterSync && this.shouldRestoreVolumeFocus(nextTarget)) {
      this.scheduleVolumeRefocus();
      return;
    }
    this.keepVolumeFocusAfterSync = false;
  }

  onVolumeSlideEnd(): void {
    this.onVolumeDragEnd();
    this.setVolume(false);
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

  private clearVolumeRefocusTimeout(): void {
    if (this.volumeRefocusTimeout) {
      clearTimeout(this.volumeRefocusTimeout);
      this.volumeRefocusTimeout = null;
    }
  }

  private shouldRestoreVolumeFocus(nextTarget: Node | null): boolean {
    if (!nextTarget) return true;
    if (nextTarget === document.body || nextTarget === document.documentElement) return true;
    const host = this.volumeSliderHost?.nativeElement;
    if (!host) return false;
    return host.contains(nextTarget);
  }

  private scheduleVolumeRefocus(retriesLeft = 8): void {
    this.clearVolumeRefocusTimeout();
    this.volumeRefocusTimeout = setTimeout(() => {
      this.volumeRefocusTimeout = null;
      if (!this.keepVolumeFocusAfterSync || this.disabled()) return;
      const host = this.volumeSliderHost?.nativeElement;
      const handle = host?.querySelector('.p-slider-handle') as HTMLElement | null;
      if (handle) {
        handle.focus({ preventScroll: true });
        this.keepVolumeFocusAfterSync = false;
        return;
      }
      if (retriesLeft <= 0) {
        this.keepVolumeFocusAfterSync = false;
        return;
      }
      this.scheduleVolumeRefocus(retriesLeft - 1);
    }, 35);
  }

  private scheduleVolumeKeyboardCommit(): void {
    this.clearVolumeKeyboardCommitTimeout();
    this.volumeKeyboardCommitTimeout = setTimeout(() => {
      this.volumeKeyboardCommitTimeout = null;
      if (!this.isVolumeFocused() || this.isVolumeDragging()) return;
      this.setVolume(true);
    }, FixturePlayerControlsComponent.VOLUME_KEYBOARD_COMMIT_DEBOUNCE_MS);
  }

  private scheduleAutoPlayFallbackIfNeeded(): void {
    if (!this.autoPlay() || this.disabled() || this.planStatus() === 'RUNNING') return;
    this.clearAutoPlayFallbackTimer();
    this._autoPlayFallbackTimer = setTimeout(() => {
      this._autoPlayFallbackTimer = null;
      if (!this.autoPlay() || this.disabled() || this.planStatus() === 'RUNNING') return;
      // If the player isn't actively playing, the sound already ended — advance.
      if (this.currentPlayerStatus() !== 'PLAYING') {
        this._autoPlayPrevStatus = null; // reset so next cycle starts clean
        this.nextTrack();
      }
    }, FixturePlayerControlsComponent.AUTO_PLAY_FALLBACK_MS);
  }

  private clearAutoPlayFallbackTimer(): void {
    if (this._autoPlayFallbackTimer !== null) {
      clearTimeout(this._autoPlayFallbackTimer);
      this._autoPlayFallbackTimer = null;
    }
  }

  private disableAutoPlay(): void {
    this.autoPlay.set(false);
    this.clearAutoPlayFallbackTimer();
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
