---
name: subagent
description: Spawn a subagent to handle a task independently. It has the same tools as you and runs to completion. Use for long-running focused subtasks where you want to isolate a unit of work, and for spawning multiple tasks in parallel.
---

# Subagent

## Setup

Eval the subagent module once, storing it as a global:
```
subagent = await burrowImport('./skills/subagent/scripts/subagent.js');
```

## TLDR

```js
// all stored as globals, can be used in subsequent calls!
a = subagent.spawn("description of task A"); 
b = subagent.spawn("description of task B");

// Check on all agents at once:
subagent.status()
// → [{ prompt: '...', done: false, messageCount: 5, ... }, ...]

// Wait for all with a single timeout — never throws:
results = await subagent.waitAll([a, b], { timeout: 30 });
// results[0] → { agent: a, prompt: '...', completed: true, message: undefined }
// results[1] → { agent: b, prompt: '...', completed: false, message: 'timed out after 30s. tail of ...' }

// Check agent.messages for full results when completed.
```

## When to use

- Heavy research: "Research X, Y, Z and summarize" — spawn one subagent per topic
- Isolated edits: "Refactor this file" — let the subagent do it without polluting your context
- Parallel work: Spawn multiple subagents, await them all, then synthesize results

## Tricks

Store your agents as variables in your context, so they're accessible across eval calls.

If an agent times out, `wait()` returns `{ completed: false, message }` with the tail of the currently streaming LLM message — use this to diagnose where it got stuck. You can also inspect `agent.messages` directly to see how far along it got. Start with a small, but reasonable timeout. If it times out and you see it's still working in the right direction, wait with a larger timeout.

If the subagent is going off in a wrong direction, you can interrupt it, and tell it what it's doing wrong:

```js
subagent.steer(a, 'No, no - you should instead ... ');
const result = await a.wait({ timeout: 10 });
// if !result.completed, check result.message for diagnostics
```

## Sharing data between agents: `rootContext.shared`

Agents are isolated by default, but you can intentionally share data via `rootContext.shared`:

```js
// Host sets shared data
const { rootContext } = await burrowImport('./agent.ts');
rootContext.shared.results = { bulgaria: ra, mongolia: rb, france: rc };

// Subagent reads it
const { rootContext } = await burrowImport('./agent.ts');
console.log(rootContext.shared.results.bulgaria);
```

Use this for aggregating results from parallel subagents or passing configuration.

## API

`Agent` class has the following gadgets:

`agent.messages` - the list of messages in the agent's context. Their properties are `role` (system/user/assistant/tool), `content`, `reasoning_content`. You can directly push/pop/edit these. You are the user when using subagents.

`agent.run()` - asynchronously runs a single iteration the agent. It keeps going while tool calls are requested.

`agent.wait({ timeout });` — waits for an agent. Returns `{ completed: boolean, message?: string }`. Timeout is in seconds, always use one. On timeout, `completed` is `false` and `message` contains diagnostic info (elapsed time + tail of the currently streaming LLM message). The agent keeps running in the background — you can check their state, and either interrupt and steer them, or give them more time.

`agent.done` — boolean. True when the agent's run loop has completed (no `_runPromise`). Use to quickly check if an agent finished without waiting.

`agent.currentStreamingMessage` — the partial Message being streamed from the LLM right now. Only set during active LLM calls; `undefined` when the agent is between turns or executing tools. Useful for diagnosing what an agent is doing after a timed-out wait.

`subagent.spawn(prompt)` creates an instance of `Agent`, launches its loop, and returns the Agent object, synchronously.

`subagent.steer(agent, reason)` — shorthand for interrupt+push message+run.

`subagent.status()` — returns an array of `{ prompt, done, messageCount, lastRole, lastContent, streaming }` for every agent spawned via `subagent.spawn()`. One call to see the big picture.

`subagent.waitAll(agents, { timeout })` — like `Promise.allSettled` for subagents. Never throws. Returns an array of `{ agent, prompt, completed, message }` — one per agent. Use this instead of raw `Promise.all` so a single slow agent doesn't block all results.

## Pitfalls

- Subagents inherit all skills, including this one. Avoid spawning subagents that spawn subagents.
