let ws: WebSocket;

let agents: any[] = [];
let selectedAgent: any = null;

function selectAgent(agent: any) {
  selectedAgent = agent;
  agents.forEach(a => a.button.classList.toggle('active', a === agent));

  const chatContainer = document.getElementById('chat-container')!;
  chatContainer.children[0]?.remove();
  chatContainer.append(agent.chatEl);
}

function handleNewAgent(agent: any) {
  agents.push(agent);

  const button = document.createElement('div');
  button.classList = 'button';
  button.innerHTML = agent.name;
  button.onpointerdown = () => selectAgent(agent);

  const chatEl = document.createElement('div');
  chatEl.classList = 'chat';
  agent.chatEl = chatEl;

  agent.messageEls = [];
  agent.button = button;

  document.getElementById('chats-list')!.append(button);

  for (const message of agent.messages) {
    const messageEl = document.createElement('div');
    messageEl.classList = 'message';
    messageEl.innerText = message.content;
    chatEl.append(messageEl);
  }

  if (!selectedAgent) selectAgent(agent);
}

function manageConnection() {

  ws = new WebSocket('/ws');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    switch (msg.type) {
      case 'hello': {
        for (const agent of msg.agents) handleNewAgent(agent);
        break;
      }
    }

    console.log(msg);
  }

  ws.onopen = () => {
    document.querySelector('#connection-overlay')!.classList.add('hidden');
  };

  ws.onclose = () => {
    document.querySelector('#connection-overlay')!.classList.remove('hidden');
  };
}


async function main() {
  manageConnection();
}

main();

