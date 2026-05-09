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
  toolCallMeta: Map<string, { name: string; args: any }>; // tool_call_id -> meta
  toolCallArgBuf: Map<string, string>; // tool_call_id -> accumulated raw args
  lastToolId: string | null;
}

let agents: AgentState[] = [];
let selectedAgent: AgentState | null = null;

const INTERRUPT_NOTE = '\n\n[User interrupted this request]';

// --- Partial JSON fixer ---

function tryParsePartialJson(raw: string): any {
  // Fast path: valid JSON
  try { return JSON.parse(raw); } catch {}

  // Track bracket nesting order so we close in reverse order
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (const ch of raw) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    if (ch === '}') { if (stack[stack.length - 1] === '{') stack.pop(); }
    if (ch === ']') { if (stack[stack.length - 1] === '[') stack.pop(); }
  }

  // If we're inside a string, close it
  let fixed = raw;
  if (inString) fixed += '"';

  // Unwind the stack in reverse (last opened = first closed)
  for (let i = stack.length - 1; i >= 0; i--) {
    fixed += stack[i] === '{' ? '}' : ']';
  }

  try { return JSON.parse(fixed); } catch {}
  return null;
}

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

// --- Tool rendering helpers ---

function renderToolCallLabel(name: string, args: any): HTMLSpanElement {
  const span = document.createElement('span');
  span.classList.add('tool-call-label');

  switch (name) {
    case 'bash': {
      const cmd = (args?.command || '').replace(/\n/g, ' ');
      span.textContent = cmd ? `bash: ${cmd.length > 120 ? cmd.slice(0, 120) + '…' : cmd}` : 'bash';
      break;
    }
    case 'read_file': {
      const path = args?.path;
      if (path) {
        span.textContent = `read_file: ${path}`;
        if (args.start || args.end) {
          span.textContent += ` (lines ${args.start || 1}-${args.end || 'end'})`;
        }
      } else {
        span.textContent = 'read_file';
      }
      break;
    }
    case 'write_file': {
      span.textContent = args?.path ? `write_file: ${args.path}` : 'write_file';
      break;
    }
    case 'edit_file': {
      span.textContent = args?.path ? `edit_file: ${args.path}` : 'edit_file';
      break;
    }
    case 'eval': {
      const code = args?.code || '';
      const preview = code.length > 80 ? code.slice(0, 80).replace(/\n/g, ' ') + '…' : code.replace(/\n/g, ' ');
      span.textContent = preview ? `eval: ${preview}` : 'eval';
      break;
    }
    default: {
      span.textContent = name;
      break;
    }
  }
  return span;
}

function renderDiff(oldStr: string, newStr: string): HTMLDivElement {
  const container = document.createElement('div');
  container.classList.add('diff-container');

  // Show a reasonable preview — if multiline, show up to 6 lines
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const maxLines = 6;

  let oldPreview: string;
  let newPreview: string;

  if (oldLines.length > maxLines || newLines.length > maxLines) {
    // Show first few lines + count
    oldPreview = oldLines.slice(0, maxLines).join('\n');
    if (oldLines.length > maxLines) oldPreview += `\n… (${oldLines.length - maxLines} more lines)`;
    newPreview = newLines.slice(0, maxLines).join('\n');
    if (newLines.length > maxLines) newPreview += `\n… (${newLines.length - maxLines} more lines)`;
  } else {
    oldPreview = oldStr;
    newPreview = newStr;
  }

  const oldEl = document.createElement('div');
  oldEl.classList.add('diff-old');
  oldEl.textContent = oldStr ? `- ${oldPreview}` : '';
  if (oldStr) container.append(oldEl);

  const newEl = document.createElement('div');
  newEl.classList.add('diff-new');
  newEl.textContent = `+ ${newPreview}`;
  container.append(newEl);

  return container;
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
      thinking.innerText = msg.reasoning_content;
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
    if (msg._toolMeta) {
      const header = renderToolCallLabel(msg._toolMeta.name, msg._toolMeta.args || {});
      header.classList.add('tool-header');
      el.append(header);

      // For edit_file, show diff
      const metaArgs = msg._toolMeta.args;
      if (msg._toolMeta.name === 'edit_file' && metaArgs?.old_string && metaArgs?.new_string !== undefined) {
        const diff = renderDiff(metaArgs.old_string, metaArgs.new_string);
        diff.classList.add('tool-result-diff');
        el.append(diff);
      }

      // For write_file, show content as all-green diff
      if (msg._toolMeta.name === 'write_file' && metaArgs?.content) {
        const diff = renderDiff('', metaArgs.content);
        diff.classList.add('tool-result-diff');
        el.append(diff);
      }
    }
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
      // Use tc.id when present, otherwise continue the last tool call
      let id = tc.id || agent.lastToolId;
      if (!id) continue;

      if (tc.id) agent.lastToolId = tc.id;

      // Name comes from the first delta; later deltas only have arguments
      let name = tc.function?.name || agent.toolCallMeta.get(id)?.name;
      if (!name) continue;
      const chunk = tc.function?.arguments || '';

      // Accumulate partial JSON across deltas
      const prev = agent.toolCallArgBuf.get(id) || '';
      const accumulated = prev + chunk;
      agent.toolCallArgBuf.set(id, accumulated);

      const args = tryParsePartialJson(accumulated);

      // Always store meta on first sight (name may only appear in first delta with empty args)
      if (!agent.toolCallMeta.has(id)) {
        agent.toolCallMeta.set(id, { name, args: args || {} });
      } else if (args) {
        agent.toolCallMeta.set(id, { name, args });
      }

      // Update existing line or create new one
      let line = tools.querySelector(`[data-tc-id="${id}"]`) as HTMLDivElement;
      if (!line) {
        line = document.createElement('div');
        line.classList.add('tool-call-line');
        line.dataset.tcId = id;
        line.append(renderToolCallLabel(name, null));
        tools.append(line);
      }

      // Only re-render the label when we have parseable args (avoids flicker)
      if (args) {
        line.innerHTML = '';
        line.append(renderToolCallLabel(name, args));

        // For edit_file, show diff preview (only when we have both strings parsed)
        if (name === 'edit_file' && args.old_string && args.new_string !== undefined) {
          let diffEl = tools.querySelector(`[data-tc-diff-id="${id}"]`) as HTMLDivElement;
          if (!diffEl) {
            diffEl = renderDiff(args.old_string, args.new_string);
            diffEl.classList.add('tool-call-diff');
            diffEl.dataset.tcDiffId = id;
            tools.append(diffEl);
          } else {
            diffEl.innerHTML = '';
            diffEl.append(...renderDiff(args.old_string, args.new_string).childNodes);
          }
        }

        // For write_file, show content as all-green diff
        if (name === 'write_file' && args.content) {
          let diffEl = tools.querySelector(`[data-tc-diff-id="${id}"]`) as HTMLDivElement;
          if (!diffEl) {
            diffEl = renderDiff('', args.content);
            diffEl.classList.add('tool-call-diff');
            diffEl.dataset.tcDiffId = id;
            tools.append(diffEl);
          } else {
            diffEl.innerHTML = '';
            diffEl.append(...renderDiff('', args.content).childNodes);
          }
        }
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

  document.getElementById('new-chat')!.addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'create_agent' }));
  });
});

// --- Connection ---

function handleNewAgent(data: AgentData, select: boolean = false) {
  const agent: AgentState = {
    data,
    button: null!,
    chatEl: null!,
    messageEls: new Map(),
    streamingMsgId: null,
    streamingEl: null,
    running: false,
    toolCallMeta: new Map(),
    toolCallArgBuf: new Map(),
    lastToolId: null,
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
    // Reconstruct tool call meta from assistant tool_calls (needed on reload)
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          agent.toolCallMeta.set(tc.id, { name: tc.function.name, args });
        }
      }
    }
    if (msg.role === 'tool' && msg.tool_call_id) {
      msg._toolMeta = agent.toolCallMeta.get(msg.tool_call_id);
    }

    const el = createMessageEl(msg);
    if (!el) continue;
    if (msg.custom?.id) agent.messageEls.set(msg.custom.id, el);
    chatEl.append(el);
  }

  document.getElementById('chats-list')!.append(button);

  agents.push(agent);

  if (select || !selectedAgent) selectAgent(agent);
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
        // Attach tool meta for richer display
        if (msg.message.tool_call_id) {
          msg.message._toolMeta = agent.toolCallMeta.get(msg.message.tool_call_id);
        }
        addMessage(agent, msg.message);
        break;
      }
      case 'agent_created': {
        handleNewAgent(msg.agent, true);
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
