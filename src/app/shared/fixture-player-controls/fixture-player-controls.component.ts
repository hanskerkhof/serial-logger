import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CmdrPlayerCapabilities } from '../../api/cmdr-models';

@Component({
  selector: 'app-fixture-player-controls',
  standalone: true,
  templateUrl: './fixture-player-controls.component.html',
  styleUrl: './fixture-player-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixturePlayerControlsComponent {
  readonly player = input<CmdrPlayerCapabilities | null>(null);
}
