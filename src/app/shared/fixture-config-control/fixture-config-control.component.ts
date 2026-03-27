import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CmdrFixtureConfig } from '../../api/cmdr-models';

const EQ_PRESETS = [
  { label: 'Normal', value: 0 },
  { label: 'Pop', value: 1 },
  { label: 'Rock', value: 2 },
  { label: 'Jazz', value: 3 },
  { label: 'Classic', value: 4 },
];

@Component({
  selector: 'app-fixture-config-control',
  standalone: true,
  imports: [ButtonModule, SelectModule, FormsModule, InputTextModule, ToggleSwitchModule],
  templateUrl: './fixture-config-control.component.html',
  styleUrl: './fixture-config-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixtureConfigControlComponent {
  readonly config = input<CmdrFixtureConfig | null>(null);
  readonly disabled = input(false);
  readonly loading = input(false);

  readonly commandRequested = output<string>();

  protected readonly controlsDisabled = computed(() => this.loading() || this.disabled());
  protected readonly eqPresets = EQ_PRESETS;

  // --- Editable local state (reset when config input changes) ---

  protected readonly volume = linkedSignal(() => this.config()?.player?.volume ?? null);
  protected readonly defaultVolume = linkedSignal(() => this.config()?.player?.default_volume ?? null);
  protected readonly minVolume = linkedSignal(() => this.config()?.player?.min_volume ?? null);
  protected readonly maxVolume = linkedSignal(() => this.config()?.player?.max_volume ?? null);
  protected readonly eq = linkedSignal(() => this.config()?.player?.eq ?? 0);
  protected readonly autoOff = linkedSignal(() => !!(this.config()?.aux?.auto_off));
  protected readonly wifiSsidPass = linkedSignal(() => this.config()?.wifi_ssid_pass ?? '');

  // Used to show the wifi ssid input (without the pass part)
  protected readonly wifiSsidDisplay = computed(() => {
    const raw = this.config()?.wifi_ssid_pass ?? '';
    // wifi_ssid_pass stores "ssid:pass" or just "ssid" — show only the ssid portion
    return raw.split(':')[0] ?? raw;
  });

  protected readonly newSsid = signal('');
  protected readonly newPassword = signal('');

  protected saveVolume(): void {
    const v = this.volume();
    if (v === null) return;
    this.commandRequested.emit(`cmd;config;setVolume=${v};save=1;`);
  }

  protected saveDefaultVolume(): void {
    const v = this.defaultVolume();
    if (v === null) return;
    this.commandRequested.emit(`cmd;config;setDefaultVolume=${v};save=1;`);
  }

  protected saveMinVolume(): void {
    const v = this.minVolume();
    if (v === null) return;
    this.commandRequested.emit(`cmd;config;setMinVolume=${v};save=1;`);
  }

  protected saveMaxVolume(): void {
    const v = this.maxVolume();
    if (v === null) return;
    this.commandRequested.emit(`cmd;config;setMaxVolume=${v};save=1;`);
  }

  protected saveEq(): void {
    this.commandRequested.emit(`cmd;config;setEq=${this.eq()};save=1;`);
  }

  protected saveAutoOff(): void {
    this.commandRequested.emit(`cmd;config;setAutoOff=${this.autoOff() ? 1 : 0};save=1;`);
  }

  protected saveWifi(): void {
    const ssid = this.newSsid().trim();
    const pass = this.newPassword().trim();
    if (!ssid) return;
    let cmd = `cmd;wifi;ssid=${ssid};`;
    if (pass) cmd += `password=${pass};`;
    this.commandRequested.emit(cmd);
  }
}
