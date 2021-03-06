import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable, of} from 'rxjs';
import {delay, distinctUntilChanged, map, startWith, switchMap} from 'rxjs/operators';
import {PROGRESS_BAR_LABEL_MAP} from './global-progress-bar.const';

const DELAY = 100;

@Injectable({
  providedIn: 'root'
})
export class GlobalProgressBarService {
  nrOfRequests$ = new BehaviorSubject(0);
  isShowGlobalProgressBar$: Observable<boolean> = this.nrOfRequests$.pipe(
    map(nr => nr > 0),
    distinctUntilChanged(),
    switchMap((isShow) => isShow
      ? of(true)
      : of(false).pipe(delay(DELAY))
    ),
    startWith(false),
    // @see https://blog.angular-university.io/angular-debugging/
    delay(0),
  );

  private _label$ = new BehaviorSubject(null);
  label$ = this._label$.pipe(
    distinctUntilChanged(),
    switchMap((label) => !!label
      ? of(label)
      : of(null).pipe(delay(DELAY))
    ),
    // @see https://blog.angular-university.io/angular-debugging/
    delay(0),
  );


  constructor() {
  }

  countUp(url: string) {
    this.nrOfRequests$.next(this.nrOfRequests$.getValue() + 1);
    this._label$.next(this._urlToLabel(url));
  }

  countDown() {
    this.nrOfRequests$.next(this.nrOfRequests$.getValue() - 1);
    if (this.nrOfRequests$.getValue() - 1 <= 0) {
      this._label$.next(null);
    }
  }

  private _urlToLabel(url: string): string {
    const [urlWithoutParams] = url.split('?');

    if (PROGRESS_BAR_LABEL_MAP[url]) {
      return PROGRESS_BAR_LABEL_MAP[url];
    } else {
      const key = Object.keys(PROGRESS_BAR_LABEL_MAP).find((keyIn) => urlWithoutParams.includes(keyIn));
      return key && PROGRESS_BAR_LABEL_MAP[key];
    }
  }
}

