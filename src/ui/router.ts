// Minimal screen router. A Screen owns one full-viewport view; the router owns
// mounting, teardown and the back stack. Screens never mount each other
// directly -- they call navigate(), so every screen stays independently testable.
export interface Screen {
  /** Build the DOM for this screen. Called once per mount. */
  mount(host: HTMLElement, nav: Navigator): void | Promise<void>;
  /** Release cameras, timers, animation frames. Always called before unmount. */
  unmount?(): void;
}

export interface Navigator {
  go(screen: Screen, opts?: { replace?: boolean }): Promise<void>;
  back(): Promise<void>;
  /** Depth of the back stack, for progress indicators. */
  depth(): number;
}

export function createRouter(host: HTMLElement): Navigator {
  const stack: Screen[] = [];
  let current: Screen | null = null;

  async function render(screen: Screen) {
    if (current?.unmount) current.unmount();
    host.replaceChildren();
    current = screen;
    await screen.mount(host, nav);
  }

  const nav: Navigator = {
    async go(screen, opts) {
      if (current && !opts?.replace) stack.push(current);
      await render(screen);
    },
    async back() {
      const prev = stack.pop();
      if (prev) await render(prev);
    },
    depth: () => stack.length,
  };
  return nav;
}
