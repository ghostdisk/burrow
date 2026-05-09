let ws: WebSocket;

interface AgentData {
  id: string;
  name: string;
  messages: any[];
}

// Per-agent UI state
interface AgentState {
  data: AgentData;
  button: HTMLDivElement;
  chatEl: HTMLDivElement;
  messageEls: Map<string, HTMLDivElement>; // message custom.id -> element
  streamingMsgId: string | null;
  streamingEl: HTMLDivElement | null;
  running: boolean;
}

let agents: AgentState[] = [];
let selectedAgent: AgentState | null = null;

const INTERRUPT_NOTE = '\n\n[User interrupted this request]';

// --- Selection ---

function selectAgent(agent: AgentState) {
  selectedAgent = agent;
  agents.forEach(a => a.button.classList.toggle('active', a === agent));

  const container = document.getElementById('chat-container')!;
  container.children[0]?.remove();
  container.append(agent.chatEl);

  updateSendButton();
  scrollToBottom();
}

// --- Message elements ---

function createMessageEl(msg: any): HTMLDivElement | null {
  // Don't render system messages
  if (msg.role === 'system') return null;

  const el = document.createElement('div');
  el.classList.add('message');
  el.dataset.msgId = msg.custom?.id || '';

  if (msg.role === 'user') {
    el.classList.add('user');
    el.textContent = msg.content;
  } else if (msg.role === 'assistant') {
    el.classList.add('assistant');
    if (msg.reasoning_content) {
      const thinking = document.createElement('div');
      thinking.classList.add('thinking');
      thinking.textContent = msg.reasoning_content;
      el.append(thinking);
    }
    if (msg.content) {
      const content = document.createElement('div');
      content.classList.add('msg-content');
      content.textContent = msg.content;
      el.append(content);
    }
  } else if (msg.role === 'tool') {
    el.classList.add('tool');
    if (msg.content) {
      const content = document.createElement('div');
      content.classList.add('msg-content');
      content.textContent = msg.content;
      el.append(content);
    }
    if (msg.tool_call_id) {
      el.dataset.toolCallId = msg.tool_call_id;
    }
  }

  return el;
}

function getOrCreateStreamingEl(agent: AgentState, msgId: string, role: string): HTMLDivElement {
  if (agent.streamingMsgId === msgId && agent.streamingEl) {
    return agent.streamingEl;
  }

  // Finalize previous streaming element
  if (agent.streamingEl) {
    agent.streamingEl.classList.remove('streaming');
  }

  const el = document.createElement('div');
  el.classList.add('message', 'streaming');
  el.dataset.msgId = msgId;

  if (role === 'assistant' || role === 'unknown') {
    el.classList.add('assistant');
  }

  agent.streamingMsgId = msgId;
  agent.streamingEl = el;
  agent.messageEls.set(msgId, el);
  agent.chatEl.append(el);

  return el;
}

function applyDelta(agent: AgentState, msgId: string, role: string, delta: any) {
  const wasAtBottom = isNearBottom();
  const el = getOrCreateStreamingEl(agent, msgId, role);

  if (delta.reasoning_content) {
    let thinking = el.querySelector('.thinking') as HTMLDivElement;
    if (!thinking) {
      thinking = document.createElement('div');
      thinking.classList.add('thinking');
      el.append(thinking);
    }
    thinking.textContent += delta.reasoning_content;
  }

  if (delta.content) {
    let content = el.querySelector('.msg-content') as HTMLDivElement;
    if (!content) {
      content = document.createElement('div');
      content.classList.add('msg-content');
      el.append(content);
    }
    content.textContent += delta.content;
    // Collapse thinking once real content starts
    const thinking = el.querySelector('.thinking') as HTMLDivElement;
    if (thinking) thinking.classList.add('collapsed');
  }

  if (delta.tool_calls) {
    let tools = el.querySelector('.tool-calls') as HTMLDivElement;
    if (!tools) {
      tools = document.createElement('div');
      tools.classList.add('tool-calls');
      el.append(tools);
    }
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) {
        const line = document.createElement('div');
        line.classList.add('tool-call-line');
        line.textContent = `- ${tc.function.name} ${tc.function.arguments || ''}`;
        tools.append(line);
      }
    }
  }

  if (wasAtBottom) scrollToBottom();
}

function finalizeStreaming(agent: AgentState, interrupted: boolean) {
  if (!agent.streamingEl) return;
  agent.streamingEl.classList.remove('streaming');

  if (interrupted) {
    let content = agent.streamingEl.querySelector('.msg-content') as HTMLDivElement;
    if (!content) {
      content = document.createElement('div');
      content.classList.add('msg-content');
      agent.streamingEl.append(content);
    }
    content.textContent += INTERRUPT_NOTE;
  }

  agent.streamingMsgId = null;
  agent.streamingEl = null;
}

function addMessage(agent: AgentState, msg: any) {
  if (msg.role === 'system') return;
  // Don't add if we already have this message
  if (msg.custom?.id && agent.messageEls.has(msg.custom.id)) return;

  const wasAtBottom = isNearBottom();

  const el = createMessageEl(msg);
  if (!el) return;
  if (msg.custom?.id) agent.messageEls.set(msg.custom.id, el);
  agent.chatEl.append(el);

  if (wasAtBottom) scrollToBottom();
}

function isNearBottom(): boolean {
  const scroller = document.querySelector('.main-scroll')!;
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50;
}

function scrollToBottom() {
  const scroller = document.querySelector('.main-scroll')!;
  requestAnimationFrame(() => {
    scroller.scrollTop = scroller.scrollHeight;
  });
}

// --- Input ---

function updateSendButton() {
  const btn = document.getElementById('send-btn') as HTMLButtonElement;
  const input = document.getElementById('input') as HTMLTextAreaElement;

  if (selectedAgent?.running) {
    btn.textContent = 'Interrupt';
    btn.disabled = false;
    btn.classList.add('interrupt');
  } else {
    btn.textContent = 'Send';
    btn.disabled = !selectedAgent || input.value.trim() === '';
    btn.classList.remove('interrupt');
  }
}

function sendOrInterrupt() {
  if (!selectedAgent) return;

  if (selectedAgent.running) {
    ws.send(JSON.stringify({ type: 'interrupt', agentId: selectedAgent.data.id }));
    return;
  }

  const input = document.getElementById('input') as HTMLTextAreaElement;
  const content = input.value.trim();
  if (!content) return;

  ws.send(JSON.stringify({ type: 'run', agentId: selectedAgent.data.id, content }));
  input.value = '';
  input.style.height = 'auto';
  updateSendButton();
}

// Double-ESC interrupt
let lastEscTime = 0;
const DOUBLE_ESC_MS = 500;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const now = Date.now();
    if (now - lastEscTime < DOUBLE_ESC_MS && selectedAgent?.running) {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'interrupt', agentId: selectedAgent.data.id }));
    }
    lastEscTime = now;
  }

  // Ctrl+Enter to send
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    sendOrInterrupt();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('input') as HTMLTextAreaElement;
  const btn = document.getElementById('send-btn') as HTMLButtonElement;

  input.addEventListener('input', () => {
    // Auto-grow
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    updateSendButton();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      sendOrInterrupt();
    }
  });

  btn.addEventListener('click', sendOrInterrupt);
});

// --- Connection ---

function handleNewAgent(data: AgentData) {
  const agent: AgentState = {
    data,
    button: null!,
    chatEl: null!,
    messageEls: new Map(),
    streamingMsgId: null,
    streamingEl: null,
    running: false,
  };

  const button = document.createElement('div');
  button.classList.add('button');
  button.textContent = data.name;
  button.onpointerdown = () => selectAgent(agent);
  agent.button = button;

  const chatEl = document.createElement('div');
  chatEl.classList.add('chat');
  agent.chatEl = chatEl;

  // Render existing messages
  for (const msg of data.messages) {
    const el = createMessageEl(msg);
    if (!el) continue;
    if (msg.custom?.id) agent.messageEls.set(msg.custom.id, el);
    chatEl.append(el);
  }

  document.getElementById('chats-list')!.append(button);

  agents.push(agent);

  if (!selectedAgent) selectAgent(agent);
}

function manageConnection() {
  ws = new WebSocket('/ws');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    switch (msg.type) {
      case 'hello': {
        for (const agentData of msg.agents) {
          handleNewAgent(agentData);
        }
        break;
      }
      case 'user_message': {
        const agent = agents.find(a => a.data.id === msg.agentId);
        if (!agent) return;
        addMessage(agent, msg.message);
        break;
      }
      case 'delta': {
        const agent = agents.find(a => a.data.id === msg.agentId);
        if (!agent) return;
        applyDelta(agent, msg.messageId, msg.role, msg.delta);
        break;
      }
      case 'tool_result': {
        const agent = agents.find(a => a.data.id === msg.agentId);
        if (!agent) return;
        // If we're currently streaming and about to add a tool result, finalize
        // the streaming el first (tool results are separate messages)
        if (agent.streamingEl) {
          agent.streamingEl.classList.remove('streaming');
          agent.streamingEl = null;
          agent.streamingMsgId = null;
        }
        addMessage(agent, msg.message);
        break;
      }
      case 'done': {
        const agent = agents.find(a => a.data.id === msg.agentId);
        if (!agent) return;
        const wasAtBottom = isNearBottom();
        finalizeStreaming(agent, msg.interrupted);
        agent.running = false;
        updateSendButton();
        if (wasAtBottom) scrollToBottom();
        break;
      }
    }
  };

  ws.onopen = () => {
    document.querySelector('#connection-overlay')!.classList.add('hidden');
  };

  ws.onclose = () => {
    document.querySelector('#connection-overlay')!.classList.remove('hidden');
    // Clear all agents on disconnect
    agents = [];
    selectedAgent = null;
    document.getElementById('chats-list')!.innerHTML = '';
    document.getElementById('chat-container')!.children[0]?.remove();
    updateSendButton();
  };

  // Detect agent running state from protocol (set running=true when we send 'run')
  const origSend = ws.send.bind(ws);
  ws.send = function(data: any) {
    try {
      const msg = JSON.parse(data as string);
      if (msg.type === 'run') {
        const agent = agents.find(a => a.data.id === msg.agentId);
        if (agent) {
          agent.running = true;
          updateSendButton();
        }
      }
    } catch {}
    return origSend(data);
  };
}

async function main() {
  manageConnection();
}

main();
