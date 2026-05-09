const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!;

export type Message = {
  role: "system" | "user" | "assistant" | "tool" | "unknown";
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: {
    index: number,
    id: string,
    type: 'function',
    function: {
      name: string,
      arguments: string,
    }
  }[],
}

export type LLMStreamCallback = (data: Partial<Message>, delta: Partial<Message>) => void;

export type LLMOpptions = {
  messages: Message[];
  thinking: boolean;
  tools?: Tool[];
  onStream?: LLMStreamCallback;
}

export type LLMResponse = {
  wait: () => Promise<{ message: Message; interrupted: boolean }>;
  interrupt: () => void;
}

export type Tool = {
  name: string,
  description: string,
  parameters: any,
  call: (args: any, agent: any) => Promise<Message>,
};

export function llm({ tools, messages, thinking, onStream }: LLMOpptions): LLMResponse {
  const controller = new AbortController();
  const stream = !!onStream;

  const wait = async (): Promise<{ message: Message; interrupted: boolean }> => {
    let body = {
      model: "deepseek-v4-pro",
      messages,
      stream,
    } as any;

    body.thinking = { type: thinking ? "enabled" : "disabled" };

    if (tools) {
      body.tools = tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    let resp;
    try {
      resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": `application/json`,
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return {
          message: {
            role: "assistant",
            content: "",
            reasoning_content: "",
          },
          interrupted: true,
        };
      }
      throw err;
    }

    let message: Message;

    if (resp.status === 200) {
      if (stream) {
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer: string = "";
        message = {
          role: "unknown",
          content: "",
          reasoning_content: "",
        };

        let done = false;
        while (!done) {
          let readResult;
          try {
            readResult = await reader.read();
          } catch (err: any) {
            // The reader may throw if the stream is aborted
            if (err.name === 'AbortError' || controller.signal.aborted) {
              return { message, interrupted: true };
            }
            throw err;
          }

          if (readResult.done) break;

          buffer += decoder.decode(readResult.value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() || ""; // last event may be incomplete.

          for (const event of events) {
            for (const line of event.split('\n')) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  done = true;
                  break;
                }

                try {
                  const parsed = JSON.parse(data);

                  const delta = parsed.choices[0].delta;

                  if (delta.role) message.role = delta.role;
                  if (delta.content) message.content += delta.content;
                  if (delta.reasoning_content) message.reasoning_content += delta.reasoning_content;

                  if (delta.tool_calls) {
                    if (!message.tool_calls) message.tool_calls = [];

                    for (const tcd of delta.tool_calls) {
                      if (typeof tcd.index !== 'number') continue;

                      if (!message.tool_calls[tcd.index]) {
                        message.tool_calls[tcd.index] = {
                          index: tcd.index,
                          id: tcd.id,
                          type: 'function',
                          function: {
                            name: "",
                            arguments: "",
                          }
                        };
                      }

                      const tc = message.tool_calls[tcd.index];
                      if (tcd.function.name) tc.function.name += tcd.function.name;
                      if (tcd.function.arguments) tc.function.arguments += tcd.function.arguments;
                    }
                  }

                  onStream(message, delta);
                } catch (err) {
                  console.error("Failed to parse chunk:", data, err);
                }
              }
            }
          }

          // Check if interrupted between chunks
          if (controller.signal.aborted) {
            return { message, interrupted: true };
          }
        }
      } else {
        const respJson = await resp.json() as any;
        message = respJson.choices[0].message;
      }
      return { message, interrupted: false };
    } else {
      const respJson = await resp.json() as any;
      throw new Error(`Error ${resp.status}: ${respJson.error?.message}`);
    }
  };

  return {
    wait,
    interrupt: () => controller.abort(),
  };
}
