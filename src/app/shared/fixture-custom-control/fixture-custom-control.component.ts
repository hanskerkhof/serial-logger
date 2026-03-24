import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { CmdrCustomCommandUiArg, CmdrCustomCommandUiItem } from '../../api/cmdr-models';

export type FixtureCustomControlValue = string | number | boolean;

export interface FixtureCustomArgChangedEvent {
  commandId: string;
  arg: CmdrCustomCommandUiArg;
  rawValue: unknown;
}

export interface FixtureCustomMasterReleasedEvent {
  changes: FixtureCustomArgChangedEvent[];
  commands: CmdrCustomCommandUiItem[];
}

interface GroupedCommandGroup {
  key: string;
  label: string;
  layout: 'paired' | 'full';
  commands: CmdrCustomCommandUiItem[];
}

interface VolumeSliderEntry {
  commandId: string;
  command: CmdrCustomCommandUiItem;
  arg: CmdrCustomCommandUiArg;
  min: number;
  max: number;
  step: number;
  currentValue: number;
}

interface SelectOption {
  label: string;
  value: FixtureCustomControlValue;
}

@Component({
  selector: 'app-fixture-custom-control',
  standalone: true,
  imports: [FormsModule, InputTextModule, ButtonModule],
  templateUrl: './fixture-custom-control.component.html',
  styleUrl: './fixture-custom-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixtureCustomControlComponent {
  readonly commands = input<CmdrCustomCommandUiItem[]>([]);
  readonly values = input<Record<string, Record<string, FixtureCustomControlValue>>>({});
  readonly loading = input(false);
  readonly disabled = input(false);

  readonly argChanged = output<FixtureCustomArgChangedEvent>();
  readonly commandRunRequested = output<CmdrCustomCommandUiItem>();
  readonly sliderReleased = output<CmdrCustomCommandUiItem>();
  readonly masterPreviewChanged = output<FixtureCustomArgChangedEvent[]>();
  readonly masterReleased = output<FixtureCustomMasterReleasedEvent>();

  protected readonly groupedCommands = computed<
    GroupedCommandGroup[]
  >(() => {
    const isVolumeCommand = (cmd: CmdrCustomCommandUiItem): boolean => {
      const id = (cmd.id ?? '').toLowerCase();
      const wire = (cmd.wire_template ?? '').toLowerCase();
      return (
        id === 'set_volumes' ||
        id.startsWith('set_volume') ||
        (wire.includes('cmd;setvolume;') && wire.includes('player='))
      );
    };

    const isPlayTracksCommand = (cmd: CmdrCustomCommandUiItem): boolean => {
      const id = (cmd.id ?? '').toLowerCase();
      const wire = (cmd.wire_template ?? '').toLowerCase();
      return id === 'play_tracks' || id.startsWith('play_track') || wire.includes('cmd;playtrack;');
    };

    const groups: GroupedCommandGroup[] = [];

    for (const cmd of this.commands()) {
      const explicitGroup = (cmd.group ?? '').trim();
      const fallbackVolumeGroup = !explicitGroup && isVolumeCommand(cmd);
      const fallbackPlayTracksGroup = !explicitGroup && isPlayTracksCommand(cmd);
      const isVolumeGroup = explicitGroup.toLowerCase() === 'volume' || fallbackVolumeGroup;
      const isPlayTracksGroup =
        explicitGroup.toLowerCase() === 'play tracks' ||
        explicitGroup.toLowerCase() === 'play_tracks' ||
        fallbackPlayTracksGroup;

      const key = isVolumeGroup
        ? '__set_volumes__'
        : isPlayTracksGroup
          ? '__play_tracks__'
          : (explicitGroup || null);
      const label = isVolumeGroup ? 'Set volumes' : isPlayTracksGroup ? 'Play Tracks' : explicitGroup;
      const layout: 'paired' | 'full' = isVolumeGroup || isPlayTracksGroup ? 'paired' : 'full';

      if (key) {
        const existing = groups.find((group) => group.key === key);
        if (existing) {
          existing.commands.push(cmd);
        } else {
          groups.push({ key, label, layout, commands: [cmd] });
        }
      } else {
        groups.push({ key: cmd.id, label: cmd.label, layout: 'full', commands: [cmd] });
      }
    }

    return groups;
  });

  protected commandArgValue(commandId: string, arg: CmdrCustomCommandUiArg): FixtureCustomControlValue {
    const commandValues = this.values()[commandId];
    if (commandValues && arg.name in commandValues) {
      return commandValues[arg.name];
    }
    return this.defaultValueForArg(arg);
  }

  protected selectOptions(arg: CmdrCustomCommandUiArg): SelectOption[] {
    const maybeOptions = (arg as unknown as { options?: unknown }).options;
    if (!Array.isArray(maybeOptions)) return [];

    const options: SelectOption[] = [];
    for (const option of maybeOptions) {
      if (!option || typeof option !== 'object') continue;
      const label = String((option as { label?: unknown }).label ?? '').trim();
      const value = (option as { value?: unknown }).value;
      if (!label) continue;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
      options.push({ label, value });
    }
    return options;
  }

  protected onArgChanged(commandId: string, arg: CmdrCustomCommandUiArg, rawValue: unknown): void {
    this.argChanged.emit({ commandId, arg, rawValue });
  }

  protected onSliderRelease(command: CmdrCustomCommandUiItem): void {
    if (!this.commandSendOnRelease(command)) return;
    this.sliderReleased.emit(command);
  }

  protected onRunCommand(command: CmdrCustomCommandUiItem): void {
    this.commandRunRequested.emit(command);
  }

  protected canShowMasterSlider(group: GroupedCommandGroup): boolean {
    return this.volumeGroupEntries(group).length > 1;
  }

  protected groupMasterValue(group: GroupedCommandGroup): number {
    const entries = this.volumeGroupEntries(group);
    if (entries.length < 2) return 0;
    const avg = entries.reduce((sum, entry) => sum + entry.currentValue, 0) / entries.length;
    return Math.round(avg);
  }

  protected groupMasterMin(group: GroupedCommandGroup): number {
    const entries = this.volumeGroupEntries(group);
    if (!entries.length) return 0;
    return entries.reduce((min, entry) => Math.min(min, entry.min), entries[0].min);
  }

  protected groupMasterMax(group: GroupedCommandGroup): number {
    const entries = this.volumeGroupEntries(group);
    if (!entries.length) return 100;
    return entries.reduce((max, entry) => Math.max(max, entry.max), entries[0].max);
  }

  protected groupMasterStep(group: GroupedCommandGroup): number {
    const entries = this.volumeGroupEntries(group);
    if (!entries.length) return 1;
    return entries.reduce((step, entry) => Math.min(step, entry.step), entries[0].step);
  }

  protected onGroupMasterPreview(group: GroupedCommandGroup, rawValue: unknown): void {
    const changes = this.computeMasterChanges(group, rawValue);
    if (changes.length === 0) return;
    this.masterPreviewChanged.emit(changes);
  }

  protected onGroupMasterRelease(group: GroupedCommandGroup, rawValue: unknown): void {
    const changes = this.computeMasterChanges(group, rawValue);
    if (changes.length === 0) return;
    const commandById = new Map(group.commands.map((command) => [command.id, command]));
    const commands: CmdrCustomCommandUiItem[] = [];
    for (const change of changes) {
      const command = commandById.get(change.commandId);
      if (!command || commands.some((candidate) => candidate.id === command.id)) continue;
      commands.push(command);
    }
    this.masterReleased.emit({ changes, commands });
  }

  protected commandSendOnRelease(command: CmdrCustomCommandUiItem): boolean {
    return command.send_on_release === true;
  }

  private volumeGroupEntries(group: GroupedCommandGroup): VolumeSliderEntry[] {
    const entries: VolumeSliderEntry[] = [];
    for (const command of group.commands) {
      if (!this.isVolumeCommand(command)) continue;
      for (const arg of command.args ?? []) {
        if (!this.isVolumeSliderArg(arg)) continue;
        const value = Number(this.commandArgValue(command.id, arg));
        entries.push({
          commandId: command.id,
          command,
          arg,
          min: typeof arg.min === 'number' ? arg.min : 0,
          max: typeof arg.max === 'number' ? arg.max : 100,
          step: typeof arg.step === 'number' && arg.step > 0 ? arg.step : 1,
          currentValue: Number.isFinite(value) ? value : 0,
        });
      }
    }
    return entries;
  }

  private isVolumeCommand(command: CmdrCustomCommandUiItem): boolean {
    const id = (command.id ?? '').toLowerCase();
    const wire = (command.wire_template ?? '').toLowerCase();
    return (
      id === 'set_volumes' ||
      id.startsWith('set_volume') ||
      (wire.includes('cmd;setvolume;') && wire.includes('player='))
    );
  }

  private isVolumeSliderArg(arg: CmdrCustomCommandUiArg): boolean {
    return (arg.control ?? 'number') === 'slider';
  }

  private computeMasterChanges(group: GroupedCommandGroup, rawValue: unknown): FixtureCustomArgChangedEvent[] {
    const entries = this.volumeGroupEntries(group);
    if (entries.length < 2) return [];
    const target = Number(rawValue);
    if (!Number.isFinite(target)) return [];
    const currentAverage = entries.reduce((sum, entry) => sum + entry.currentValue, 0) / entries.length;
    const nextValues =
      currentAverage <= 0
        ? entries.map((entry) => this.snapClamp(target, entry.min, entry.max, entry.step))
        : entries.map((entry) =>
            this.snapClamp(entry.currentValue * (target / currentAverage), entry.min, entry.max, entry.step),
          );
    return entries.map((entry, index) => ({
      commandId: entry.commandId,
      arg: entry.arg,
      rawValue: nextValues[index],
    }));
  }

  private snapClamp(value: number, min: number, max: number, step: number): number {
    const bounded = Math.min(Math.max(value, min), max);
    if (!Number.isFinite(step) || step <= 0) return Math.round(bounded);
    const snapped = Math.round((bounded - min) / step) * step + min;
    const fixed = Number(snapped.toFixed(6));
    return Math.min(Math.max(fixed, min), max);
  }

  private defaultValueForArg(arg: CmdrCustomCommandUiArg): FixtureCustomControlValue {
    const control = arg.control ?? 'number';
    if (typeof arg.default === 'number' || typeof arg.default === 'boolean') {
      return arg.default;
    }
    if (typeof arg.default === 'string') {
      return control === 'number' ? Number(arg.default) : arg.default;
    }

    if (control === 'checkbox') return false;
    if (typeof arg.min === 'number') return arg.min;
    return 0;
  }
}
