import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { CheckboxModule } from 'primeng/checkbox';
import { ColorPickerModule } from 'primeng/colorpicker';
import { DialogModule } from 'primeng/dialog';
import { CmdrCustomCommandUiArg, CmdrCustomCommandUiItem } from '../../api/cmdr-models';
import { BitmaskDotsComponent } from '../bitmask-dots/bitmask-dots.component';

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
  modeOrder: number;
  mode: CommandUiMode | null;
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

interface StatusArgRow {
  key: string;
  args: CmdrCustomCommandUiArg[];
}

type CommandUiMode = 'control' | 'status' | 'action';
type CommandUiBlock = 'rgb' | 'dimmer' | string;

@Component({
  selector: 'app-fixture-custom-control',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    ButtonModule,
    SelectModule,
    SliderModule,
    CheckboxModule,
    ColorPickerModule,
    DialogModule,
    BitmaskDotsComponent,
  ],
  templateUrl: './fixture-custom-control.component.html',
  styleUrl: './fixture-custom-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixtureCustomControlComponent {
  readonly commands = input<CmdrCustomCommandUiItem[]>([]);
  readonly liveValues = input<Record<string, Record<string, FixtureCustomControlValue>>>({});
  readonly values = input<Record<string, Record<string, FixtureCustomControlValue>>>({});
  readonly loading = input(false);
  readonly disabled = input(false);
  protected readonly controlsDisabled = computed(() => this.loading() || this.disabled());

  protected readonly pendingConfirmCommand = signal<CmdrCustomCommandUiItem | null>(null);

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
    const modeOrderFor = (command: CmdrCustomCommandUiItem): number => {
      const mode = this.commandUiMode(command);
      if (mode === 'action') return 10;
      if (mode === 'control') return 20;
      return 30;
    };
    const modeSuffixFor = (command: CmdrCustomCommandUiItem): string => {
      const mode = this.commandUiMode(command);
      if (mode === 'action') return 'Actions';
      if (mode === 'control') return 'Controls';
      return 'Commands';
    };

    for (const cmd of this.commands()) {
      if (this.isInlineStatusCommand(cmd)) continue;
      const explicitGroup = (cmd.group ?? '').trim();
      const normalizedGroup = explicitGroup.toLowerCase();
      const fallbackVolumeGroup = !explicitGroup && isVolumeCommand(cmd);
      const fallbackPlayTracksGroup = !explicitGroup && isPlayTracksCommand(cmd);
      const isVolumeGroup = normalizedGroup === 'volume' || fallbackVolumeGroup;
      const isPlayTracksGroup =
        normalizedGroup === 'play tracks' ||
        normalizedGroup === 'play_tracks' ||
        fallbackPlayTracksGroup;

      const modeSuffix = modeSuffixFor(cmd);
      const key = isVolumeGroup
        ? '__set_volumes__'
        : isPlayTracksGroup
          ? '__play_tracks__'
          : (explicitGroup ? `${explicitGroup}__${modeSuffix.toLowerCase()}` : null);
      const label = isVolumeGroup
        ? 'Set volumes'
        : isPlayTracksGroup
          ? 'Play Tracks'
          : explicitGroup
            ? `${explicitGroup} ${modeSuffix}`
            : modeSuffix;
      const layout: 'paired' | 'full' = isVolumeGroup || isPlayTracksGroup ? 'paired' : 'full';
      const modeOrder = isVolumeGroup || isPlayTracksGroup ? 25 : modeOrderFor(cmd);

      if (key) {
        const existing = groups.find((group) => group.key === key);
        if (existing) {
          existing.commands.push(cmd);
        } else {
          groups.push({ key, label, layout, modeOrder, mode: this.commandUiMode(cmd), commands: [cmd] });
        }
      } else {
        groups.push({
          key: cmd.id,
          label: cmd.label,
          layout: 'full',
          modeOrder,
          mode: this.commandUiMode(cmd),
          commands: [cmd],
        });
      }
    }

    return groups.sort((a, b) => {
      if (a.modeOrder !== b.modeOrder) return a.modeOrder - b.modeOrder;
      return a.label.localeCompare(b.label);
    });
  });

  protected readonly inlineStatusCommands = computed<CmdrCustomCommandUiItem[]>(() =>
    this.commands().filter((command) => this.isInlineStatusCommand(command)),
  );

  protected draftCommandArgValue(commandId: string, arg: CmdrCustomCommandUiArg): FixtureCustomControlValue {
    const commandValues = this.values()[commandId];
    if (commandValues && arg.name in commandValues) {
      return commandValues[arg.name];
    }
    return this.defaultValueForArg(arg);
  }

  protected liveCommandArgValue(commandId: string, arg: CmdrCustomCommandUiArg): FixtureCustomControlValue {
    const commandValues = this.liveValues()[commandId];
    if (commandValues && arg.name in commandValues) {
      return commandValues[arg.name];
    }
    return this.defaultValueForArg(arg);
  }

  protected isStatusDotArg(arg: CmdrCustomCommandUiArg): boolean {
    return String(arg.control ?? '').toLowerCase() === 'dot';
  }

  protected isStatusDisplayArg(arg: CmdrCustomCommandUiArg): boolean {
    return String(arg.control ?? '').toLowerCase() === 'display';
  }

  protected isStatusBitmaskDotsArg(arg: CmdrCustomCommandUiArg): boolean {
    const control = String(arg.control ?? '').trim().toLowerCase();
    return control === 'bitmask_dots' || control === 'bitmask-dots';
  }

  protected statusBitmaskArgs(command: CmdrCustomCommandUiItem): CmdrCustomCommandUiArg[] {
    return (command.args ?? []).filter((arg) => this.isStatusBitmaskDotsArg(arg));
  }

  protected statusNonBitmaskArgs(command: CmdrCustomCommandUiItem): CmdrCustomCommandUiArg[] {
    return (command.args ?? []).filter((arg) => !this.isStatusBitmaskDotsArg(arg));
  }

  protected statusNonBitmaskRows(command: CmdrCustomCommandUiItem): StatusArgRow[] {
    const rows = new Map<string, CmdrCustomCommandUiArg[]>();
    for (const arg of this.statusNonBitmaskArgs(command)) {
      const rawRow = (arg as unknown as { status_row?: unknown }).status_row;
      const key = typeof rawRow === 'string' && rawRow.trim().length > 0 ? rawRow.trim() : 'default';
      const existing = rows.get(key);
      if (existing) {
        existing.push(arg);
      } else {
        rows.set(key, [arg]);
      }
    }
    return Array.from(rows.entries()).map(([key, args]) => ({ key, args }));
  }

  protected statusBitCount(arg: CmdrCustomCommandUiArg): number {
    const raw = Number((arg as unknown as { bit_count?: unknown }).bit_count);
    if (!Number.isFinite(raw)) return 12;
    return Math.max(1, Math.min(32, Math.trunc(raw)));
  }

  protected statusBitmaskValue(commandId: string, arg: CmdrCustomCommandUiArg): number {
    const raw = this.liveCommandArgValue(commandId, arg);
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === 'string') {
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return 0;
  }

  protected isStatusSliderArg(arg: CmdrCustomCommandUiArg): boolean {
    return String(arg.control ?? '').toLowerCase() === 'slider';
  }

  protected statusSliderValue(commandId: string, arg: CmdrCustomCommandUiArg): number {
    const raw = Number(this.liveCommandArgValue(commandId, arg));
    if (!Number.isFinite(raw)) return 0;
    return this.clampArgToRange(raw, arg);
  }

  protected statusSliderMin(arg: CmdrCustomCommandUiArg): number {
    return typeof arg.min === 'number' ? arg.min : 0;
  }

  protected statusSliderMax(arg: CmdrCustomCommandUiArg): number {
    return typeof arg.max === 'number' ? arg.max : 255;
  }

  protected statusSliderStep(arg: CmdrCustomCommandUiArg): number {
    return typeof arg.step === 'number' && arg.step > 0 ? arg.step : 1;
  }

  protected statusDotOn(commandId: string, arg: CmdrCustomCommandUiArg): boolean {
    return this.toBooleanLike(this.liveCommandArgValue(commandId, arg));
  }

  protected statusDisplaySuffix(arg: CmdrCustomCommandUiArg): string {
    const suffix = (arg as unknown as { suffix?: unknown }).suffix;
    return typeof suffix === 'string' ? suffix : '';
  }

  protected statusDisplayText(commandId: string, arg: CmdrCustomCommandUiArg): string {
    const value = this.liveCommandArgValue(commandId, arg);
    const optionLabel = this.optionLabelForValue(arg, value);
    if (optionLabel) return optionLabel;
    const explicitSuffix = this.statusDisplaySuffix(arg);
    if (explicitSuffix) return `${value}${explicitSuffix}`;
    if (typeof value === 'number' && this.isSecondsLikeArgName(arg.name)) {
      return `${value}s`;
    }
    return `${value}`;
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

  private optionLabelForValue(arg: CmdrCustomCommandUiArg, rawValue: unknown): string | null {
    const options = this.selectOptions(arg);
    if (!options.length) return null;
    const direct = options.find((option) => option.value === rawValue);
    if (direct) return direct.label;
    const canonical = String(rawValue).trim();
    const loose = options.find((option) => String(option.value).trim() === canonical);
    return loose?.label ?? null;
  }

  protected onArgChanged(commandId: string, arg: CmdrCustomCommandUiArg, rawValue: unknown): void {
    this.argChanged.emit({ commandId, arg, rawValue });
  }

  protected isInputArg(arg: CmdrCustomCommandUiArg): boolean {
    const control = String(arg.control ?? 'number').toLowerCase();
    return control === 'slider' || control === 'number' || control === 'select' || control === 'checkbox';
  }

  protected hasStatePath(arg: CmdrCustomCommandUiArg): boolean {
    const statePath = (arg as { state_path?: unknown }).state_path;
    return typeof statePath === 'string' && statePath.trim().length > 0;
  }

  protected isSettableCommand(command: CmdrCustomCommandUiItem): boolean {
    return this.commandUiMode(command) === 'control';
  }

  protected settableLiveArgs(command: CmdrCustomCommandUiItem): CmdrCustomCommandUiArg[] {
    const args = (command.args ?? []).filter((arg) => this.isInputArg(arg) && this.hasStatePath(arg));
    const block = this.commandUiBlock(command);
    if (block === 'rgb') {
      return args.filter((arg) => this.toRgbChannel(arg.name) !== null);
    }
    if (block === 'dimmer') {
      return args.filter((arg) => this.isDimmerArg(arg));
    }
    return args;
  }

  protected settableEditArgs(command: CmdrCustomCommandUiItem): CmdrCustomCommandUiArg[] {
    const args = (command.args ?? []).filter((arg) => this.isInputArg(arg));
    const block = this.commandUiBlock(command);
    if (block === 'rgb') {
      return args.filter((arg) => this.toRgbChannel(arg.name) !== null);
    }
    if (block === 'dimmer') {
      return args.filter((arg) => this.isDimmerArg(arg));
    }
    return args;
  }

  protected shouldRenderLiveSetBlock(command: CmdrCustomCommandUiItem): boolean {
    return this.isSettableCommand(command);
  }

  protected isSettableRgbChannelArg(arg: CmdrCustomCommandUiArg): boolean {
    return this.toRgbChannel(arg.name) !== null;
  }

  protected hasSettableDimmer(command: CmdrCustomCommandUiItem): boolean {
    return this.commandUiBlock(command) === 'dimmer' && this.dimmerArg(command) !== null;
  }

  protected draftCommandDimmerValue(command: CmdrCustomCommandUiItem): number {
    const arg = this.dimmerArg(command);
    if (!arg) return 0;
    const raw = Number(this.draftCommandArgValue(command.id, arg));
    if (!Number.isFinite(raw)) return 0;
    return this.clampArgToRange(raw, arg);
  }

  protected liveCommandDimmerValue(command: CmdrCustomCommandUiItem): number {
    const arg = this.dimmerArg(command);
    if (!arg) return 0;
    const raw = Number(this.liveCommandArgValue(command.id, arg));
    if (!Number.isFinite(raw)) return 0;
    return this.clampArgToRange(raw, arg);
  }

  protected liveSettableArgText(commandId: string, arg: CmdrCustomCommandUiArg): string {
    const value = this.liveCommandArgValue(commandId, arg);
    if (arg.control === 'checkbox') {
      return this.toBooleanLike(value) ? 'On' : 'Off';
    }
    const optionLabel = this.optionLabelForValue(arg, value);
    if (optionLabel) return optionLabel;
    return `${value}`;
  }

  protected hasSettableRgb(command: CmdrCustomCommandUiItem): boolean {
    return (
      this.commandUiBlock(command) === 'rgb' &&
      this.rgbArg(command, 'r') !== null &&
      this.rgbArg(command, 'g') !== null &&
      this.rgbArg(command, 'b') !== null
    );
  }

  protected shouldHideGenericArgControl(command: CmdrCustomCommandUiItem, arg: CmdrCustomCommandUiArg): boolean {
    return this.isSettableCommand(command) && this.isInputArg(arg);
  }

  protected draftCommandRgbHexValue(command: CmdrCustomCommandUiItem): string {
    const r = this.draftCommandRgbChannelValue(command, 'r');
    const g = this.draftCommandRgbChannelValue(command, 'g');
    const b = this.draftCommandRgbChannelValue(command, 'b');
    return `${this.toHexByte(r)}${this.toHexByte(g)}${this.toHexByte(b)}`;
  }

  protected liveCommandRgbHexValue(command: CmdrCustomCommandUiItem): string {
    const r = this.liveCommandRgbChannelValue(command, 'r');
    const g = this.liveCommandRgbChannelValue(command, 'g');
    const b = this.liveCommandRgbChannelValue(command, 'b');
    return `${this.toHexByte(r)}${this.toHexByte(g)}${this.toHexByte(b)}`;
  }

  protected draftCommandRgbChannelValue(
    command: CmdrCustomCommandUiItem,
    channel: 'r' | 'g' | 'b',
  ): number {
    const arg = this.rgbArg(command, channel);
    if (!arg) return 0;
    const raw = Number(this.draftCommandArgValue(command.id, arg));
    if (!Number.isFinite(raw)) return 0;
    return this.clampArgToRange(raw, arg);
  }

  protected liveCommandRgbChannelValue(
    command: CmdrCustomCommandUiItem,
    channel: 'r' | 'g' | 'b',
  ): number {
    const arg = this.rgbArg(command, channel);
    if (!arg) return 0;
    const raw = Number(this.liveCommandArgValue(command.id, arg));
    if (!Number.isFinite(raw)) return 0;
    return this.clampArgToRange(raw, arg);
  }

  protected onCommandRgbHexChanged(command: CmdrCustomCommandUiItem, rawValue: unknown): void {
    if (typeof rawValue !== 'string') return;
    const parsed = this.parseHexColor(rawValue);
    if (!parsed) return;
    this.onCommandRgbChannelChanged(command, 'r', parsed.r);
    this.onCommandRgbChannelChanged(command, 'g', parsed.g);
    this.onCommandRgbChannelChanged(command, 'b', parsed.b);
  }

  protected onCommandRgbChannelChanged(
    command: CmdrCustomCommandUiItem,
    channel: 'r' | 'g' | 'b',
    rawValue: unknown,
  ): void {
    const arg = this.rgbArg(command, channel);
    if (!arg) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    this.onArgChanged(command.id, arg, this.clampArgToRange(value, arg));
  }

  protected onSliderRelease(command: CmdrCustomCommandUiItem): void {
    if (!this.commandSendOnRelease(command)) return;
    this.sliderReleased.emit(command);
  }

  protected onRunCommand(command: CmdrCustomCommandUiItem): void {
    if (command.confirm) {
      this.pendingConfirmCommand.set(command);
    } else {
      this.commandRunRequested.emit(command);
    }
  }

  protected onConfirmYes(): void {
    const command = this.pendingConfirmCommand();
    this.pendingConfirmCommand.set(null);
    if (command) {
      this.commandRunRequested.emit(command);
    }
  }

  protected onConfirmNo(): void {
    this.pendingConfirmCommand.set(null);
  }

  protected numberInputWidthCh(arg: CmdrCustomCommandUiArg): number {
    const candidates: number[] = [];
    const maybeValues = [arg.default, arg.min, arg.max, arg.step];
    for (const value of maybeValues) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        candidates.push(String(Math.trunc(value)).length);
      } else if (typeof value === 'string' && value.trim()) {
        candidates.push(value.trim().length);
      }
    }
    const widest = candidates.length > 0 ? Math.max(...candidates) : 4;
    return Math.min(Math.max(widest + 2, 5), 8);
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

  private isInlineStatusCommand(command: CmdrCustomCommandUiItem): boolean {
    if (this.commandUiMode(command) === 'status') return true;
    const group = String(command.group ?? '').trim().toLowerCase();
    return group === 'status' || group === 'inline_status' || group === 'inline status';
  }

  private commandUiMode(command: CmdrCustomCommandUiItem): CommandUiMode | null {
    const mode = String(command.ui_mode ?? '').trim().toLowerCase();
    if (mode === 'control' || mode === 'status' || mode === 'action') {
      return mode;
    }
    return null;
  }

  private commandUiBlock(command: CmdrCustomCommandUiItem): string | null {
    const block = String(command.control ?? '').trim().toLowerCase();
    return block || null;
  }

  private isDimmerArg(arg: CmdrCustomCommandUiArg): boolean {
    const name = String(arg.name ?? '').trim().toLowerCase();
    return name === 'dimmer';
  }

  private volumeGroupEntries(group: GroupedCommandGroup): VolumeSliderEntry[] {
    const entries: VolumeSliderEntry[] = [];
    for (const command of group.commands) {
      if (!this.isVolumeCommand(command)) continue;
      for (const arg of command.args ?? []) {
        if (!this.isVolumeSliderArg(arg)) continue;
        const value = Number(this.draftCommandArgValue(command.id, arg));
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

  private toBooleanLike(rawValue: unknown): boolean {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'number') return rawValue !== 0;
    if (typeof rawValue === 'string') {
      const lowered = rawValue.trim().toLowerCase();
      return lowered === '1' || lowered === 'true' || lowered === 'yes' || lowered === 'on';
    }
    return false;
  }

  private isSecondsLikeArgName(name: string): boolean {
    const normalized = String(name || '').trim().toLowerCase();
    return normalized.endsWith('sec') || normalized.endsWith('secs') || normalized.endsWith('seconds');
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

  private toRgbChannel(name: string): 'r' | 'g' | 'b' | null {
    const normalized = name.trim().toLowerCase();
    if (normalized === 'r' || normalized === 'g' || normalized === 'b') {
      return normalized;
    }
    return null;
  }

  private rgbArg(
    command: CmdrCustomCommandUiItem,
    channel: 'r' | 'g' | 'b',
  ): CmdrCustomCommandUiArg | null {
    return this.settableEditArgs(command).find((arg) => this.toRgbChannel(arg.name) === channel) ?? null;
  }

  protected dimmerArg(command: CmdrCustomCommandUiItem): CmdrCustomCommandUiArg | null {
    return this.settableEditArgs(command).find((arg) => this.isDimmerArg(arg)) ?? null;
  }

  private clampArgToRange(value: number, arg: CmdrCustomCommandUiArg): number {
    const min = typeof arg.min === 'number' ? arg.min : 0;
    const max = typeof arg.max === 'number' ? arg.max : 255;
    const step = typeof arg.step === 'number' && arg.step > 0 ? arg.step : 1;
    const bounded = Math.min(Math.max(value, min), max);
    if (!Number.isFinite(step) || step <= 0) {
      return Math.round(bounded);
    }
    const snapped = Math.round((bounded - min) / step) * step + min;
    const fixed = Number(snapped.toFixed(6));
    return Math.min(Math.max(fixed, min), max);
  }

  private toHexByte(value: number): string {
    const bounded = Math.min(Math.max(Math.round(value), 0), 255);
    return bounded.toString(16).padStart(2, '0');
  }

  private parseHexColor(raw: string): { r: number; g: number; b: number } | null {
    const trimmed = raw.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
    const r = parseInt(trimmed.slice(0, 2), 16);
    const g = parseInt(trimmed.slice(2, 4), 16);
    const b = parseInt(trimmed.slice(4, 6), 16);
    return { r, g, b };
  }
}
