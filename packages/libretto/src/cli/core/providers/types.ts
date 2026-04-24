export type ProviderSession = {
  sessionId: string; // remote session id for cleanup
  cdpEndpoint: string; // CDP WebSocket URL
  // Provider-hosted URL for watching the session live while it's running.
  // Only libretto-cloud surfaces this today; direct-SDK providers leave it
  // undefined.
  liveViewUrl?: string;
};

export type ProviderCloseResult = {
  // Provider-hosted URL for playback of the session recording, surfaced on
  // successful close. Undefined when the provider didn't capture a
  // recording or doesn't return one on close.
  replayUrl?: string;
};

export type ProviderApi = {
  createSession(): Promise<ProviderSession>;
  closeSession(sessionId: string): Promise<ProviderCloseResult>;
};
