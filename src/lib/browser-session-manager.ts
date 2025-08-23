import puppeteer, { Browser } from '@cloudflare/puppeteer';

export interface BrowserSession {
  sessionId: string;
  lastUsed: number;
  isActive: boolean;
  createdAt: number;
}

export interface SessionRequestOptions {
  priority?: 'high' | 'normal';
  maxWaitTime?: number;
}

export class BrowserSessionManager implements DurableObject {
  private sessions = new Map<string, BrowserSession>();
  private env: any;
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: any) {
    this.ctx = ctx;
    this.env = env;

    // Schedule initial cleanup
    this.ctx.storage.setAlarm(Date.now() + 30000);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = url.pathname.split('/').pop();

    try {
      switch (method) {
        case 'acquire':
          return await this.handleAcquireSession(request);
        case 'release':
          return await this.handleReleaseSession(request);
        case 'cleanup':
          return await this.handleCleanup();
        case 'status':
          return await this.handleStatus();
        default:
          return new Response('Method not found', { status: 404 });
      }
    } catch (error) {
      console.error('BrowserSessionManager error:', error);
      return new Response(`Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
    }
  }

  async handleAcquireSession(request: Request): Promise<Response> {
    const body = await request.json() as SessionRequestOptions;
    const requestId = Math.random().toString(36).substring(7);

    console.log(`[${requestId}] 🔄 Session acquisition request`, {
      currentSessions: this.sessions.size,
      priority: body.priority || 'normal'
    });

    // First, try to find an available existing session
    let availableSession = this.findAvailableSession();

    if (availableSession) {
      console.log(`[${requestId}] ♻️ Reusing existing session: ${availableSession.sessionId}`);
      availableSession.isActive = true;
      availableSession.lastUsed = Date.now();

      return new Response(JSON.stringify({
        sessionId: availableSession.sessionId,
        isReused: true,
        totalSessions: this.sessions.size
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // No available session, check if we can create a new one
    const maxSessions = this.getMaxSessions();
    if (this.sessions.size >= maxSessions) {
      console.warn(`[${requestId}] ⚠️ Session limit reached (${this.sessions.size}/${maxSessions})`);

      // Try to cleanup stale sessions first
      await this.cleanupStaleSessions();

      // Check again after cleanup
      availableSession = this.findAvailableSession();
      if (availableSession) {
        console.log(`[${requestId}] ♻️ Found session after cleanup: ${availableSession.sessionId}`);
        availableSession.isActive = true;
        availableSession.lastUsed = Date.now();

        return new Response(JSON.stringify({
          sessionId: availableSession.sessionId,
          isReused: true,
          totalSessions: this.sessions.size
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Still no space, return error
      return new Response(JSON.stringify({
        error: 'Session limit reached',
        maxSessions,
        currentSessions: this.sessions.size
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create new session
    console.log(`[${requestId}] 🚀 Creating new browser session...`);
    const startTime = Date.now();
    
    try {
      const browser = await puppeteer.launch(this.env.MYBROWSER);
      const sessionId = browser.sessionId();
      const createTime = Date.now() - startTime;
      
      // IMPORTANT: Disconnect immediately to allow reconnection
      // The browser session stays alive but can be reconnected to
      browser.disconnect();
      
      const session: BrowserSession = {
        sessionId,
        lastUsed: Date.now(),
        isActive: true,
        createdAt: Date.now()
      };

      this.sessions.set(sessionId, session);
      
      console.log(`[${requestId}] ✅ New session created and made available: ${sessionId} (${createTime}ms)`, {
        totalSessions: this.sessions.size,
        maxSessions
      });

      return new Response(JSON.stringify({
        sessionId,
        isReused: false,
        createTime,
        totalSessions: this.sessions.size
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error(`[${requestId}] ❌ Failed to create session:`, error);
      throw error;
    }
  }

  async handleReleaseSession(request: Request): Promise<Response> {
    const { sessionId } = await request.json() as { sessionId: string };
    const requestId = Math.random().toString(36).substring(7);

    console.log(`[${requestId}] 🔓 Releasing session: ${sessionId}`);

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[${requestId}] ⚠️ Session not found: ${sessionId}`);
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Mark as inactive but don't close - keep for reuse
    session.isActive = false;
    session.lastUsed = Date.now();

    console.log(`[${requestId}] ✅ Session released: ${sessionId}`, {
      activeSessions: Array.from(this.sessions.values()).filter(s => s.isActive).length,
      totalSessions: this.sessions.size
    });

    return new Response(JSON.stringify({
      success: true,
      sessionId,
      totalSessions: this.sessions.size
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async handleStatus(): Promise<Response> {
    const sessions = Array.from(this.sessions.values());
    const activeSessions = sessions.filter(s => s.isActive);
    const inactiveSessions = sessions.filter(s => !s.isActive);

    const status = {
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      inactiveSessions: inactiveSessions.length,
      maxSessions: this.getMaxSessions(),
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        isActive: s.isActive,
        lastUsed: new Date(s.lastUsed).toISOString(),
        ageMs: Date.now() - s.lastUsed
      }))
    };

    return new Response(JSON.stringify(status, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async handleCleanup(): Promise<Response> {
    const cleaned = await this.cleanupStaleSessions();

    return new Response(JSON.stringify({
      cleanedSessions: cleaned,
      remainingSessions: this.sessions.size
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async alarm(): Promise<void> {
    console.log('🧹 Running scheduled session cleanup...');
    await this.cleanupStaleSessions();

    // Schedule next cleanup
    this.ctx.storage.setAlarm(Date.now() + 30000);
  }

  private findAvailableSession(): BrowserSession | undefined {
    // Find the most recently used inactive session
    let bestSession: BrowserSession | undefined;
    let bestLastUsed = 0;

    for (const session of this.sessions.values()) {
      if (!session.isActive && session.lastUsed > bestLastUsed) {
        bestSession = session;
        bestLastUsed = session.lastUsed;
      }
    }

    return bestSession;
  }

  private async cleanupStaleSessions(): Promise<number> {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const sessionsToClose: string[] = [];

    // Find stale inactive sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.isActive && (now - session.lastUsed) > staleThreshold) {
        sessionsToClose.push(sessionId);
      }
    }

    // Close and remove stale sessions
    for (const sessionId of sessionsToClose) {
      const session = this.sessions.get(sessionId);
      if (session) {
        try {
          console.log(`🗑️ Closing stale session: ${sessionId} (inactive for ${Math.round((now - session.lastUsed) / 1000)}s)`);
          // Connect to session just to close it properly
          const browser = await puppeteer.connect(this.env.MYBROWSER, sessionId);
          await browser.close();
        } catch (error) {
          console.warn(`Failed to close session ${sessionId}:`, error);
        }
        this.sessions.delete(sessionId);
      }
    }

    if (sessionsToClose.length > 0) {
      console.log(`✅ Cleaned up ${sessionsToClose.length} stale sessions`);
    }

    return sessionsToClose.length;
  }

  private getMaxSessions(): number {
    // These limits are based on Cloudflare's documentation
    // Free tier: 3 concurrent, Paid tier: 10 concurrent
    // We'll be conservative and use slightly lower numbers to avoid hitting limits
    return 8; // Conservative limit for paid tier
  }

  async getSessionForConnection(sessionId: string): Promise<Browser | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.isActive) {
      return null;
    }

    // Try to reconnect to verify the session is still valid
    try {
      const browser = await puppeteer.connect(this.env.MYBROWSER, sessionId);
      // Disconnect immediately - we just wanted to verify it's alive
      browser.disconnect();
      return browser;
    } catch (error) {
      // Session is stale, remove it
      console.warn(`Removing stale session: ${sessionId}`, error);
      this.sessions.delete(sessionId);
      return null;
    }
  }
}
