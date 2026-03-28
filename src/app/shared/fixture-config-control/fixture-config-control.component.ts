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
  protected readonly auxInt1 = linkedSignal(() => this.config()?.aux?.aux_int1 ?? null);
  protected readonly auxInt2 = linkedSignal(() => this.config()?.aux?.aux_int2 ?? null);
  protected readonly auxInt3 = linkedSignal(() => this.config()?.aux?.aux_int3 ?? null);
  protected readonly auxInt4 = linkedSignal(() => this.config()?.aux?.aux_int4 ?? null);
  protected readonly auxInt5 = linkedSignal(() => this.config()?.aux?.aux_int5 ?? null);
  protected readonly auxInt6 = linkedSignal(() => this.config()?.aux?.aux_int6 ?? null);
  protected readonly auxInt7 = linkedSignal(() => this.config()?.aux?.aux_int7 ?? null);
  protected readonly auxInt8 = linkedSignal(() => this.config()?.aux?.aux_int8 ?? null);
  protected readonly auxChar1 = linkedSignal(() => this.config()?.aux?.aux_char1 ?? '');
  protected readonly auxChar2 = linkedSignal(() => this.config()?.aux?.aux_char2 ?? '');
  protected readonly auxChar3 = linkedSignal(() => this.config()?.aux?.aux_char3 ?? '');
  protected readonly auxChar4 = linkedSignal(() => this.config()?.aux?.aux_char4 ?? '');
  protected readonly auxChar5 = linkedSignal(() => this.config()?.aux?.aux_char5 ?? '');
  protected readonly auxChar6 = linkedSignal(() => this.config()?.aux?.aux_char6 ?? '');
  protected readonly auxChar7 = linkedSignal(() => this.config()?.aux?.aux_char7 ?? '');
  protected readonly auxChar8 = linkedSignal(() => this.config()?.aux?.aux_char8 ?? '');
  protected readonly auxIntIndexes = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  protected readonly auxCharIndexes = [1, 2, 3, 4, 5, 6, 7, 8] as const;

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

  protected auxIntValue(index: number): number | null {
    switch (index) {
      case 1: return this.auxInt1();
      case 2: return this.auxInt2();
      case 3: return this.auxInt3();
      case 4: return this.auxInt4();
      case 5: return this.auxInt5();
      case 6: return this.auxInt6();
      case 7: return this.auxInt7();
      case 8: return this.auxInt8();
      default: return null;
    }
  }

  protected setAuxIntValue(index: number, value: number | null): void {
    switch (index) {
      case 1: this.auxInt1.set(value); break;
      case 2: this.auxInt2.set(value); break;
      case 3: this.auxInt3.set(value); break;
      case 4: this.auxInt4.set(value); break;
      case 5: this.auxInt5.set(value); break;
      case 6: this.auxInt6.set(value); break;
      case 7: this.auxInt7.set(value); break;
      case 8: this.auxInt8.set(value); break;
    }
  }

  protected saveAuxInt(index: number): void {
    const currentValue = this.auxIntValue(index);
    if (currentValue === null || Number.isNaN(Number(currentValue))) {
      return;
    }
    const clamped = Math.max(0, Math.min(9_999_999, Math.trunc(Number(currentValue))));
    this.setAuxIntValue(index, clamped);
    this.commandRequested.emit(`cmd;config;setAuxInt${index}=${clamped};save=1;`);
  }

  protected auxCharValue(index: number): string {
    switch (index) {
      case 1: return this.auxChar1();
      case 2: return this.auxChar2();
      case 3: return this.auxChar3();
      case 4: return this.auxChar4();
      case 5: return this.auxChar5();
      case 6: return this.auxChar6();
      case 7: return this.auxChar7();
      case 8: return this.auxChar8();
      default: return '';
    }
  }

  protected setAuxCharValue(index: number, value: string): void {
    switch (index) {
      case 1: this.auxChar1.set(value); break;
      case 2: this.auxChar2.set(value); break;
      case 3: this.auxChar3.set(value); break;
      case 4: this.auxChar4.set(value); break;
      case 5: this.auxChar5.set(value); break;
      case 6: this.auxChar6.set(value); break;
      case 7: this.auxChar7.set(value); break;
      case 8: this.auxChar8.set(value); break;
    }
  }

  protected saveAuxChar(index: number): void {
    const sanitized = this.auxCharValue(index).replaceAll(';', '').slice(0, 12);
    this.setAuxCharValue(index, sanitized);
    this.commandRequested.emit(`cmd;config;setAuxChar${index}=${sanitized};save=1;`);
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
