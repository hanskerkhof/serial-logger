import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { PanelModule } from 'primeng/panel';
import { MessageService } from 'primeng/api';
import {
  CommanderApiService,
  CommanderExposedPlan,
  CommanderLanGroup,
  CommanderHealthResponse,
  CommanderApiTarget,
  CommanderQueryResponse,
  FixturePlanActionResponse,
  RawCommandResponse,
} from '../../commander-api.service';
import {
  CmdrCustomCommandUiArg,
  CmdrCustomCommandUiItem,
  CmdrFixtureCapabilities,
  CmdrPlanControls,
  CmdrPlayerCapabilities,
} from '../../api/cmdr-models';
import { FixturePlanGroup, FixtureRecord, FixtureSource, FixtureStoreService } from '../../fixture-store.service';
import { CommanderConsoleComponent } from './commander-console/commander-console.component';
import { FixturePlayerControlsComponent } from '../../shared/fixture-player-controls/fixture-player-controls.component';

interface SelectOption {
  label: string;
  value: string;
}

type CustomCommandValue = string | number | boolean;

function compareVersions(a: string, b: string): number {
  const seg = (s: string) => s.replace(/^v/, '').split('.').map(Number);
  const [as_, bs_] = [seg(a), seg(b)];
  for (let i = 0; i < Math.max(as_.length, bs_.length); i++) {
    const diff = (as_[i] ?? 0) - (bs_[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

@Component({
  selector: 'app-commander',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputGroupModule, InputGroupAddonModule, InputTextModule, SelectModule, ToastModule, PanelModule, CommanderConsoleComponent, FixturePlayerControlsComponent],
  providers: [MessageService],
  templateUrl: './commander.component.html',
  styleUrls: ['./commander.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommanderComponent implements OnInit {
  protected readonly loading = signal(true);
  protected readonly healthRefreshing = signal(false);
  protected readonly healthError = signal<string | null>(null);
  protected readonly fixtureQueryLoading = signal(false);
  protected readonly planQueryLoading = signal(false);
  protected readonly planGroupQueryLoading = signal(false);
  protected readonly discoveryLoading = signal(false);
  protected readonly health = signal<CommanderHealthResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly customUrl = signal('');
  protected readonly fixtureName = signal(localStorage.getItem('cmdr.selectedFixture') ?? 'CLIGNOTEUR1');
  protected readonly planName = signal(localStorage.getItem('cmdr.selectedPlan') ?? 'TRIPTYCH');
  protected readonly planGroupName = signal(localStorage.getItem('cmdr.selectedPlanGroup') ?? '');
  protected readonly exposedPlans = signal<CommanderExposedPlan[]>([]);
  protected readonly lanGroups = signal<CommanderLanGroup[]>([]);
  protected readonly planListLoading = signal(false);
  protected readonly lanGroupListLoading = signal(false);
  protected readonly queryResult = signal<CommanderQueryResponse | null>(null);
  protected readonly fixtureActionLoading = signal(false);
  protected readonly fixtureActionMessage = signal<string | null>(null);
  protected readonly fixtureActionError = signal<string | null>(null);
  protected readonly fixtureActionResult = signal<FixturePlanActionResponse | null>(null);
  protected readonly fixtureActionDurationMs = signal<number | null>(null);
  protected readonly rebootConfirmPending = signal(false);
  private healthPollTimer: ReturnType<typeof setTimeout> | null = null;
  private healthRetryDelayMs = 3_000;
  private static readonly HEALTH_POLL_MS = 30_000;
  private static readonly HEALTH_INITIAL_RETRY_MS = 3_000;
  private static readonly HEALTH_MAX_RETRY_MS = 30_000;
  private readonly nextHealthPollAt = signal(Date.now() + 30_000);
  protected readonly nextHealthPollCountdown = computed(() =>
    Math.max(0, Math.round((this.nextHealthPollAt() - this.now()) / 1000)),
  );
  protected readonly discoveryTimings = signal<number[]>(
    JSON.parse(localStorage.getItem('cmdr.discovery.timings') ?? '[]'),
  );
  protected readonly discoveryLastS = computed(() => {
    const t = this.discoveryTimings();
    return t.length > 0 ? t[t.length - 1] : null;
  });
  protected readonly discoveryAvgS = computed(() => {
    const t = this.discoveryTimings();
    return t.length > 0 ? t.reduce((s, v) => s + v, 0) / t.length : null;
  });
  protected readonly discoveryButtonLabel = computed(() => {
    const last = this.discoveryLastS();
    const avg = this.discoveryAvgS();
    const cnt = this.discoveryTimings().length;
    if (this.discoveryLoading()) {
      return avg !== null ? `Full Discovery · ~${avg.toFixed(1)}s` : 'Full Discovery';
    }
    if (last === null) return 'Full Discovery';
    if (cnt < 2) return `Full Discovery · ${last.toFixed(1)}s`;
    return `Full Discovery · ${last.toFixed(1)}s · avg ${avg!.toFixed(1)}s`;
  });
  protected readonly manualCommand = signal('');
  protected readonly customCommandValues = signal<Record<string, Record<string, CustomCommandValue>>>({});
  protected readonly modalQueryLoading = signal(false);
  protected readonly modalQueryError = signal<string | null>(null);
  private modalQuerySub: Subscription | null = null;
  protected readonly rawCommand = signal('');
  protected readonly rawCommandLoading = signal(false);
  protected readonly rawCommandResult = signal<RawCommandResponse | null>(null);
  protected readonly rawCommandError = signal<string | null>(null);
  protected readonly backendBusy = computed(
    () => this.discoveryLoading() || this.fixtureQueryLoading() || this.planQueryLoading() || this.planGroupQueryLoading(),
  );
  protected readonly commanderUnavailable = computed(
    () => this.loading() || !!this.healthError() || this.health()?.commander?.detected !== true,
  );
  // Tracks whether we've been through at least one unavailable state this session
  // so the "back online" toast only fires on recovery, never on initial load.
  private _wasUnavailable = false;

  // Ensures auto-discovery on empty store fires at most once per session.
  private _autoDiscoveryTriggered = false;

  @ViewChild('fixtureDetailDialog') fixtureDetailDialog!: ElementRef<HTMLDialogElement>;

  private readonly commanderApi = inject(CommanderApiService);
  private readonly fixtureStore = inject(FixtureStoreService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly swUpdate = inject(SwUpdate);

  protected readonly now = signal(Date.now());
  protected readonly heartbeatLabel = computed(() => {
    const h = this.health();
    return h ? this.relativeTime(h.utc) : null;
  });

  protected readonly proxyLastTransitionLabel = computed(() =>
    this.relativeTime(this.health()?.commander?.proxy?.last_transition_at_utc),
  );

  protected readonly proxyLastEventLabel = computed(() =>
    this.relativeTime(this.health()?.commander?.proxy?.last_event_at_utc),
  );

  protected readonly selectedFixtureLastSeen = computed(() => {
    const f = this.selectedFixture();
    if (!f) return null;
    return this.relativeTime(f.lastUpdatedAt);
  });

  protected relativeTime(ts: number | string | unknown): string | null {
    if (ts === null || ts === undefined) return null;
    let ms: number;
    if (typeof ts === 'number') {
      ms = ts * 1000;
    } else if (typeof ts === 'string') {
      // Handle "YYYY-MM-DD HH:MM:SS" (no timezone) by treating as UTC
      const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
      ms = new Date(normalized).getTime();
    } else {
      return null;
    }
    if (isNaN(ms)) return null;
    const diffS = Math.max(0, Math.floor((this.now() - ms) / 1000));
    if (diffS < 60) return `${diffS}s ago`;
    const diffM = Math.floor(diffS / 60);
    if (diffM < 60) return `${diffM}m ago`;
    return `${Math.floor(diffM / 60)}h ago`;
  }

  protected formatDurationSeconds(totalSeconds: number | null | undefined): string | null {
    if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
      return null;
    }
    const whole = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = whole % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  constructor() {
    effect(() => localStorage.setItem('cmdr.selectedFixture', this.fixtureName()));
    effect(() => localStorage.setItem('cmdr.selectedPlan', this.planName()));
    effect(() => localStorage.setItem('cmdr.selectedPlanGroup', this.planGroupName()));
    effect(() =>
      localStorage.setItem('cmdr.discovery.timings', JSON.stringify(this.discoveryTimings())),
    );
    effect(() => {
      const commands = this.selectedFixtureCustomCommands();
      this.customCommandValues.set(this.buildInitialCustomCommandValues(commands));
    });

    effect(() => {
      const unavailable = this.commanderUnavailable();
      // Read loading() explicitly so this effect re-runs when loading changes.
      // We suppress the toast while the initial health fetch is still in flight
      // to avoid flashing "unavailable" before the first response arrives.
      const stillLoading = this.loading();
      // setTimeout: p-toast subscribes to MessageService during view init,
      // after this constructor effect fires — defer so the message isn't lost.
      setTimeout(() => {
        this.messageService.clear('cmdr-offline');
        if (unavailable && !stillLoading) {
          this._wasUnavailable = true;
          this.messageService.add({ key: 'cmdr-offline', severity: 'warn', summary: 'Commander unavailable', sticky: true });
        } else if (!unavailable && this._wasUnavailable) {
          // Recovery: only toast if we previously showed the unavailable warning.
          this._wasUnavailable = false;
          this.messageService.add({
            key: 'app',
            severity: 'success',
            summary: 'Commander available',
            detail: 'Connection restored.',
            life: 4000,
          });
        }
      }, 0);
    });

    effect(() => {
      const isDiscovery = this.discoveryLoading();
      const isQuery = this.fixtureQueryLoading() || this.planQueryLoading() || this.planGroupQueryLoading();
      this.messageService.clear('app');
      if (isDiscovery) {
        const avg = this.discoveryAvgS();
        const summary =
          avg !== null
            ? `Running full discovery… · ~${avg.toFixed(1)}s`
            : 'Running full discovery…';
        this.messageService.add({ key: 'app', severity: 'warn', summary, sticky: true, closable: false });
      } else if (isQuery) {
        this.messageService.add({ key: 'app', severity: 'warn', summary: 'Running query...', sticky: true, closable: false });
      }
    });
  }

  protected readonly targets: readonly CommanderApiTarget[] = this.commanderApi.targets;
  protected readonly activeApiUrl = this.commanderApi.apiBaseUrl;
  protected readonly groupedFixtures = this.fixtureStore.fixturesGroupedByPlanName;

  /** Two-level sidebar tree: plan_group → [plan → [fixtures]] */
  protected readonly groupedFixturesByPlanGroup = computed(() => {
    // Build plan_name → plan_group lookup from the exposed plans list
    const planToGroup = new Map<string, string>();
    for (const plan of this.exposedPlans()) {
      planToGroup.set(plan.plan_name, (plan.plan_group || plan.plan_name).trim() || plan.plan_name);
    }

    const outerMap = new Map<string, FixturePlanGroup[]>();
    for (const planGroup of this.groupedFixtures()) {
      const pgName = planToGroup.get(planGroup.plan_name) ?? planGroup.plan_name;
      const list = outerMap.get(pgName) ?? [];
      list.push(planGroup);
      outerMap.set(pgName, list);
    }

    return Array.from(outerMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plan_group, plans]) => ({
        plan_group,
        plans: [...plans].sort((a, b) => a.plan_name.localeCompare(b.plan_name)),
      }));
  });
  protected readonly selectedFixtureName = this.fixtureStore.selectedFixtureName;
  protected readonly selectedFixture = this.fixtureStore.selectedFixture;
  protected readonly fixtureCount = this.fixtureStore.fixtureCount;
  protected readonly storageWarning = this.fixtureStore.storageWarning;

  /** Per-fixture fw version status keyed by fixture_name. Recomputes whenever health or store changes. */
  protected readonly fixtureFwStatusMap = computed(() => {
    const h = this.health();
    const release = h?.api?.release_version ?? null;
    const commanderFw = h?.commander?.fw_version ?? null;
    const commanderFixture = h?.commander?.detected_fixture_name ?? null;
    const map = new Map<string, { fw: string; outdated: boolean; release: string | null }>();
    for (const group of this.groupedFixtures()) {
      for (const fixture of group.fixtures) {
        const raw = fixture.raw['fw_version'];
        // Prefer the backend-reported fw_version for the connected commander (it probes itself via health).
        const v =
          commanderFw && commanderFixture && fixture.fixture_name === commanderFixture
            ? commanderFw
            : typeof raw === 'string'
              ? raw
              : null;
        if (v !== null) {
          const outdated = release !== null && compareVersions(v, release) < 0;
          map.set(fixture.fixture_name, { fw: v, outdated, release });
        }
      }
    }
    return map;
  });
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
  protected readonly fixtureOptions = computed<SelectOption[]>(() => {
    const names = new Set<string>();
    for (const group of this.lanGroups()) {
      for (const name of group.fixtures ?? []) {
        names.add(name);
      }
    }
    return Array.from(names)
      .sort()
      .map((name) => ({ label: name, value: name }));
  });
  protected readonly selectedFixtureJson = computed(() => {
    const selected = this.selectedFixture();
    return selected ? JSON.stringify(selected.raw, null, 2) : '';
  });

  protected readonly selectedFixturePlanControls = computed<CmdrPlanControls | null>(() => {
    const caps = this.selectedFixture()?.raw['capabilities'] as CmdrFixtureCapabilities | undefined | null;
    return caps?.plan_controls ?? null;
  });

  protected readonly selectedFixturePlayer = computed<CmdrPlayerCapabilities | null>(() => {
    const caps = this.selectedFixture()?.raw['capabilities'] as CmdrFixtureCapabilities | undefined | null;
    return caps?.player ?? null;
  });

  protected readonly selectedFixtureCustomCommands = computed<CmdrCustomCommandUiItem[]>(() => {
    const raw = this.selectedFixture()?.raw['custom_command_ui'];
    if (!Array.isArray(raw)) return [];
    return raw as CmdrCustomCommandUiItem[];
  });

  protected readonly selectedFixtureFwStatus = computed<{
    fw: string;
    release: string | null;
    upToDate: boolean;
    direction: 'up-to-date' | 'fixture-outdated' | 'fixture-ahead';
  } | null>(() => {
    const h = this.health();
    const release = h?.api?.release_version ?? null;
    const commanderFw = h?.commander?.fw_version ?? null;
    const commanderFixture = h?.commander?.detected_fixture_name ?? null;
    const selected = this.selectedFixture();
    const raw = selected?.raw['fw_version'];
    // Prefer the backend-reported fw_version for the connected commander (it probes itself via health).
    const v =
      commanderFw && commanderFixture && selected?.fixture_name === commanderFixture
        ? commanderFw
        : typeof raw === 'string'
          ? raw
          : null;
    if (v === null) return null;
    const cmp = release !== null ? compareVersions(v, release) : 0;
    const direction =
      release === null ? 'up-to-date'
      : cmp === 0      ? 'up-to-date'
      : cmp < 0        ? 'fixture-outdated'
      :                  'fixture-ahead';
    return { fw: v, release, upToDate: direction === 'up-to-date', direction };
  });

  // Callbacks run once when the API recovers from offline → online.
  // Add entries here to extend the recovery set.
  private readonly recoveryCallbacks: Array<() => void> = [];

  ngOnInit(): void {
    this.customUrl.set(this.activeApiUrl());

    // Register endpoints to re-fetch automatically on API recovery
    this.recoveryCallbacks.push(
      () => this.loadExposedPlans(),
      () => this.loadLanGroups(),
    );

    this.loadHealth();
    this.loadExposedPlans();
    this.loadLanGroups();
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));

    // Auto-poll health every 30 s; skip if a fetch is already in flight
    this.startHealthPollTimer();
    this.destroyRef.onDestroy(() => this.cancelHealthPollTimer());
  }

  protected reloadHealth(): void {
    this.cancelHealthPollTimer();
    this.loadHealth();
  }

  private startHealthPollTimer(delayMs = CommanderComponent.HEALTH_POLL_MS): void {
    this.cancelHealthPollTimer();
    this.nextHealthPollAt.set(Date.now() + delayMs);
    this.healthPollTimer = setTimeout(() => {
      this.healthPollTimer = null;
      if (!this.loading() && !this.healthRefreshing()) {
        this.loadHealth();
        if (this.swUpdate.isEnabled) this.swUpdate.checkForUpdate();
      }
    }, delayMs);
  }

  private cancelHealthPollTimer(): void {
    if (this.healthPollTimer !== null) {
      clearTimeout(this.healthPollTimer);
      this.healthPollTimer = null;
    }
  }

  protected retryHealth(): void {
    this.healthRetryDelayMs = CommanderComponent.HEALTH_INITIAL_RETRY_MS; // Reset backoff
    this.cancelHealthPollTimer();
    this.loadHealth(true);
  }

  protected useTarget(url: string): void {
    this.commanderApi.setApiBaseUrl(url);
    this.customUrl.set(this.activeApiUrl());
    this.healthRetryDelayMs = CommanderComponent.HEALTH_INITIAL_RETRY_MS;
    this.cancelHealthPollTimer();
    this.loadHealth(true); // URL changed — stale health data, force full loading state
    this.loadExposedPlans();
    this.loadLanGroups();
  }

  protected applyCustomUrl(): void {
    const ok = this.commanderApi.setApiBaseUrl(this.customUrl());
    if (!ok) {
      this.showErrorToast('Invalid API URL. Use host[:port] or http(s)://host[:port].');
      return;
    }

    this.customUrl.set(this.activeApiUrl());
    this.healthRetryDelayMs = CommanderComponent.HEALTH_INITIAL_RETRY_MS;
    this.cancelHealthPollTimer();
    this.loadHealth(true); // URL changed — stale health data, force full loading state
    this.loadExposedPlans();
    this.loadLanGroups();
  }

  protected runFixtureQuery(): void {
    if (!this.checkApiReachable()) return;
    const fixture = this.fixtureName().trim();
    if (!fixture) {
      this.error.set('Fixture name is required.');
      return;
    }

    this.fixtureQueryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getFixtureVersion(fixture).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'fixture_query');
        this.fixtureQueryLoading.set(false);
        this.showQueryResultToast(stats);
      },
      error: (err: unknown) => {
        this.showErrorToast(this.formatError(`Fixture query failed for ${fixture}`, err));
        this.queryResult.set(null);
        this.fixtureQueryLoading.set(false);
      },
    });
  }

  protected clearList(): void {
    this.fixtureStore.clearAllFixtures();
    this.discoveryTimings.set([]);
  }

  protected runFullDiscovery(): void {
    if (!this.checkApiReachable()) return;
    this.discoveryLoading.set(true);
    this.error.set(null);
    const startedAt = performance.now();

    this.commanderApi.getFixtureDiscovery().subscribe({
      next: (result) => {
        const durationS = (performance.now() - startedAt) / 1000;
        this.addDiscoveryTiming(durationS);
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'discovery_query');
        this.discoveryLoading.set(false);
        this.showQueryResultToast(stats, durationS);
      },
      error: (err: unknown) => {
        this.showErrorToast(this.formatError('Full discovery failed', err));
        this.discoveryLoading.set(false);
      },
    });
  }

  protected runPlanQuery(): void {
    if (!this.checkApiReachable()) return;
    const plan = this.planName().trim();
    if (!plan) {
      this.error.set('Plan name is required.');
      return;
    }

    this.planQueryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getPlanVersions(plan).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'plan_query');
        this.planQueryLoading.set(false);
        this.showQueryResultToast(stats);
      },
      error: (err: unknown) => {
        this.showErrorToast(this.formatError(`Plan query failed for ${plan}`, err));
        this.queryResult.set(null);
        this.planQueryLoading.set(false);
      },
    });
  }

  protected readonly openDropdownCount = signal(0);
  protected readonly anyDropdownOpen = computed(() => this.openDropdownCount() > 0);

  protected onDropdownShow(): void {
    this.openDropdownCount.update((n) => n + 1);
  }

  protected onDropdownHide(): void {
    this.openDropdownCount.update((n) => Math.max(0, n - 1));
  }

  protected onFixtureSelected(value: string): void {
    this.fixtureName.set(value);
  }

  protected onPlanSelected(value: string): void {
    this.planName.set(value);
  }

  protected onPlanGroupSelected(value: string): void {
    this.planGroupName.set(value);
  }

  /** Called from sidebar reload button — sets the dropdown and fires the plan query. */
  protected sidebarRefreshPlan(planName: string, event: Event): void {
    event.stopPropagation();
    this.planName.set(planName);
    this.runPlanQuery();
  }

  /** Called from sidebar reload button — sets the dropdown and fires the plan group query. */
  protected sidebarRefreshPlanGroup(planGroup: string, event: Event): void {
    event.stopPropagation();
    this.planGroupName.set(planGroup);
    this.runPlanGroupQuery();
  }

  protected runPlanGroupQuery(): void {
    if (!this.checkApiReachable()) return;
    const planGroup = this.planGroupName().trim();
    if (!planGroup) {
      this.error.set('Plan group is required.');
      return;
    }

    this.planGroupQueryLoading.set(true);
    this.error.set(null);
    this.commanderApi.getPlanGroupVersions(planGroup).subscribe({
      next: (result) => {
        this.queryResult.set(result);
        const stats = this.ingestQueryResult(result, 'plan_group_query');
        this.planGroupQueryLoading.set(false);
        this.showQueryResultToast(stats);
      },
      error: (err: unknown) => {
        this.showErrorToast(this.formatError(`Plan group query failed for ${planGroup}`, err));
        this.queryResult.set(null);
        this.planGroupQueryLoading.set(false);
      },
    });
  }

  protected selectFixture(record: FixtureRecord): void {
    // Diagnostic breadcrumb for fixture-selection mismatch investigations.
    console.log('[cmdr][selectFixture]', { fixture_name: record.fixture_name, plan_name: record.plan_name });
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
    this.modalQuerySub?.unsubscribe();
    this.modalQuerySub = null;
    this.fixtureDetailDialog?.nativeElement?.close();
    this.modalQueryLoading.set(false);
    this.modalQueryError.set(null);
    this.fixtureActionMessage.set(null);
    this.fixtureActionError.set(null);
    this.rebootConfirmPending.set(false);
  }

  protected rebootFixture(): void {
    if (!this.rebootConfirmPending()) {
      this.rebootConfirmPending.set(true);
      return;
    }
    this.rebootConfirmPending.set(false);
    const fixture = this.selectedFixture()?.fixture_name;
    if (!fixture) return;
    // Full wire form with ACK — recommended for disruptive commands (COMMAND_PROTOCOL.md)
    this.sendCommand(fixture, `ack;tcmd;${fixture};cmd;reboot;`);
  }

  protected runModalFixtureQuery(): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) {
      this.modalQueryError.set('No fixture selected.');
      return;
    }

    this.modalQuerySub?.unsubscribe();
    this.modalQueryLoading.set(true);
    this.modalQueryError.set(null);

    this.modalQuerySub = this.commanderApi.getFixtureVersion(fixture).subscribe({
      next: (result) => {
        this.modalQuerySub = null;
        this.queryResult.set(result);
        // Pass the selected fixture's store key so the record is updated under
        // the correct name even when the API summary reports a different
        // fixture_name (CMDR alias vs fixture self-identity).
        this.ingestQueryResult(result, 'fixture_query', fixture);
        this.modalQueryLoading.set(false);
      },
      error: (err: unknown) => {
        this.modalQuerySub = null;
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

  protected runRawCommand(): void {
    const command = this.rawCommand().trim();
    if (!command) return;

    this.rawCommandLoading.set(true);
    this.rawCommandError.set(null);
    this.rawCommandResult.set(null);

    this.commanderApi.postRawCommand(command).subscribe({
      next: (result) => {
        this.rawCommandResult.set(result);
        this.rawCommandLoading.set(false);
      },
      error: (err: unknown) => {
        this.rawCommandError.set(this.formatError('Raw command failed', err));
        this.rawCommandLoading.set(false);
      },
    });
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

  protected customCommandArgValue(commandId: string, arg: CmdrCustomCommandUiArg): CustomCommandValue {
    const commandValues = this.customCommandValues()[commandId];
    if (commandValues && arg.name in commandValues) {
      return commandValues[arg.name];
    }
    return this.defaultValueForArg(arg);
  }

  protected updateCustomCommandArg(commandId: string, arg: CmdrCustomCommandUiArg, rawValue: unknown): void {
    const nextValue = this.normalizeArgValue(arg, rawValue);
    this.customCommandValues.update((current) => {
      const commandValues = { ...(current[commandId] ?? {}) };
      commandValues[arg.name] = nextValue;
      return {
        ...current,
        [commandId]: commandValues,
      };
    });
  }

  protected onCustomCommandSliderRelease(command: CmdrCustomCommandUiItem): void {
    if (!this.commandSendOnRelease(command)) return;
    this.runCustomCommand(command);
  }

  protected runCustomCommand(command: CmdrCustomCommandUiItem): void {
    const selected = this.selectedFixture();
    const fixture = (selected?.fixture_name ?? this.fixtureName()).trim();
    if (!fixture) {
      this.fixtureActionMessage.set('No fixture selected.');
      return;
    }
    const wireTemplate = (command.wire_template ?? '').trim();
    if (!wireTemplate) {
      this.fixtureActionMessage.set('Command template is empty.');
      return;
    }
    const unknownPlaceholders = this.findUnknownTemplatePlaceholders(
      wireTemplate,
      command.args ?? [],
    );
    if (unknownPlaceholders.length > 0) {
      this.fixtureActionMessage.set(
        `Command template placeholders missing in args: ${unknownPlaceholders.join(', ')}`,
      );
      return;
    }

    const commandValues = this.customCommandValues()[command.id] ?? {};
    const wireCommand = this.buildCommandFromTemplate(wireTemplate, commandValues);
    this.sendCommand(fixture, wireCommand);
  }

  protected onDialogBackdropClick(event: MouseEvent): void {
    const dialog = this.fixtureDetailDialog?.nativeElement;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const isOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (isOutside) {
      this.closeFixtureModal();
    }
  }

  private openFixtureModal(): void {
    const dialog = this.fixtureDetailDialog?.nativeElement;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  private ingestQueryResult(
    result: CommanderQueryResponse,
    source: FixtureSource,
    storeKeyOverride?: string,
  ): { added: number; updated: number } | null {
    const fixtures = this.extractFixtures(result, source, storeKeyOverride);
    if (!fixtures.length) {
      return null;
    }

    return this.fixtureStore.upsertFixtures(fixtures);
  }

  private formatUpsertStats(stats: { added: number; updated: number }): string {
    const parts: string[] = [];
    if (stats.added > 0) parts.push(`${stats.added} added`);
    if (stats.updated > 0) parts.push(`${stats.updated} updated`);
    if (!parts.length) return 'No fixtures found';
    return parts.join(', ');
  }

  private showQueryResultToast(
    stats: { added: number; updated: number } | null,
    durationS?: number,
  ): void {
    let summary = stats ? this.formatUpsertStats(stats) : 'No fixtures found in response';
    if (durationS !== undefined) {
      const avg = this.discoveryAvgS();
      const cnt = this.discoveryTimings().length;
      summary += ` · ${durationS.toFixed(1)}s`;
      if (cnt >= 2 && avg !== null) summary += ` · avg ${avg.toFixed(1)}s`;
    }
    this.messageService.add({ key: 'app', severity: 'success', summary, life: 3000 });
  }

  private addDiscoveryTiming(durationS: number): void {
    this.discoveryTimings.set([...this.discoveryTimings(), durationS].slice(-10));
  }

  private showErrorToast(message: string): void {
    // Suppress redundant errors when cmdr-offline toast already covers the unavailable state.
    if (this.commanderUnavailable()) return;
    this.messageService.add({ key: 'app', severity: 'error', summary: message, life: 6000 });
  }

  /** Returns false if the API is known to be unreachable (cmdr-offline toast covers the state). */
  private checkApiReachable(): boolean {
    return !this.healthError();
  }

  private extractFixtures(
    result: CommanderQueryResponse,
    source: FixtureSource,
    /** When querying a single fixture from the modal, pass its store key so the
     *  record is always updated under the correct name even if the fixture
     *  self-reports a different fixture_name in the response summary. */
    storeKeyOverride?: string,
  ): FixtureRecord[] {
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
    const existingByName = this.fixtureStore.fixturesByName();

    for (const item of extracted) {
      // Use the store key override for single-fixture modal queries so the
      // existing record is updated even when the fixture self-reports a
      // different fixture_name (e.g. CMDR alias vs self-reported identity).
      const reported_fixture_name = this.readString(item, 'fixture_name');
      const fixture_name = storeKeyOverride ?? reported_fixture_name;
      const payload_plan_name = this.readString(item, 'plan_name');
      const existing_record = fixture_name ? existingByName[fixture_name] : undefined;
      const plan_name =
        storeKeyOverride && existing_record?.plan_name
          ? existing_record.plan_name
          : payload_plan_name;

      if (!fixture_name) {
        this.error.set(`Fixture payload missing fixture_name: ${JSON.stringify(item)}`);
        continue;
      }
      if (!plan_name) {
        this.error.set(`Fixture payload missing plan_name for ${fixture_name}.`);
        continue;
      }
      if (storeKeyOverride && reported_fixture_name && reported_fixture_name !== fixture_name) {
        console.warn('[cmdr][extractFixtures] storeKeyOverride identity mismatch', {
          store_fixture_name: fixture_name,
          payload_fixture_name: reported_fixture_name,
          payload_plan_name: payload_plan_name ?? null,
          preserved_plan_name: existing_record?.plan_name ?? null,
        });
      }

      records.push({
        fixture_name,
        plan_name,
        raw: { ...item, fixture_name },
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

  private loadHealth(force = false): void {
    // Treat as a refresh (keep panel alive) if health data OR a prior error is already showing
    const isRefresh = !force && (this.health() !== null || this.healthError() !== null);
    this.error.set(null);

    if (isRefresh) {
      // Keep the panel alive (don't null health or set loading) — just show button spinner
      this.healthRefreshing.set(true);
    } else {
      this.loading.set(true);
      this.health.set(null);
      this.healthError.set(null); // clear stale error on full reload
    }

    this.commanderApi.getHealth().subscribe({
      next: (result) => {
        const wasOffline = this.healthError() !== null;
        this.health.set(result);
        this.healthError.set(null); // clear degraded state on success
        this.loading.set(false);
        this.healthRefreshing.set(false);
        // Reset backoff — schedule next poll at normal 30 s interval
        this.healthRetryDelayMs = CommanderComponent.HEALTH_INITIAL_RETRY_MS;
        this.startHealthPollTimer();
        if (wasOffline) {
          // API just came back — re-fetch all registered recovery endpoints
          this.runRecoveryCallbacks();
        }
        // Auto-discover on first API success when fixture store is empty.
        // Covers both initial load and recovery-after-offline. The flag ensures
        // it fires at most once per session even across health polls.
        // Delayed by 3 s so the commander serial connection has time to stabilise
        // before the discovery request hits the API (USB-CDC boards can take
        // a few seconds to come online after the API opens the serial port).
        if (!this._autoDiscoveryTriggered && this.fixtureStore.fixtureCount() === 0) {
          this._autoDiscoveryTriggered = true;
          setTimeout(() => {
            if (this.fixtureStore.fixtureCount() === 0 && this.health()?.commander?.detected === true) {
              this.runFullDiscovery();
            }
          }, 3000);
        }
      },
      error: () => {
        // Unified: always surface as healthError so the panel stays visible
        this.healthError.set('API unreachable');
        this.loading.set(false);
        this.healthRefreshing.set(false);
        // Schedule next retry with exponential backoff, then double the delay
        this.startHealthPollTimer(this.healthRetryDelayMs);
        this.healthRetryDelayMs = Math.min(
          this.healthRetryDelayMs * 2,
          CommanderComponent.HEALTH_MAX_RETRY_MS,
        );
      },
    });
  }

  private runRecoveryCallbacks(): void {
    for (const cb of this.recoveryCallbacks) {
      cb();
    }
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
        this.showErrorToast(this.formatError('Plan list load failed', err));
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
        this.syncSelectedFixture(groups);
        this.lanGroupListLoading.set(false);
      },
      error: (err: unknown) => {
        this.lanGroups.set([]);
        this.lanGroupListLoading.set(false);
        this.showErrorToast(this.formatError('Plan group list load failed', err));
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

  private syncSelectedFixture(groups: CommanderLanGroup[]): void {
    const allFixtures = groups.flatMap((g) => g.fixtures ?? []).sort();
    if (!allFixtures.length) {
      this.fixtureName.set('');
      return;
    }
    const current = this.fixtureName().trim();
    if (!current || !allFixtures.includes(current)) {
      this.fixtureName.set(allFixtures[0]);
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
    this.fixtureActionError.set(null);
    this.fixtureActionResult.set(null);
    this.fixtureActionDurationMs.set(null);
    const startedAt = performance.now();

    this.commanderApi.runFixtureCommand(fixture, wireCommand).subscribe({
      next: (result) => {
        const durationMs = performance.now() - startedAt;
        this.fixtureActionDurationMs.set(durationMs);
        this.fixtureActionResult.set(result);
        this.fixtureActionError.set(null);

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
        this.fixtureActionMessage.set(null);
        this.fixtureActionError.set(this.formatError(`Command failed for ${fixture}`, err));
        this.fixtureActionResult.set(null);
        this.fixtureActionLoading.set(false);
      },
    });
  }

  private buildInitialCustomCommandValues(
    commands: CmdrCustomCommandUiItem[],
  ): Record<string, Record<string, CustomCommandValue>> {
    const initial: Record<string, Record<string, CustomCommandValue>> = {};
    for (const command of commands) {
      const commandValues: Record<string, CustomCommandValue> = {};
      for (const arg of command.args ?? []) {
        commandValues[arg.name] = this.defaultValueForArg(arg);
      }
      initial[command.id] = commandValues;
    }
    return initial;
  }

  private buildCommandFromTemplate(
    wireTemplate: string,
    values: Record<string, CustomCommandValue>,
  ): string {
    return wireTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
      const value = values[key];
      return this.serializeTemplateValue(value);
    });
  }

  private findUnknownTemplatePlaceholders(
    wireTemplate: string,
    args: CmdrCustomCommandUiArg[],
  ): string[] {
    const declaredNames = new Set((args ?? []).map((arg) => arg.name));
    const missing = new Set<string>();
    const pattern = /\{([a-zA-Z0-9_]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(wireTemplate)) !== null) {
      const key = match[1];
      if (!declaredNames.has(key)) {
        missing.add(key);
      }
    }
    return Array.from(missing);
  }

  private serializeTemplateValue(value: CustomCommandValue | undefined): string {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
    if (typeof value === 'string') return value;
    return '';
  }

  private defaultValueForArg(arg: CmdrCustomCommandUiArg): CustomCommandValue {
    if (arg.control === 'checkbox') {
      return this.toBoolean(arg.default ?? false);
    }
    if (arg.control === 'slider' || arg.control === 'number') {
      const fallback = typeof arg.min === 'number' ? arg.min : 0;
      return this.toNumber(arg.default, fallback);
    }
    if (typeof arg.default === 'string') return arg.default;
    return '';
  }

  private normalizeArgValue(arg: CmdrCustomCommandUiArg, rawValue: unknown): CustomCommandValue {
    if (arg.control === 'checkbox') {
      return this.toBoolean(rawValue);
    }
    if (arg.control === 'slider' || arg.control === 'number') {
      const fallback = typeof arg.min === 'number' ? arg.min : 0;
      return this.toNumber(rawValue, fallback);
    }
    return typeof rawValue === 'string' ? rawValue : `${rawValue ?? ''}`;
  }

  private toNumber(rawValue: unknown, fallback: number): number {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return rawValue;
    if (typeof rawValue === 'string') {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  private toBoolean(rawValue: unknown): boolean {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'number') return rawValue !== 0;
    if (typeof rawValue === 'string') {
      const lowered = rawValue.trim().toLowerCase();
      return lowered === '1' || lowered === 'true' || lowered === 'yes' || lowered === 'on';
    }
    return false;
  }

  protected commandSendOnRelease(command: CmdrCustomCommandUiItem): boolean {
    const value = (command as Record<string, unknown>)['send_on_release'];
    return value === true;
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
        return `${prefix}: unreachable`;
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
