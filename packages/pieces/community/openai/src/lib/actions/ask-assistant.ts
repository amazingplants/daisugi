import {
  createAction,
  Property,
  StoreScope,
  Validators,
} from '@activepieces/pieces-framework';
import OpenAI from 'openai';
import { openaiAuth } from '../..';
import { sleep } from '../common/common';

export const askAssistant = createAction({
  auth: openaiAuth,
  name: 'ask_assistant',
  displayName: 'Ask Assistant',
  description: 'Ask a GPT assistant anything you want!',
  props: {
    assistant: Property.Dropdown({
      displayName: 'Assistant',
      required: true,
      description: 'The assistant which will generate the completion.',
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Enter your API key first',
            options: [],
          };
        }
        try {
          const openai = new OpenAI({
            apiKey: auth as string,
          });
          const assistants = await openai.beta.assistants.list();

          return {
            disabled: false,
            options: assistants.data.map((assistant: any) => {
              console.log('***************** assistant', assistant);
              return {
                label: assistant.name,
                value: assistant.id,
              };
            }),
          };
        } catch (error) {
          return {
            disabled: true,
            options: [],
            placeholder: "Couldn't load assistants, API key is invalid",
          };
        }
      },
    }),
    prompt: Property.LongText({
      displayName: 'Question',
      required: true,
    }),
    additionalInstructions: Property.LongText({
      displayName: 'Additional Instructions',
      description: 'Additional per-run instructions for the assistant',
      required: false,
    }),
    maxPromptTokens: Property.Number({
      displayName: 'Max Prompt Tokens',
      description: 'The maximum number of tokens to use for the prompt',
      required: false,
    }),
    maxCompletionTokens: Property.Number({
      displayName: 'Max Completion Tokens',
      description: 'The maximum number of tokens to use for the completion',
      required: false,
    }),
    memoryKey: Property.ShortText({
      displayName: 'Memory Key',
      validators: [Validators.maxLength(128)],
      description:
        'A memory key that will keep the chat history shared across runs and flows. Keep it empty to leave your assistant without memory of previous messages.',
      required: false,
    }),
  },
  async run({ auth, propsValue, store }) {
    const openai = new OpenAI({
      apiKey: auth,
    });
    const {
      assistant,
      prompt,
      additionalInstructions,
      maxPromptTokens,
      maxCompletionTokens,
      memoryKey,
    } = propsValue;
    const runCheckDelay = 1000;
    let response: any = {};
    let thread: any;

    if (memoryKey) {
      // Get existing thread ID or create a new thread for this memory key
      thread = await store.get(memoryKey, StoreScope.PROJECT);
      if (!thread) {
        thread = await openai.beta.threads.create();

        store.put(memoryKey, thread, StoreScope.PROJECT);
      }
    } else {
      thread = await openai.beta.threads.create();
    }

    const message = await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: prompt,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant,
      additional_instructions: additionalInstructions || null,
      max_prompt_tokens: maxPromptTokens || null,
      max_completion_tokens: maxCompletionTokens || null,
    });
    // Wait at least 400ms for inference to finish before checking to save requests
    await sleep(400);

    let inProgress = true;
    while (inProgress) {
      const runCheck = await openai.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );

      inProgress = runCheck.status === 'in_progress';
      if (inProgress) {
        await sleep(runCheckDelay);
        continue;
      }

      response.status = runCheck.status;
      response.thread_id = thread.id;
      response.run_id = run.id;

      if (runCheck.status === 'requires_action') {
        response.required_action = runCheck.required_action;
      }

      if (
        runCheck.status === 'completed' ||
        runCheck.status === 'requires_action'
      ) {
        console.log(runCheck);
        const messages = await openai.beta.threads.messages.list(thread.id);
        response.messages = messages.data
          .splice(
            0,
            messages.data.findIndex((m) => m.id == message.id)
          )
          .filter((message) => message.role === 'assistant');
      }

      if (
        runCheck.status !== 'completed' &&
        runCheck.status !== 'requires_action'
      ) {
        throw new Error(`OpenAI returned status ${runCheck.status}`);
      }
    }

    return response;
  },
});
