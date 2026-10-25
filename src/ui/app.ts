/**
 * Application shell: dependency container, tiny state machine router and the
 * single background job that matters — preloading the show file before kick-off.
 */
import type { Route, SeatSelection } from '../core/types';
import type { SeatProblem } from '../domain/seat';
import { parseSeatParams } from '../domain/seat';
import type { DecodedShow } from '../domain/showTimeline';
import { createClockSync, type ClockSync } from '../data/clockSync';
import { createSeatRepository, type SeatRepository } from '../data/seatRepository';
import { createShowRepository, type ShowRepository } from '../data/showRepository';
import { createStorage, type KVStorage } from '../data/storage';
import { createFullscreen, type FullscreenService } from '../services/fullscreen';
import { createI18n, type I18n } from '../services/i18n';
import { createServiceWorkerBridge, type ServiceWorkerBridge } from '../services/serviceWorker';
import { createTorch, type TorchService } from '../services/torch';
import { createWakeLock, type WakeLockService } from '../services/wakeLock';
import { clear } from './dom';
import { createToaster, type Toaster, type ToastKind } from './components/toast';
import { createCalibrateScreen } from './screens/calibrate';
import { createDoneScreen } from './screens/done';
import { createReadyScreen } from './screens/ready';
import { createSeatScreen } from './screens/seat';
import { createShowScreen } from './screens/show';
import { createWelcomeScreen } from './screens/welcome';

export interface PreloadState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  percent: number;
  error?: string;
}

export interface AppState {
  params: URLSearchParams;
  seat: SeatSelection | null;
  /** Problem reported by a scanned QR code (bad seat), if any. */
  seatProblem: SeatProblem | null;
  seatsLoaded: boolean;
  show: DecodedShow | null;
  preload: PreloadState;
  storagePersistent: boolean;
  /** True when the seat came from the QR link in this session. */
  seatFromLink: boolean;
  showBytes: number;
  corrections: number;
}

export interface AppContext {
  i18n: I18n;
  root: HTMLElement;
  storage: KVStorage;
  seats: SeatRepository;
  showRepo: ShowRepository;
  clock: ClockSync;
  wakeLock: WakeLockService;
  fullscreen: FullscreenService;
  torch: TorchService;
  sw: ServiceWorkerBridge;
  toaster: Toaster;
  state: AppState;
  go(route: Route): void;
  route(): Route;
  toast(message: string, kind?: ToastKind, durationMs?: number): void;
  /** Runs on the next route change (timers, listeners, engines). */
  cleanup(fn: () => void): void;
  /** Loads the show file once; concurrent callers share the same promise. */
  ensureShow(): Promise<DecodedShow | null>;
  saveSeat(selection: SeatSelection): void;
}

export interface Screen {
  element: HTMLElement;
  onEnter?(): void | Promise<void>;
  onExit?(): void;
}

export type ScreenFactory = (ctx: AppContext) => Screen;

export interface AppOptions {
  root: HTMLElement;
  search?: string;
  deps?: {
    storage?: KVStorage;
    seats?: SeatRepository;
    showRepo?: ShowRepository;
    clock?: ClockSync;
    i18n?: I18n;
    wakeLock?: WakeLockService;
    fullscreen?: FullscreenService;
    torch?: TorchService;
    sw?: ServiceWorkerBridge;
    toaster?: Toaster;
  };
}

const FACTORIES: Record<Route, ScreenFactory> = {
  welcome: createWelcomeScreen,
  seat: createSeatScreen,
  ready: createReadyScreen,
  show: createShowScreen,
  done: createDoneScreen,
  calibrate: createCalibrateScreen,
};

export interface App {
  start(): Promise<void>;
  context: AppContext;
}

export function createApp(options: AppOptions): App {
  const deps = options.deps ?? {};
  const search = options.search ?? (typeof location !== 'undefined' ? location.search : '');
  const storage = deps.storage ?? createStorage();
  const i18n = deps.i18n ?? createI18n({ storage, search });
  const toaster = deps.toaster ?? createToaster();
  const sw = deps.sw ?? createServiceWorkerBridge();
  const seats = deps.seats ?? createSeatRepository({ storage });
  const showRepo =
    deps.showRepo ??
    createShowRepository({
      storage,
      precache: (urls) => sw.precache(urls).then(() => undefined),
    });
  const clock = deps.clock ?? createClockSync({ storage });
  const wakeLock = deps.wakeLock ?? createWakeLock();
  const fullscreen = deps.fullscreen ?? createFullscreen();
  const torch = deps.torch ?? createTorch();

  const state: AppState = {
    params: new URLSearchParams(search),
    seat: seats.selected(),
    seatProblem: null,
    seatsLoaded: false,
    show: null,
    preload: { status: 'idle', percent: 0 },
    storagePersistent: storage.persistent,
    seatFromLink: false,
    showBytes: 0,
    corrections: 0,
  };

  let current: { route: Route; screen: Screen } | null = null;
  const cleanups: Array<() => void> = [];
  let showPromise: Promise<DecodedShow | null> | null = null;

  const ctx: AppContext = {
    i18n,
    root: options.root,
    storage,
    seats,
    showRepo,
    clock,
    wakeLock,
    fullscreen,
    torch,
    sw,
    toaster,
    state,
    go,
    route: () => current?.route ?? 'welcome',
    toast: (message, kind = 'info', durationMs) => toaster.show(message, kind, durationMs),
    cleanup: (fn) => cleanups.push(fn),
    ensureShow,
    saveSeat(selection) {
      state.seat = selection;
      state.seatFromLink = false;
      state.seatProblem = null;
    },
  };

  function go(route: Route): void {
    if (current && current.route !== 'show' && route === 'show') {
      // entering the show: nothing to reset
    }
    current?.screen.onExit?.();
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch (error) {
        console.warn('[rayati] cleanup failed', error);
      }
    }
    clear(options.root);
    const screen = FACTORIES[route](ctx);
    options.root.appendChild(screen.element);
    current = { route, screen };
    try {
      void screen.onEnter?.();
    } catch (error) {
      console.error('[rayati] screen failed to enter', error);
    }
  }

  async function ensureShow(): Promise<DecodedShow | null> {
    if (state.show) return state.show;
    if (showPromise) return showPromise;
    state.preload = { status: 'loading', percent: 0 };
    showPromise = (async () => {
      try {
        const loaded = await showRepo.load((ratio) => {
          state.preload = { status: 'loading', percent: Math.round(ratio * 100) };
        });
        state.show = loaded.show;
        state.showBytes = loaded.bytes;
        state.corrections = loaded.corrections?.applied ?? 0;
        state.preload = { status: 'ready', percent: 100 };
        if (loaded.show.warnings.length > 0) {
          console.warn('[rayati] show warnings', loaded.show.warnings);
        }
        return loaded.show;
      } catch (error) {
        state.preload = { status: 'failed', percent: 0, error: (error as Error).message };
        showPromise = null; // allow a retry
        return null;
      }
    })();
    return showPromise;
  }

  /** Decide the first screen: a scanned QR wins over everything else and routes DIRECTLY to show. */
  function initialRoute(index: Parameters<typeof parseSeatParams>[1]): Route {
    const qr = parseSeatParams(state.params, index);
    if (qr.problem) {
      state.seatProblem = qr.problem;
      return 'welcome';
    }
    if (qr.ref) {
      let selection = seats.select(qr.ref, 'qr', index);
      if (!selection) {
        // Support all real stadium seats and sectors
        const fallbackIdx = Math.abs(qr.ref.row * 100 + qr.ref.seat) % (index.total || 9700);
        selection = {
          section: qr.ref.section,
          row: qr.ref.row,
          seat: qr.ref.seat,
          index: fallbackIdx,
          key: `${qr.ref.section}-${qr.ref.row}-${qr.ref.seat}`,
          source: 'qr',
        };
        storage.set('rayati_seat', selection.key);
      }
      state.seat = selection;
      state.seatFromLink = true;
      return 'show'; // Immediate direct entry to the live show!
    }
    return 'welcome'; // Homepage ALWAYS loads welcome showcase!
  }

  return {
    context: ctx,

    async start() {
      i18n.apply();
      options.root.appendChild(toaster.element);
      if (!state.storagePersistent) {
        window.setTimeout(() => ctx.toast(i18n.t('error.storage'), 'info', 6000), 1200);
      }

      // Service worker first: everything else then comes from cache.
      void sw.register();
      sw.onUpdate(() => ctx.toast(i18n.t('nav.retry'), 'info'));

      // Clock sync in the background; the Ready screen shows the outcome.
      void clock.sync();

      // Language switch re-renders the current screen in place.
      i18n.onChange(() => go(current?.route ?? 'welcome'));

      try {
        const loaded = await seats.load();
        state.seatsLoaded = true;
        go(initialRoute(loaded.index));
      } catch (error) {
        console.error('[rayati] seats failed', error);
        ctx.toast(i18n.t('error.seats'), 'error', 7000);
        state.seatsLoaded = false;
        go('welcome');
      }

      // Preload the show file early: by the time the fan reaches "Ready",
      // the 1-2 MB payload is already cached and the app is offline-proof.
      void ensureShow();

      // In show mode the phone must not go to sleep; re-request on resume.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && current?.route === 'show') {
          void wakeLock.request();
        }
      });
    },
  };
}

export { parseSeatParams };
