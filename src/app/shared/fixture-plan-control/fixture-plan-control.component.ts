import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { CmdrPlanControls } from '../../api/cmdr-models';

export type PlanAction = 'trigger' | 'stop';

/**
 * Plan state strings as reported by BauklankPlan / BK_PLAN_STATE.
 * Only RUNNING and STOPPED have active styling for now; others fall back to the default badge.
 */
export type PlanState = 'OFF' | 'IDLE' | 'PREPARE' | 'READY' | 'RUNNING' | 'STOPPED' | 'ERROR' | (string & {});

@Component({
  selector: 'app-fixture-plan-control',
  standalone: true,
  imports: [ButtonModule],
  templateUrl: './fixture-plan-control.component.html',
  styleUrl: './fixture-plan-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixturePlanControlComponent {
  readonly planControls = input<CmdrPlanControls | null>(null);
  /** Confirmed plan state from the last API response. Drives the displayed badge. */
  readonly planState = input<PlanState | null>(null);
  readonly loading = input(false);
  readonly disabled = input(false);
  /** True while a fixture state re-query is in flight; shows a spinner inside the badge. */
  readonly querying = input(false);

  readonly actionRequested = output<PlanAction>();

  /**
   * Displayed plan state — driven by the confirmed `planState` input from the last API response.
   * The badge updates only after the BE confirms the action via a re-query, not optimistically on click.
   * linkedSignal resets to the confirmed value whenever `planState` input changes.
   */
  protected readonly displayedState = linkedSignal<PlanState | null>(() => this.planState());

  protected readonly badgeClass = computed(() => {
    const state = this.displayedState();
    const modifier = state ? ` fixture-plan-control__badge--${state.toLowerCase()}` : '';
    return `fixture-plan-control__badge${modifier}`;
  });

  protected onTrigger(): void {
    this.actionRequested.emit('trigger');
  }

  protected onStop(): void {
    this.actionRequested.emit('stop');
  }
}
