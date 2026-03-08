import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import {
  CommanderApiService,
  CommanderExposedPlan,
  CommanderLanGroup,
  CommanderHealthResponse,
  CommanderApiTarget,
  CommanderQueryResponse,
  FixturePlanActionResponse,
} from '../../commander-api.service';
import { FixtureRecord, FixtureSource, FixtureStoreService } from '../../fixture-store.service';
import { CommanderConsoleComponent } from './commander-console/commander-console.component';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-commander',
  standalone: true,
  imports: [FormsModule, JsonPipe, ButtonModule, InputTextModule, SelectModule, CommanderConsoleComponent],
  templateUrl: './commander.component.html',
  styleUrls: ['./commander.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommanderComponent implements OnInit {
  protected readonly loading = signal(true);
  protected readonly queryLoading = signal(false);
  protected readonly discoveryLoading = signal(false);
  protected readonly health = signal<CommanderHealthResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly customUrl = signal('');
  protected readonly fixtureName = signal('CLIGNOTEUR1');
  protected readonly planName = signal('TRIPTYCH');
  protected readonly planGroupName = signal('');
  protected readonly exposedPlans = signal<CommanderExposedPlan[]>([]);
  protected readonly lanGroups = signal<CommanderLanGroup[]>([]);
  protected readonly planListLoading = signal(false);
  protected readonly lanGroupListLoading = signal(false);
  protected readonly queryResult = signal<CommanderQueryResponse | null>(null);
  protected readonly fixtureActionLoading = signal(false);
  protected readonly fixtureActionMessage = signal<string | null>(null);
  protected readonly fixtureActionResult = signal<FixturePlanActionResponse | null>(null);
  protected readonly fixtureActionDurationMs = signal<number | null>(null);
  protected readonly manualCommand = signal('');
  protected readonly modalQueryLoading = signal(false);
  protected readonly modalQueryError = signal<string | null>(null);

  @ViewChild('fixtureDetailDialog') fixtureDetailDialog!: ElementRef<HTMLDialogElement>;

  private readonly commanderApi = inject(CommanderApiService);
  private readonly fixtureStore = inject(FixtureStoreService);

  protected readonly targets: readonly CommanderApiTarget[] = this.commanderApi.targets;
  protected readonly activeApiUrl = this.commanderApi.apiBaseUrl;
  protected readonly groupedFixtures = this.fixtureStore.fixturesGroupedByPlanName;
  protected readonly selectedFixtureName = this.fixtureStore.selectedFixtureName;
  protected readonly selectedFixture = this.fixtureStore.selectedFixture;
  protected readonly fixtureCount = this.fixtureStore.fixtureCount;
  protected readonly storageWarning = this.fixtureStore.storageWarning;
  protected readonly exposedPlansByGroup = computed(() => {
    const grouped = new Map<string, CommanderExposedPlan[]>();
    for (const plan of this.exposedPlans()) {
      const groupName = (plan.plan_group || plan.plan_name).trim() || plan.plan_name;
      const list = grouped.get(groupName) ?? [];
      list.push(plan);
      grouped.set(groupName, list);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plan_group, plans]) => ({
        plan_group,
        plans: [...plans].sort((a, b) => a.plan_name.localeCompare(b.plan_name)),
      }));
  });
  protected readonly planOptions = computed<SelectOption[]>(() =>
    this.exposedPlans()
      .slice()
      .sort((a, b) => {
        const groupCompare = (a.plan_group || '').localeCompare(b.plan_group || '');
        return groupCompare !== 0 ? groupCompare : a.plan_name.localeCompare(b.plan_name);
      })
      .map((plan) => ({
        label: `${plan.plan_group} / ${plan.plan_name} (${plan.fixture_count})`,
        value: plan.plan_name,
      })),
  );
  protected readonly planGroupOptions = computed<SelectOption[]>(() =>
    this.lanGroups()
      .slice()
      .sort((a, b) => a.plan_group.localeCompare(b.plan_group))
      .map((group) => ({
        label: `${group.plan_group} (u${group.universe}, ${group.fixture_count})`,
        value: group.plan_group,
      })),
  );
  protected readonly selectedFixtureJson = computed(() => {
    const selected = this.selectedFixture();
    return selected ? JSON.stringify(selected.raw, null, 2) : '';
  });

  ngOnInit(): void {
    this.customUrl.set(this.activeApiUrl());
    this.loadHealth();
    this.loadExposedPlans();
    this.loadLanGroups();
  }

  protected reloadHealth(): void {
    this.loadHealth();
  }

  protected useTarget(url: string): void {
    this.commanderApi.setApiBaseUrl(url);
    this.customUrl.set(this.activeApiUrl());
    this.loadHealth();
    this.loadExposedPlans();
    this.loadLanGroups();
  }

  protected applyCustomUrl(): void {
    const ok = this.commanderApi.setApiBaseUrl(this.customUrl());
    if (!ok) {
      this.error.set('Invalid API URL. Use host[:port] or http(s)://host[:port].');
      return;
    }

    this.customUrl.set(this.activeApiUrl());
    this.loadHealth();
    this.loadExposedPlans();
    this.loadLanGroups();
  }

  protected runFixtureQuery(): void {
    const fixture = this.fixtureName().trim();
    if (!fixture) {
      this.error.set('Fixture name is required.');
      return;
    }

    this.queryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getFixtureVersion(fixture).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'fixture_query');
        this.queryLoading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError(`Fixture query failed for ${fixture}`, err));
        this.queryResult.set(null);
        this.queryLoading.set(false);
      },
    });
  }

  protected runFullDiscovery(): void {
    this.discoveryLoading.set(true);
    this.error.set(null);

    this.commanderApi.getFixtureDiscovery().subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'discovery_query');
        this.discoveryLoading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError('Full discovery failed', err));
        this.discoveryLoading.set(false);
      },
    });
  }

  protected runPlanQuery(): void {
    const plan = this.planName().trim();
    if (!plan) {
      this.error.set('Plan name is required.');
      return;
    }

    this.queryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getPlanVersions(plan).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'plan_query');
        this.queryLoading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError(`Plan query failed for ${plan}`, err));
        this.queryResult.set(null);
        this.queryLoading.set(false);
      },
    });
  }

  protected onPlanSelected(value: string): void {
    this.planName.set(value);
  }

  protected onPlanGroupSelected(value: string): void {
    this.planGroupName.set(value);
  }

  protected runPlanGroupQuery(): void {
    const planGroup = this.planGroupName().trim();
    if (!planGroup) {
      this.error.set('Plan group is required.');
      return;
    }

    this.queryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getPlanGroupVersions(planGroup).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'plan_group_query');
        this.queryLoading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError(`Plan group query failed for ${planGroup}`, err));
        this.queryResult.set(null);
        this.queryLoading.set(false);
      },
    });
  }

  protected queryResultJson(): string {
    const result = this.queryResult();
    return result ? JSON.stringify(result, null, 2) : '';
  }

  protected selectFixture(record: FixtureRecord): void {
    this.fixtureStore.setSelectedFixture(record.fixture_name);
    this.fixtureName.set(record.fixture_name);
    this.openFixtureModal();
  }

  protected removeFixture(record: FixtureRecord, event: Event): void {
    event.stopPropagation();
    const wasSelected = this.selectedFixtureName() === record.fixture_name;
    this.fixtureStore.removeFixture(record.fixture_name);

    if (wasSelected) {
      this.fixtureName.set('');
      this.closeFixtureModal();
    }
  }

  protected removePlan(planName: string, event: Event): void {
    event.stopPropagation();
    const selected = this.selectedFixture();
    this.fixtureStore.removePlan(planName);

    if (selected?.plan_name === planName) {
      this.fixtureName.set('');
      this.closeFixtureModal();
    }
  }

  protected closeFixtureModal(): void {
    this.fixtureDetailDialog?.nativeElement?.close();
    this.modalQueryLoading.set(false);
    this.modalQueryError.set(null);
  }

  protected runModalFixtureQuery(): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) {
      this.modalQueryError.set('No fixture selected.');
      return;
    }

    this.modalQueryLoading.set(true);
    this.modalQueryError.set(null);

    this.commanderApi.getFixtureVersion(fixture).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        this.ingestQueryResult(result, 'fixture_query');
        this.modalQueryLoading.set(false);
      },
      error: (err: unknown) => {
        const text = this.formatError('Fixture query failed', err);
        const compact = text.length > 180 ? `${text.slice(0, 177)}...` : text;
        this.modalQueryError.set(compact);
        this.modalQueryLoading.set(false);
      },
    });
  }

  protected runModalPlanAction(action: 'trigger' | 'stop'): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) {
      this.fixtureActionMessage.set('No fixture selected.');
      return;
    }

    this.fixtureActionLoading.set(true);
    this.fixtureActionMessage.set(null);
    this.fixtureActionResult.set(null);

    const command = `cmd;plan;action=${action};`;
    this.sendCommand(fixture, command);
  }

  protected runManualCommand(): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    const command = this.manualCommand().trim();

    if (!fixture) {
      this.fixtureActionMessage.set('No fixture selected.');
      return;
    }
    if (!command) {
      this.fixtureActionMessage.set('Command is required.');
      return;
    }

    this.sendCommand(fixture, command);
  }

  private openFixtureModal(): void {
    const dialog = this.fixtureDetailDialog?.nativeElement;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  private ingestQueryResult(result: CommanderQueryResponse, source: FixtureSource): void {
    const fixtures = this.extractFixtures(result, source);
    if (!fixtures.length) {
      return;
    }

    this.fixtureStore.upsertFixtures(fixtures);
  }

  private extractFixtures(result: CommanderQueryResponse, source: FixtureSource): FixtureRecord[] {
    const summary = this.getSummary(result);
    if (!summary || typeof summary !== 'object') {
      return [];
    }

    const extracted = this.extractFixturePayloads(summary);
    if (!extracted.length) {
      return [];
    }

    const now = new Date().toISOString();
    const records: FixtureRecord[] = [];

    for (const item of extracted) {
      const fixture_name = this.readString(item, 'fixture_name');
      const plan_name = this.readString(item, 'plan_name');

      if (!fixture_name) {
        this.error.set(`Fixture payload missing fixture_name: ${JSON.stringify(item)}`);
        continue;
      }
      if (!plan_name) {
        this.error.set(`Fixture payload missing plan_name for ${fixture_name}.`);
        continue;
      }

      records.push({
        fixture_name,
        plan_name,
        raw: item,
        lastUpdatedAt: now,
        source,
      });
    }

    return records;
  }

  private getSummary(result: CommanderQueryResponse): unknown {
    return typeof result === 'object' && result !== null && 'summary' in result
      ? (result as { summary?: unknown }).summary
      : null;
  }

  private extractFixturePayloads(summary: unknown): Record<string, unknown>[] {
    if (typeof summary !== 'object' || summary === null) {
      return [];
    }

    const asSummary = summary as { fixtures?: unknown; fixture_name?: unknown };

    if (Array.isArray(asSummary.fixtures)) {
      return asSummary.fixtures.filter((item): item is Record<string, unknown> => {
        return typeof item === 'object' && item !== null;
      });
    }

    if (typeof asSummary.fixture_name === 'string') {
      return [summary as Record<string, unknown>];
    }

    return [];
  }

  private readString(item: Record<string, unknown>, key: string): string | null {
    const value = item[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private loadHealth(): void {
    this.loading.set(true);
    this.error.set(null);

    this.commanderApi.getHealth().subscribe({
      next: (result) => {
        this.health.set(result);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.formatError(`Health check failed for ${this.activeApiUrl()}`, err));
        this.health.set(null);
        this.loading.set(false);
      },
    });
  }

  private loadExposedPlans(): void {
    this.planListLoading.set(true);
    this.commanderApi.getExposedPlans().subscribe({
      next: (result) => {
        const plans = Array.isArray(result.plans) ? result.plans : [];
        this.exposedPlans.set(plans);
        this.syncSelectedPlan(plans);
        this.planListLoading.set(false);
      },
      error: (err: unknown) => {
        this.exposedPlans.set([]);
        this.planListLoading.set(false);
        this.error.set(this.formatError(`Plan list load failed for ${this.activeApiUrl()}`, err));
      },
    });
  }

  private loadLanGroups(): void {
    this.lanGroupListLoading.set(true);
    this.commanderApi.getLanGroups().subscribe({
      next: (result) => {
        const groups = Array.isArray(result.lan_groups) ? result.lan_groups : [];
        this.lanGroups.set(groups);
        this.syncSelectedPlanGroup(groups);
        this.lanGroupListLoading.set(false);
      },
      error: (err: unknown) => {
        this.lanGroups.set([]);
        this.lanGroupListLoading.set(false);
        this.error.set(this.formatError(`LAN group list load failed for ${this.activeApiUrl()}`, err));
      },
    });
  }

  private syncSelectedPlan(plans: CommanderExposedPlan[]): void {
    if (!plans.length) {
      this.planName.set('');
      return;
    }
    const current = this.planName().trim();
    if (!current || !plans.some((item) => item.plan_name === current)) {
      this.planName.set(plans[0].plan_name);
    }
  }

  private syncSelectedPlanGroup(groups: CommanderLanGroup[]): void {
    if (!groups.length) {
      this.planGroupName.set('');
      return;
    }
    const current = this.planGroupName().trim();
    if (!current || !groups.some((item) => item.plan_group === current)) {
      this.planGroupName.set(groups[0].plan_group);
    }
  }

  private sendCommand(fixture: string, command: string): void {
    const trimmedCommand = command.trim();
    const wireCommand =
      trimmedCommand.startsWith('tcmd;') || trimmedCommand.startsWith('ack;tcmd;')
        ? trimmedCommand
        : `tcmd;${fixture};${trimmedCommand}`;

    this.fixtureActionLoading.set(true);
    this.fixtureActionMessage.set(null);
    this.fixtureActionResult.set(null);
    this.fixtureActionDurationMs.set(null);
    const startedAt = performance.now();

    this.commanderApi.runFixtureCommand(fixture, wireCommand).subscribe({
      next: (result) => {
        const durationMs = performance.now() - startedAt;
        this.fixtureActionDurationMs.set(durationMs);
        this.fixtureActionResult.set(result);

        const response = result as Record<string, unknown>;
        const routingMode =
          typeof response['routing_mode'] === 'string' ? (response['routing_mode'] as string) : 'direct';
        const commandResult =
          response['command_result'] && typeof response['command_result'] === 'object'
            ? (response['command_result'] as Record<string, unknown>)
            : null;
        const dispatchedWireCommand =
          commandResult && typeof commandResult['command'] === 'string'
            ? (commandResult['command'] as string)
            : wireCommand;

        this.fixtureActionMessage.set(`Command accepted for ${fixture} (${routingMode}): ${dispatchedWireCommand}`);
        this.fixtureActionLoading.set(false);
      },
      error: (err: unknown) => {
        const durationMs = performance.now() - startedAt;
        this.fixtureActionDurationMs.set(durationMs);
        this.fixtureActionMessage.set(this.formatError(`Command failed for ${fixture}: ${wireCommand}`, err));
        this.fixtureActionResult.set(null);
        this.fixtureActionLoading.set(false);
      },
    });
  }

  private formatError(prefix: string, err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const detail =
        typeof err.error === 'object' && err.error !== null && 'detail' in err.error
          ? (err.error as { detail?: unknown }).detail
          : err.error;
      const detailText =
        detail == null
          ? err.message
          : typeof detail === 'string'
            ? detail
            : JSON.stringify(detail, null, 2);

      if (err.status === 0) {
        return `${prefix} (Network/CORS): ${detailText}`;
      }

      return `${prefix} (HTTP ${err.status}): ${detailText}`;
    }

    if (err instanceof Error) {
      return `${prefix} (${err.name}: ${err.message})`;
    }

    if (typeof err === 'object' && err !== null) {
      return `${prefix}: ${JSON.stringify(err, null, 2)}`;
    }

    return `${prefix}: ${String(err)}`;
  }
}
