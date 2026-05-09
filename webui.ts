import { Agent, Agents } from './agent';
import { createMessage } from './llm';
import html from './ui/index.html';

let websockets: Bun.ServerWebSocket[] = [];

async function main() {

  await Agents.init();

  const agent = new Agent({
    name: 'Main Agent',
    messages: [
      createMessage('system', Agents.systemPrompt),
    ]
  });

  const agent2 = new Agent({
    name: 'Main Agent',
    messages: [
      createMessage('system', Agents.systemPrompt),
    ]
  });

  Bun.serve({
    port: 3000,
    routes: {
      '/': html,
    },
    fetch(req, server) {
      // upgrade the request to a WebSocket
      if (server.upgrade(req)) {
        return; // do not return a Response
      }
      return new Response("Upgrade failed", { status: 500 });
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
        }))
      },
      message(ws, message) {
      },
      close(ws, code, message) {
        websockets = websockets.filter(_ws => ws !== _ws);
      },
      drain(ws) {
      },
    }, // handlers
  });
  console.log('Serving at :3000');

}
main();
