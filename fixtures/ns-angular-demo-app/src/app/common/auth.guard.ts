import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthGuard {
  canActivate(): boolean {
    return true;
  }
}
