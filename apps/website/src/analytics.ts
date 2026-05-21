type FathomOptions = {
  _value?: number;
};

type FathomClient = {
  trackEvent: (name: string, options?: FathomOptions) => void;
};

declare global {
  interface Window {
    fathom?: FathomClient;
  }
}

const EVENT_ATTRIBUTE = "data-fathom-event";

let isInitialized = false;

export function initializeFathomClickTracking() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  document.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const trackedElement = target.closest<HTMLElement>(`[${EVENT_ATTRIBUTE}]`);
    const eventName = trackedElement?.dataset.fathomEvent;

    if (!eventName) {
      return;
    }

    window.fathom?.trackEvent(eventName);
  });
}
