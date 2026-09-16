import { Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { NativeScriptCommonModule, RouterExtensions } from '@nativescript/angular';
import { BottomSheetService } from '@nativescript-community/ui-material-bottomsheet/angular';
import { FiltersSheetComponent } from './filters-sheet.component';

@Component({
  selector: 'ns-search',
  templateUrl: './search.component.html',
  imports: [NativeScriptCommonModule],
  schemas: [NO_ERRORS_SCHEMA]
})
export class SearchComponent {
  private router = inject(RouterExtensions);
  private bottomSheet = inject(BottomSheetService);

  openFilters() {
    this.bottomSheet.show(FiltersSheetComponent, { dismissOnBackgroundTap: true });
  }

  openResult(id: number) {
    this.router.navigate(['/details', id]);
  }
}
