import { aiAgentChat } from './ai-agent.js';

/**
 * Store conversation history per session
 */
const conversationSessions = new Map();

/**
 * Validate AI admin token
 */
function requireAIToken(req, res) {
  const token = (req.headers['x-ai-token'] || '').trim();
  const expected = (process.env.AI_AGENT_TOKEN || '').trim();
  
  if (!expected) {
    console.warn('[AI-AGENT] AI_AGENT_TOKEN not configured');
    res.status(503).json({ error: 'AI agent not configured' });
    return false;
  }

  if (token !== expected) {
    res.status(401).json({ error: 'Invalid AI token' });
    return false;
  }

  return true;
}

/**
 * Initialize AI agent routes
 */
export function setupAIRoutes(app) {
  /**
   * POST /api/ai/chat
   * Send a request to ChatGPT with repo modification capabilities
   */
  app.post('/api/ai/chat', async (req, res) => {
    if (!requireAIToken(req, res)) return;

    try {
      const { request, sessionId } = req.body;

      if (!request) {
        return res.status(400).json({ error: 'request required' });
      }

      const sid = sessionId || 'default';
      const previousMessages = conversationSessions.get(sid) || [];

      console.log(`[AI-AGENT] Session ${sid}: ${request}`);

      const result = await aiAgentChat(request, previousMessages);

      // Store updated messages for this session
      conversationSessions.set(sid, result.messages);

      res.json({
        ok: true,
        response: result.response,
        sessionId: sid,
      });
    } catch (e) {
      console.error('[AI-AGENT] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/ai/session/:sessionId
   * Get conversation history for a session
   */
  app.get('/api/ai/session/:sessionId', (req, res) => {
    if (!requireAIToken(req, res)) return;

    const messages = conversationSessions.get(req.params.sessionId) || [];
    res.json({ ok: true, sessionId: req.params.sessionId, messages });
  });

  /**
   * DELETE /api/ai/session/:sessionId
   * Clear conversation history for a session
   */
  app.delete('/api/ai/session/:sessionId', (req, res) => {
    if (!requireAIToken(req, res)) return;

    conversationSessions.delete(req.params.sessionId);
    res.json({ ok: true, message: 'Session cleared' });
  });

  /**
   * GET /api/ai/tools
   * List available tools
   */
  app.get('/api/ai/tools', (req, res) => {
    if (!requireAIToken(req, res)) return;

    res.json({
      ok: true,
      tools: [
        'read_file',
        'write_file',
        'list_files',
        'create_branch',
        'create_pull_request',
        'search_code',
        'get_file_structure',
      ],
    });
  });

  /**
   * POST /api/ai/direct-tool
   * Execute a tool directly (for testing)
   */
  app.post('/api/ai/direct-tool', async (req, res) => {
    if (!requireAIToken(req, res)) return;

    try {
      const { tool, params } = req.body;

      if (!tool || !params) {
        return res.status(400).json({ error: 'tool and params required' });
      }

      const { executeTool } = await import('./ai-agent.js');
      const result = await executeTool(tool, params);

      res.json({ ok: true, result });
    } catch (e) {
      console.error('[AI-AGENT] Direct tool error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[AI-AGENT] Routes initialized');
}

export default { setupAIRoutes, requireAIToken };
