import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { corsOptions } from '../../../config/cors.js';
import { videoChatSchema } from '../videoChat.schema.js';

const pagination = {
  page: z.int().positive().optional(),
  limit: z.int().min(1).max(100).optional(),
};
const byId = z.strictObject({ id: z.uuid() });
const query = z.string().trim().min(1);
const tags = z.string().describe('Comma-separated tags').optional();
const progressStep = z.string().trim().optional().describe(
  'Short status message in the user’s language to display while this tool runs, e.g. “Searching for the video…”',
);

async function reportToolProgress(sessionId, siteDomain, step, signal) {
  const token = process.env.AI_CHATBOT_PLATFORM_BEARER_TOKEN;
  if (!sessionId || !siteDomain || !step || !token) return;

  try {
    const response = await fetch('https://ai-chatbot-platform.fly.dev/api/webhooks/n8n/progress', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, step, site_domain: siteDomain }),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    });
    if (!response.ok) console.warn(`MCP progress webhook returned HTTP ${response.status}`);
    await response.body?.cancel();
  } catch {
    if (!signal.aborted) console.warn('MCP progress webhook request failed');
  }
}

function createAiMcpServer(baseUrl, authorization, sessionId, siteDomain) {
  const server = new McpServer({ name: 'optiflowz-video-platform', version: '1.0.0' });

  function register(name, path, description, inputSchema, method = 'GET') {
    const schema = inputSchema.extend({ step: progressStep });
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: true } },
      async (args, { signal }) => {
        const { id, step, ...params } = args;
        await reportToolProgress(sessionId, siteDomain, step, signal);
        const url = new URL(id ? path.replace(':id', id) : path, baseUrl);
        const headers = { Authorization: authorization, Accept: 'application/json' };
        const options = {
          method, headers, redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        };
        if (method === 'GET') {
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
        } else {
          headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(params);
        }

        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`AI route returned HTTP ${response.status} (${response.statusText})`);
        }
        const data = await response.json();
        return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
      });
  }

  register('search_videos', 'videos/search', 'Find public videos by semantic similarity to a search query.',
    z.strictObject({
      q: query, category: z.string().optional(), person: z.uuid().optional(), tags,
      sort: z.enum(['relevance', 'date', 'views', 'likes']).optional(), ...pagination,
    }));
  register('get_video', 'videos/:id', 'Get video details by ID without recording a view.', byId);
  register('get_video_chat_sources', 'videos/chat',
    'Retrieve evidence for a question about one to five videos. Use transcript_chunk for timestamped citations, overview for descriptions, and summary mode for chronological excerpts.',
    videoChatSchema, 'POST');
  register('search_playlists', 'playlists/search', 'Find public playlists by text or tags.',
    z.strictObject({
      q: query.optional(), tags, sort: z.enum(['relevance', 'date', 'views', 'videos']).optional(), ...pagination,
    }));
  register('get_playlist', 'playlists/:id', 'Get playlist details by ID without recording a view.', byId);
  register('get_playlist_videos', 'playlists/:id/videos', 'List videos in a playlist, in playlist order by default.',
    z.strictObject({
      id: z.uuid(), ...pagination, sortBy: z.enum(['position', 'created_at', 'view_count']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }));
  register('search_people', 'people/search', 'Find speakers by name or search text.',
    z.strictObject({ q: query, page: pagination.page, limit: z.int().min(1).max(50).optional() }));
  register('get_person', 'people/:id', 'Get the name, description and image of a speaker by ID.', byId);
  return server;
}

export async function handleAiMcp(req, res) {
  const origin = req.get('Origin');
  if (origin !== undefined && !corsOptions.origin.includes(origin)) return res.sendStatus(403);
  if (req.method !== 'POST') return res.set('Allow', 'POST').sendStatus(405);

  // The API listens on IPv4. Never derive the bearer token's destination from client headers.
  const baseUrl = `http://127.0.0.1:${req.socket.localPort}/api/ai/`;
  const { session_id, site_domain } = req.query;
  const sessionId = typeof session_id === 'string' ? session_id.trim() : '';
  const siteDomain = typeof site_domain === 'string' ? site_domain.trim() : '';
  const server = createAiMcpServer(baseUrl, req.get('Authorization'), sessionId, siteDomain);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  res.once('close', () => server.close());
  await transport.handleRequest(req, res, req.body);
}
