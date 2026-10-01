import { Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NativeScriptCommonModule, NativeScriptRouterModule, RouterExtensions } from '@nativescript/angular';
import { NativeDialogService } from '@nativescript/angular';
import { ShareDialogComponent } from '../share/share-dialog.component';

@Component({
  selector: 'ns-details',
  templateUrl: './details.component.html',
  imports: [NativeScriptCommonModule, NativeScriptRouterModule],
  schemas: [NO_ERRORS_SCHEMA]
})
export class DetailsComponent {
  private router = inject(RouterExtensions);
  private route = inject(ActivatedRoute);
  private nativeDialog = inject(NativeDialogService);
  id = Number(this.route.snapshot.params.id);

  share() {
    this.nativeDialog.open(ShareDialogComponent, { data: { id: this.id } });
  }

  next() {
    this.router.navigate([`/details/${this.id + 1}`]);
  }

  settings() {
    this.router.navigate(['settings'], { relativeTo: this.route.parent });
  }
}
