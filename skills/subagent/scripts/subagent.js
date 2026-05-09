import { Agent, systemPrompt } from '../../../agent.ts';

const _registry = new Map();

export function spawn(prompt) {
  const agent = new Agent({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]
  });
  _registry.set(agent, prompt);
  agent.run({ onMessage: () => {} });
  return agent;
}

export function steer(agent, reason) {
  agent.interrupt();
  agent.messages.push({ role: 'user', content: reason });
  agent.run({ onMessage: () => {} });
}

export function status() {
  return [..._registry.entries()].map(([agent, prompt]) => {
    const lastMsg = agent.messages[agent.messages.length - 1];
    return {
      prompt: prompt.slice(0, 120),
      done: agent.done,
      messageCount: agent.messages.length,
      lastRole: lastMsg?.role,
      lastContent: lastMsg?.content?.slice(0, 100) || '',
      streaming: !!agent.currentStreamingMessage,
      currentToolCall: agent._currentToolCall || null,
    };
  });
}

export function waitAll(agents, { timeout } = { timeout: 60 }) {
  return Promise.allSettled(
    agents.map(a => a.wait({ timeout }))
  ).then(results =>
    results.map((r, i) => ({
      agent: agents[i],
      prompt: _registry.get(agents[i])?.slice(0, 120),
      completed: r.status === 'fulfilled' ? r.value.completed : false,
      message: r.status === 'fulfilled' ? r.value.message : `waitAll error: ${r.reason}`,
    }))
  );
}
