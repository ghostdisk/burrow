import { Agent, Agents } from './agent';
import { createMessage, Message } from './llm';
import fs from 'node:fs/promises';
import path from 'node:path';
import html from './ui/index.html';

const SESSIONS_DIR = process.argv[2] || 'sessions';

let websockets: Bun.ServerWebSocket<unknown>[] = [];

function broadcast(data: any) {
  const str = JSON.stringify(data);
  for (const ws of websockets) {
    ws.send(str);
  }
}

function makeAgentUI(agent: Agent) {
  return {
    onStream: (msg: Partial<Message>, delta: Partial<Message>) => {
      broadcast({
        type: 'delta',
        agentId: agent.id,
        messageId: msg.custom?.id,
        role: msg.role,
        delta: {
          content: delta.content,
          reasoning_content: delta.reasoning_content,
          tool_calls: delta.tool_calls,
        },
      });
    },
  };
}

function sessionPath(name: string): string {
  // Sanitize: replace path separators, keep mostly clean
  const safe = name.replace(/[/\\\0]/g, '_');
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

async function saveAgent(agent: Agent) {
  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    await fs.writeFile(
      sessionPath(agent.name),
      JSON.stringify(agent.messages, null, 2),
      { encoding: 'utf-8' },
    );
  } catch (err) {
    console.error(`Failed to save session for ${agent.name}:`, err);
  }
}

async function loadAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];

  try {
    const entries = await fs.readdir(SESSIONS_DIR);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;

      const filepath = path.join(SESSIONS_DIR, entry);
      const name = entry.slice(0, -5); // strip .json

      try {
        const data = await fs.readFile(filepath, { encoding: 'utf-8' });
        const messages: Message[] = JSON.parse(data);

        // Replace stale system prompt with current one
        if (messages.length > 0 && messages[0].role === 'system') {
          messages[0] = createMessage('system', Agents.systemPrompt);
        } else {
          messages.unshift(createMessage('system', Agents.systemPrompt));
        }

        const agent = new Agent({ name, messages });
        agent.ui = makeAgentUI(agent);
        agents.push(agent);

        console.log(`Loaded session for "${name}" (${messages.length} messages).`);
      } catch (err: any) {
        if (err.code === 'ENOENT') continue;
        console.error(`Error loading session "${entry}":`, err.message);
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error(`Error reading sessions directory:`, err.message);
    }
  }

  return agents;
}

async function main() {
  await Agents.init();

  const loadedAgents = await loadAgents();

  if (loadedAgents.length === 0) {
    console.log(`No sessions found, creating default agent (saving to ${SESSIONS_DIR}/).`);
    const mainAgent = new Agent({
      name: 'Main Agent',
      messages: [createMessage('system', Agents.systemPrompt)],
    });
    mainAgent.ui = makeAgentUI(mainAgent);
    await saveAgent(mainAgent);
    loadedAgents.push(mainAgent);
  }

  // Track interrupts per agent
  const interruptFlags = new WeakMap<Agent, boolean>();
  let chatCounter = loadedAgents.length;

  Bun.serve({
    port: 3000,
    routes: {
      '/': html,
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response('Upgrade failed', { status: 500 });
    },
    websocket: {
      open(ws) {
        websockets.push(ws);
        ws.send(JSON.stringify({
          type: 'hello',
          agents: Agents.all.map(agent => ({
            id: agent.id,
            name: agent.name,
            messages: agent.messages,
          })),
        }));
      },
      message(ws, raw) {
        const msg = JSON.parse(raw as string);

        switch (msg.type) {
          case 'run': {
            const agent = Agents.all.find(a => a.id === msg.agentId);
            if (!agent) return;
            if (!agent.done) return;

            interruptFlags.set(agent, false);

            const userMsg = createMessage('user', msg.content);
            agent.messages.push(userMsg);

            broadcast({
              type: 'user_message',
              agentId: agent.id,
              message: userMsg,
            });

            agent.run({
              onMessage: (toolMsg, opts) => {
                broadcast({
                  type: 'tool_result',
                  agentId: agent.id,
                  message: toolMsg,
                  error: opts?.error || false,
                });
              },
            }).then(() => {
              broadcast({
                type: 'done',
                agentId: agent.id,
                interrupted: interruptFlags.get(agent) || false,
              });
              saveAgent(agent);
            });
            break;
          }
          case 'create_agent': {
            chatCounter++;
            const agent = new Agent({
              name: `Chat ${chatCounter}`,
              messages: [createMessage('system', Agents.systemPrompt)],
            });
            agent.ui = makeAgentUI(agent);
            saveAgent(agent);
            broadcast({
              type: 'agent_created',
              agent: {
                id: agent.id,
                name: agent.name,
                messages: agent.messages,
              },
            });
            break;
          }
          case 'interrupt': {
            const agent = Agents.all.find(a => a.id === msg.agentId);
            if (!agent) return;
            interruptFlags.set(agent, true);
            agent.interrupt();
            break;
          }
        }
      },
      close(ws) {
        websockets = websockets.filter(w => w !== ws);
      },
    },
  });
  console.log('Serving at :3000');
}

main();
