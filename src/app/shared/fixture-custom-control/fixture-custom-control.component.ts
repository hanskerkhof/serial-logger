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

  protected readonly groupedCommands = computed<
    { key: string; label: string; layout: 'paired' | 'full'; commands: CmdrCustomCommandUiItem[] }[]
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

    const groups: { key: string; label: string; layout: 'paired' | 'full'; commands: CmdrCustomCommandUiItem[] }[] = [];

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

  protected commandSendOnRelease(command: CmdrCustomCommandUiItem): boolean {
    return command.send_on_release === true;
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
