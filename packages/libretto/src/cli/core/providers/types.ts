export type ProviderSession = {
  sessionId: string; // remote session id for cleanup
  cdpEndpoint: string; // CDP WebSocket URL
};

export type ProviderApi = {
  createSession(): Promise<ProviderSession>;
  closeSession(sessionId: string): Promise<void>;
};
