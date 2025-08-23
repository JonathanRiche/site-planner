import puppeteer from '@cloudflare/puppeteer';

interface SessionInfo {
  sessionId: string;
  lastUsed: number;
  inUse: boolean;
  createdAt: number;
}

export class SimpleBrowserSessionManager implements DurableObject {
  private sessions = new Map<string, SessionInfo>();
  private env: any;
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: any) {
    this.ctx = ctx;
    this.env = env;
    
    // Schedule cleanup every 60 seconds
    this.ctx.storage.setAlarm(Date.now() + 60000);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();

    try {
      switch (action) {
        case 'acquire':
          return await this.acquireSession();
        case 'release':
          return await this.releaseSession(request);
        case 'status':
          return await this.getStatus();
        case 'cleanup':
          return await this.cleanup();
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      console.error('SessionManager error:', error);
      return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
    }
  }

  async acquireSession(): Promise<Response> {
    const requestId = Math.random().toString(36).substring(7);
    
    // First, try to find an available session
    const availableSession = this.findAvailableSession();
    
    if (availableSession) {
      // Mark as in use
      availableSession.inUse = true;
      availableSession.lastUsed = Date.now();
      
      console.log(`[${requestId}] ♻️ Reusing session: ${availableSession.sessionId}`);
      
      return new Response(JSON.stringify({
        sessionId: availableSession.sessionId,
        isReused: true,
        totalSessions: this.sessions.size
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // No available sessions, check limits
    const maxSessions = 8;
    if (this.sessions.size >= maxSessions) {
      return new Response(JSON.stringify({
        error: 'Session limit reached',
        maxSessions,
        currentSessions: this.sessions.size
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    // Create new session
    console.log(`[${requestId}] 🚀 Creating new session...`);
    const startTime = Date.now();
    
    try {
      const browser = await puppeteer.launch(this.env.MYBROWSER);
      const sessionId = browser.sessionId();
      
      // CRITICAL: Disconnect immediately so it can be reconnected to
      browser.disconnect();
      
      const sessionInfo: SessionInfo = {
        sessionId,
        lastUsed: Date.now(),
        inUse: true,
        createdAt: Date.now()
      };
      
      this.sessions.set(sessionId, sessionInfo);
      
      const createTime = Date.now() - startTime;
      console.log(`[${requestId}] ✅ New session created: ${sessionId} (${createTime}ms)`);

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

  async releaseSession(request: Request): Promise<Response> {
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

    // Mark as available for reuse
    session.inUse = false;
    session.lastUsed = Date.now();
    
    console.log(`[${requestId}] ✅ Session released and available for reuse: ${sessionId}`);

    return new Response(JSON.stringify({
      success: true,
      sessionId,
      totalSessions: this.sessions.size
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getStatus(): Promise<Response> {
    const sessions = Array.from(this.sessions.values());
    const inUseSessions = sessions.filter(s => s.inUse);
    const availableSessions = sessions.filter(s => !s.inUse);
    
    return new Response(JSON.stringify({
      totalSessions: sessions.length,
      inUseSessions: inUseSessions.length,
      availableSessions: availableSessions.length,
      maxSessions: 8,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId.substring(0, 8) + '...',
        inUse: s.inUse,
        lastUsed: new Date(s.lastUsed).toISOString(),
        ageMinutes: Math.round((Date.now() - s.createdAt) / (1000 * 60))
      }))
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async cleanup(): Promise<Response> {
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    const sessionsToRemove: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.inUse && (now - session.lastUsed) > staleThreshold) {
        sessionsToRemove.push(sessionId);
      }
    }

    // Remove stale sessions
    for (const sessionId of sessionsToRemove) {
      try {
        // Try to properly close the browser session
        const browser = await puppeteer.connect(this.env.MYBROWSER, sessionId);
        await browser.close();
      } catch (error) {
        console.warn(`Failed to close session ${sessionId}:`, error);
      }
      this.sessions.delete(sessionId);
    }

    if (sessionsToRemove.length > 0) {
      console.log(`🧹 Cleaned up ${sessionsToRemove.length} stale sessions`);
    }

    return new Response(JSON.stringify({
      cleanedSessions: sessionsToRemove.length,
      remainingSessions: this.sessions.size
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async alarm(): Promise<void> {
    console.log('⏰ Running scheduled session cleanup...');
    await this.cleanup();
    
    // Schedule next cleanup
    this.ctx.storage.setAlarm(Date.now() + 60000);
  }

  private findAvailableSession(): SessionInfo | undefined {
    // Find the most recently used available session
    let bestSession: SessionInfo | undefined;
    let mostRecentUsed = 0;
    
    for (const session of this.sessions.values()) {
      if (!session.inUse && session.lastUsed > mostRecentUsed) {
        bestSession = session;
        mostRecentUsed = session.lastUsed;
      }
    }
    
    return bestSession;
  }
}