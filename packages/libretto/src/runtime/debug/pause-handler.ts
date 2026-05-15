export type ActivePauseHandler = (args: {
  session: string;
  pausedAt: string;
  url?: string;
}) => Promise<void>;

let activePauseHandler: ActivePauseHandler | undefined;

export function installPauseHandler(handler: ActivePauseHandler): () => void {
  const previousHandler = activePauseHandler;
  activePauseHandler = handler;

  return () => {
    activePauseHandler = previousHandler;
  };
}

export function getActivePauseHandler(): ActivePauseHandler | undefined {
  return activePauseHandler;
}
