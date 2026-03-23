import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { CmdrPlayerCapabilities } from '../../api/cmdr-models';

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
  imports: [ButtonModule, SelectModule, FormsModule],
  templateUrl: './fixture-player-controls.component.html',
  styleUrl: './fixture-player-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixturePlayerControlsComponent {
  readonly player = input<CmdrPlayerCapabilities | null>(null);
  readonly playerType = input<string | null>(null);
  readonly playerState = input<{ volume?: number; eq?: number } | null>(null);
  readonly disabled = input<boolean>(false);

  readonly commandRequested = output<string>();

  readonly analogOverride = signal(false);

  constructor() {
    // Sync live fixture state into controls when plan_state arrives.
    effect(() => {
      const ps = this.playerState();
      if (!ps) return;
      if (ps.volume !== undefined) this.volumeLevel.set(ps.volume);
      if (ps.eq !== undefined) this.eqPreset.set(ps.eq);
    });

    // Clamp eqPreset to the highest valid index when player type changes.
    effect(() => {
      const presets = this.eqPresets();
      const maxVal = presets[presets.length - 1].value;
      if (this.eqPreset() > maxVal) this.eqPreset.set(maxVal);
    });
  }
  readonly trackNumber = signal<number | null>(null);
  readonly volumeLevel = signal<number>(50);
  readonly fadeToVolume = signal<number>(30);
  readonly fadeDurationMs = signal<number>(3000);
  readonly eqPreset = signal<number>(0);

  /** EQ preset list is narrowed to 5 entries for DY players (no Bass); full 6 for all others. */
  readonly eqPresets = computed(() =>
    this.playerType()?.toUpperCase().includes('DY') ? EQ_PRESETS_DY : EQ_PRESETS_ALL,
  );

  playSound(): void {
    const track = this.trackNumber();
    if (track === null) return;
    this.commandRequested.emit(`cmd;playSound;track=${track};`);
  }

  stopSound(): void {
    this.commandRequested.emit('cmd;stopSound;');
  }

  fadeIn(): void {
    const track = this.trackNumber();
    if (track === null) return;
    this.commandRequested.emit(`cmd;fadeIn;track=${track};volume=${this.fadeToVolume()};duration=${this.fadeDurationMs()};`);
  }

  fadeTo(): void {
    this.commandRequested.emit(`cmd;fadeTo;volume=${this.fadeToVolume()};duration=${this.fadeDurationMs()};`);
  }

  fadeOut(): void {
    this.commandRequested.emit(`cmd;fadeOut;duration=${this.fadeDurationMs()};`);
  }

  setVolume(): void {
    this.commandRequested.emit(`cmd;setVolume;volume=${this.volumeLevel()};`);
  }

  setEqualizer(): void {
    this.commandRequested.emit(`cmd;setEqualizer;preset=${this.eqPreset()};`);
  }

  onTrackInput(event: Event): void {
    const val = +(event.target as HTMLInputElement).value;
    this.trackNumber.set(val > 0 ? val : null);
  }

  onVolumeInput(event: Event): void {
    this.volumeLevel.set(+(event.target as HTMLInputElement).value);
  }

  onFadeToVolumeInput(event: Event): void {
    this.fadeToVolume.set(+(event.target as HTMLInputElement).value);
  }

  onFadeDurationInput(event: Event): void {
    this.fadeDurationMs.set(+(event.target as HTMLInputElement).value);
  }
}
