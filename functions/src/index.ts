import { configureGenkit } from '@genkit-ai/core'
import { dotprompt, promptRef } from '@genkit-ai/dotprompt'
import { firebase } from '@genkit-ai/firebase'
import { defineFlow, runFlow } from '@genkit-ai/flow'
import {
  SignatureValidationFailed,
  type WebhookRequestBody,
  messagingApi,
  validateSignature,
} from '@line/bot-sdk'
import { onRequest } from 'firebase-functions/v2/https'
import { openAI } from 'genkitx-openai'
import * as z from 'zod'

// Configure Genkit with necessary plugins and settings
configureGenkit({
  plugins: [
    dotprompt(),
    firebase(),
    openAI({ apiKey: process.env.OPENAI_API_KEY }), // Use the OpenAI plugin with the provided API key.
  ],
  logLevel: 'debug', // Log debug output to the console.
  enableTracingAndMetrics: true, // Perform OpenTelemetry instrumentation and enable trace collection.
})

const answerPrompt = promptRef('answer') // Reference to the answer prompt: `functions/prompts/answer.prompt`

// Flow definition for answering a question
const answerFlow = defineFlow(
  {
    name: 'answerFlow',
    inputSchema: z.string(),
    outputSchema: z.string(),
  },
  async (question: string) => {
    const llmResponse = await answerPrompt.generate({
      input: {
        question: question,
      },
    })
    return llmResponse.text()
  },
)

export const line = onRequest(
  { secrets: ['OPENAI_API_KEY', 'CHANNEL_SECRET', 'CHANNEL_ACCESS_TOKEN'] },
  async (req, res) => {
    res.send('ok') // TODO: later

    // verify the request signature
    const channelSecret = process.env.CHANNEL_SECRET ?? ''
    const channelAccessToken = process.env.CHANNEL_ACCESS_TOKEN ?? ''
    const signature = req.header('x-line-signature') ?? ''
    if (!validateSignature(req.rawBody, channelSecret, signature)) {
      throw new SignatureValidationFailed('invalid signature')
    }

    // Initialize the LINE Messaging API client
    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: channelAccessToken,
    })

    const { events } = req.body as WebhookRequestBody
    for (const event of events) {
      if (event.type === 'message') {
        const { replyToken, message } = event
        if (message.type === 'text') {
          console.log('💖message.text', message.text) // TODO: debug
          const answer = await runFlow(answerFlow, message.text) // run the flow to generate an answer
          console.log('💖answer', answer) // TODO: debug
          client.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: answer,
              },
            ],
          })
        }
      }
    }
  },
)
