import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

export interface CommandOption {
  label: string;
  value: string;
  /** Sub-options shown when this command type is selected */
  actions?: { label: string; value: string }[];
  /** Extra numeric params needed for this command */
  params?: CommandParam[];
}

export interface CommandParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export const COMMAND_OPTIONS: CommandOption[] = [
  {
    label: 'plan',
    value: 'plan',
    actions: [
      { label: 'trigger', value: 'trigger' },
      { label: 'stop',    value: 'stop' },
    ],
  },
  {
    label: 'playSound',
    value: 'playSound',
    // track selector shown via trackOptions input
  },
  {
    label: 'fadeIn',
    value: 'fadeIn',
    params: [
      { key: 'volume',   label: 'volume',       default: 30,   min: 0,    max: 30,    step: 1   },
      { key: 'duration', label: 'duration (ms)', default: 3000, min: 1000, max: 15000, step: 500 },
    ],
  },
  {
    label: 'fadeTo',
    value: 'fadeTo',
    params: [
      { key: 'volume',   label: 'volume',       default: 30,   min: 0,    max: 30,    step: 1   },
      { key: 'duration', label: 'duration (ms)', default: 3000, min: 1000, max: 15000, step: 500 },
    ],
  },
  {
    label: 'fadeOut',
    value: 'fadeOut',
    params: [
      { key: 'duration', label: 'duration (ms)', default: 3000, min: 1000, max: 15000, step: 500 },
    ],
  },
  {
    label: 'setVolume',
    value: 'setVolume',
    params: [
      { key: 'volume', label: 'volume', default: 15, min: 0, max: 30, step: 1 },
    ],
  },
  {
    label: 'stopSound',
    value: 'stopSound',
  },
  {
    label: 'setEqualizer',
    value: 'setEqualizer',
    actions: [
      { label: 'Normal',  value: '0' },
      { label: 'Pop',     value: '1' },
      { label: 'Rock',    value: '2' },
      { label: 'Jazz',    value: '3' },
      { label: 'Classic', value: '4' },
      { label: 'Bass',    value: '5' },
    ],
  },
  {
    label: 'stop',
    value: 'stop',
  },
  {
    label: 'reboot',
    value: 'reboot',
  },
];

const STORAGE_KEY = 'cmdr.commandBuilder.v1';

interface PersistedState {
  ack: boolean;
  fixture: string | null;
  commandValue: string | null;
  action: string | null;
  track: number | null;
  paramValues: Record<string, number>;
}

@Component({
  selector: 'app-command-builder',
  standalone: true,
  imports: [FormsModule, ButtonModule, SelectModule, ToggleSwitchModule, InputNumberModule],
  templateUrl: './command-builder.component.html',
  styleUrl: './command-builder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandBuilderComponent implements OnInit {
  /** Fixture name options passed in from parent (label + value pairs). */
  fixtureOptions = input<{ label: string; value: string }[]>([]);

  /** Track options for the selected fixture's plan — passed in from parent. */
  trackOptions = input<{ label: string; value: number }[]>([]);

  /** Emitted when user clicks Apply — carries the composed command string. */
  readonly apply = output<string>();

  /** Emitted when user clicks Send — parent should send immediately. */
  readonly send = output<string>();

  /** Emitted when the selected fixture changes — parent should ensure tracks are loaded. */
  readonly fixtureChanged = output<string | null>();

  protected readonly commandOptions = COMMAND_OPTIONS;

  protected readonly ack          = signal(false);
  protected readonly sending      = signal(false);
  protected readonly fixture      = signal<string | null>(null);
  protected readonly commandType  = signal<CommandOption | null>(null);
  protected readonly action       = signal<string | null>(null);
  protected readonly paramValues  = signal<Record<string, number>>({});
  protected readonly track        = signal<number | null>(null);

  protected readonly currentActions = computed(() => this.commandType()?.actions ?? []);
  protected readonly currentParams  = computed(() => this.commandType()?.params ?? []);
  protected readonly needsTrack    = computed(() => {
    const v = this.commandType()?.value;
    return v === 'fadeIn' || v === 'playSound';
  });

  protected readonly preview = computed(() => {
    const fx  = this.fixture();
    const cmd = this.commandType();
    if (!fx || !cmd) return null;

    const parts: string[] = [];
    if (this.ack()) parts.push('ack');
    parts.push('tcmd', fx, 'cmd', cmd.value);

    if (cmd.value === 'plan') {
      const act = this.action();
      if (!act) return null;
      parts.push(`action=${act}`);
    } else if (cmd.value === 'playSound') {
      const t = this.track();
      if (t === null) return null;
      parts.push(`track=${t}`);
    } else if (cmd.value === 'fadeIn') {
      const t = this.track();
      if (t === null) return null;
      const p = this.paramValues();
      parts.push(`track=${t}`, `volume_scale=30`, `volume=${p['volume'] ?? 30}`, `duration=${p['duration'] ?? 3000}`);
    } else if (cmd.value === 'fadeTo') {
      const p = this.paramValues();
      parts.push(`volume_scale=30`, `volume=${p['volume'] ?? 30}`, `duration=${p['duration'] ?? 3000}`);
    } else if (cmd.value === 'fadeOut') {
      parts.push(`duration=${this.paramValues()['duration'] ?? 3000}`);
    } else if (cmd.value === 'setVolume') {
      parts.push(`volume_scale=30`, `volume=${this.paramValues()['volume'] ?? 15}`);
    } else if (cmd.value === 'stopSound') {
      // no extra params
    } else if (cmd.value === 'setEqualizer') {
      const preset = this.action();
      if (preset === null) return null;
      parts.push(`preset=${preset}`);
    }

    return parts.join(';') + ';';
  });

  protected readonly canApply = computed(() => this.preview() !== null);

  constructor() {
    // Notify parent when fixture changes so it can load tracks
    effect(() => {
      this.fixtureChanged.emit(this.fixture());
    });

    // Persist state to localStorage whenever any signal changes
    effect(() => {
      const state: PersistedState = {
        ack:          this.ack(),
        fixture:      this.fixture(),
        commandValue: this.commandType()?.value ?? null,
        action:       this.action(),
        track:        this.track(),
        paramValues:  this.paramValues(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch { /* storage full or unavailable */ }
    });
  }

  ngOnInit(): void {
    this._restoreFromStorage();
  }

  private _restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as Partial<PersistedState>;

      if (typeof state.ack === 'boolean') this.ack.set(state.ack);
      if (state.fixture) this.fixture.set(state.fixture);

      if (state.commandValue) {
        const opt = COMMAND_OPTIONS.find((o) => o.value === state.commandValue) ?? null;
        if (opt) {
          this.commandType.set(opt);
          // Restore params: merge saved values over defaults
          const defaults: Record<string, number> = {};
          for (const p of opt.params ?? []) defaults[p.key] = p.default;
          this.paramValues.set({ ...defaults, ...(state.paramValues ?? {}) });
        }
      }

      if (state.action) this.action.set(state.action);
      if (typeof state.track === 'number') this.track.set(state.track);
    } catch { /* corrupt storage — leave defaults */ }
  }

  protected onCommandTypeChange(opt: CommandOption | null): void {
    this.commandType.set(opt);
    this.action.set(null);
    this.track.set(null);
    const defaults: Record<string, number> = {};
    for (const p of opt?.params ?? []) defaults[p.key] = p.default;
    this.paramValues.set(defaults);
  }

  protected setParam(key: string, value: number): void {
    this.paramValues.update((prev) => ({ ...prev, [key]: value }));
  }

  protected prevFixture(): void {
    const opts = this.fixtureOptions();
    if (!opts.length) return;
    const idx = opts.findIndex((o) => o.value === this.fixture());
    this.fixture.set(opts[idx <= 0 ? opts.length - 1 : idx - 1].value);
    this.fixtureChanged.emit(this.fixture());
  }

  protected nextFixture(): void {
    const opts = this.fixtureOptions();
    if (!opts.length) return;
    const idx = opts.findIndex((o) => o.value === this.fixture());
    this.fixture.set(opts[idx < 0 || idx >= opts.length - 1 ? 0 : idx + 1].value);
    this.fixtureChanged.emit(this.fixture());
  }

  protected prevTrack(): void {
    const opts = this.trackOptions();
    if (!opts.length) return;
    const idx = this.track() !== null ? opts.findIndex((o) => o.value === this.track()) : -1;
    this.track.set(opts[idx <= 0 ? opts.length - 1 : idx - 1].value);
  }

  protected nextTrack(): void {
    const opts = this.trackOptions();
    if (!opts.length) return;
    const idx = this.track() !== null ? opts.findIndex((o) => o.value === this.track()) : -1;
    this.track.set(opts[idx < 0 || idx >= opts.length - 1 ? 0 : idx + 1].value);
  }

  protected onApply(): void {
    const cmd = this.preview();
    if (cmd) this.apply.emit(cmd);
  }

  protected onSend(): void {
    const cmd = this.preview();
    if (cmd) this.send.emit(cmd);
  }
}
