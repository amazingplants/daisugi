import {
  createAction,
  Property,
  StoreScope,
  Validators,
} from '@activepieces/pieces-framework';
import OpenAI from 'openai';
import { openaiAuth } from '../..';
import { sleep } from '../common/common';

export const submitToolOutputsAction = createAction({
  auth: openaiAuth,
  name: 'submit_tool_outputs',
  displayName: 'Submit Tool Outputs',
  description: 'Submit tool outputs to an assistant',
  props: {
    toolOutputs: Property.Json({
      displayName: 'Tool outputs',
      required: true,
    }),
    threadId: Property.ShortText({
      displayName: 'Thread ID',
      description: 'The thread ID to submit the tool outputs to',
      required: true,
    }),
    runId: Property.ShortText({
      displayName: 'Run ID',
      description: 'The run ID to submit the tool outputs to',
      required: true,
    }),
  },
  async run({ auth, propsValue, store }) {
    const openai = new OpenAI({
      apiKey: auth,
    });
    const { toolOutputs, threadId, runId } = propsValue;
    let response: any = {};

    const lastMessage = await openai.beta.threads.messages.list(threadId, {
      limit: 1,
    });

    if (
      !toolOutputs ||
      !Array.isArray(toolOutputs) ||
      toolOutputs.find(
        (toolOutput) =>
          !toolOutput.tool_call_id ||
          !toolOutput.output ||
          typeof toolOutput.output !== 'string'
      )
    ) {
      throw new Error('Tool outputs not valid');
    }

    const lastMessageId = lastMessage?.data[0]?.id;

    const run = await openai.beta.threads.runs.submitToolOutputsAndPoll(
      threadId,
      runId,
      {
        tool_outputs: toolOutputs as unknown as {
          tool_call_id: string;
          output: string;
        }[],
      }
    );

    response.status = run.status;
    response.thread_id = threadId;
    response.run_id = run.id;

    if (run.status === 'requires_action') {
      response.required_action = run.required_action;
    }

    if (run.status === 'completed' || run.status === 'requires_action') {
      const messages = await openai.beta.threads.messages.list(threadId);
      response.messages = messages.data
        .splice(
          0,
          messages.data.findIndex((m) => m.id == lastMessageId)
        )
        .filter((message) => message.role === 'assistant');
    }

    if (run.status !== 'completed' && run.status !== 'requires_action') {
      throw new Error(`OpenAI returned status ${run.status}`);
    }

    return response;
  },
});
