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

  readonly actionRequested = output<PlanAction>();

  /**
   * Optimistic plan state — set immediately when the user presses an action button so
   * the badge updates before the next Run Query confirms the real state.
   * linkedSignal resets to the confirmed value whenever `planState` input changes.
   */
  protected readonly displayedState = linkedSignal<PlanState | null>(() => this.planState());

  protected readonly badgeClass = computed(() => {
    const state = this.displayedState();
    const modifier = state ? ` fixture-plan-control__badge--${state.toLowerCase()}` : '';
    return `fixture-plan-control__badge${modifier}`;
  });

  protected onTrigger(): void {
    this.displayedState.set('RUNNING');
    this.actionRequested.emit('trigger');
  }

  protected onStop(): void {
    this.displayedState.set('STOPPED');
    this.actionRequested.emit('stop');
  }
}
