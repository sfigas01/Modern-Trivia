import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { aiLimiter } from '../../middleware/rateLimiter';
import { chatStorage } from '../chat/storage';
import { getOpenAI, speechToText, voiceChatWithTextModel, convertWebmToWav } from './client';

const voiceSchema = z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const audioRequestSchema = z
  .object({
    audio: z.string().min(1).max(10_000_000),
    voice: voiceSchema.optional().default('alloy'),
    inputFormat: z.enum(['wav', 'mp3']).optional().default('wav'),
  })
  .strict();

const voiceStreamRequestSchema = audioRequestSchema.extend({
  locale: z.string().trim().min(2).max(12).optional().default('en'),
});

function sendValidationError(res: Response, message: string, error: z.ZodError) {
  return res.status(422).json({ error: message, details: error.errors });
}

// Note: Set express.json({ limit: "50mb" }) for audio payloads.
// Note: Use convertWebmToWav() to convert browser WebM to WAV before API calls.
export function registerAudioRoutes(app: Express): void {
  const voiceStreamRoute = '/api/conversations/:id/voice-stream';

  // Get all conversations
  app.get('/api/conversations', async (req: Request, res: Response) => {
    try {
      const conversations = await chatStorage.getAllConversations();
      res.json(conversations);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  });

  // Get single conversation with messages
  app.get('/api/conversations/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const conversation = await chatStorage.getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const messages = await chatStorage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error('Error fetching conversation:', error);
      res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  });

  // Create new conversation
  app.post('/api/conversations', async (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      const conversation = await chatStorage.createConversation(title || 'New Chat');
      res.status(201).json(conversation);
    } catch (error) {
      console.error('Error creating conversation:', error);
      res.status(500).json({ error: 'Failed to create conversation' });
    }
  });

  // Delete conversation
  app.delete('/api/conversations/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await chatStorage.deleteConversation(id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({ error: 'Failed to delete conversation' });
    }
  });

  // Send voice message and get streaming audio response
  // Uses gpt-4o-mini-transcribe for STT, gpt-audio-mini for voice response
  // For text model control, chain: speechToText() -> text model -> textToSpeech()
  app.post('/api/conversations/:id/messages', aiLimiter, async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { audio, voice, inputFormat } = audioRequestSchema.parse(req.body);

      // 1. Transcribe user audio
      const audioBuffer = Buffer.from(audio, 'base64');
      const userTranscript = await speechToText(audioBuffer, inputFormat);

      // 2. Save user message
      await chatStorage.createMessage(conversationId, 'user', userTranscript);

      // 3. Get conversation history
      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory = existingMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // 4. Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      res.write(`data: ${JSON.stringify({ type: 'user_transcript', data: userTranscript })}\n\n`);

      // 5. Stream audio response from gpt-audio-mini
      const stream = await getOpenAI().chat.completions.create({
        model: 'gpt-audio-mini',
        modalities: ['text', 'audio'],
        audio: { voice, format: 'pcm16' },
        messages: chatHistory,
        stream: true,
      });

      let assistantTranscript = '';

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta as any;
        if (!delta) continue;

        if (delta?.audio?.transcript) {
          assistantTranscript += delta.audio.transcript;
          res.write(
            `data: ${JSON.stringify({ type: 'transcript', data: delta.audio.transcript })}\n\n`
          );
        }

        if (delta?.audio?.data) {
          res.write(`data: ${JSON.stringify({ type: 'audio', data: delta.audio.data })}\n\n`);
        }
      }

      // 6. Save assistant message
      await chatStorage.createMessage(conversationId, 'assistant', assistantTranscript);

      res.write(`data: ${JSON.stringify({ type: 'done', transcript: assistantTranscript })}\n\n`);
      res.end();
    } catch (error) {
      console.error('Error processing voice message:', error);
      if (error instanceof z.ZodError && !res.headersSent) {
        return sendValidationError(res, 'Invalid voice message request', error);
      }
      if (res.headersSent) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', error: 'Failed to process voice message' })}\n\n`
        );
        res.end();
      } else {
        res.status(500).json({ error: 'Failed to process voice message' });
      }
    }
  });

  // Voice chat using separate text model (GPT-5) + TTS pipeline
  // Streams sentences to TTS as they're generated for lower latency
  // Supports multilingual sentence detection via locale parameter
  app.post(voiceStreamRoute, aiLimiter, async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { audio, voice, inputFormat, locale } = voiceStreamRequestSchema.parse(req.body);

      // Get conversation history
      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory = existingMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const audioBuffer = Buffer.from(audio, 'base64');
      let userTranscript = '';
      let assistantTranscript = '';

      // Stream the voice chat pipeline
      for await (const event of voiceChatWithTextModel(audioBuffer, {
        voice,
        inputFormat,
        chatHistory,
        locale,
      })) {
        if (event.type === 'user_transcript') {
          userTranscript = event.data || '';
          await chatStorage.createMessage(conversationId, 'user', userTranscript);
        }
        if (event.type === 'transcript') {
          assistantTranscript = event.data || '';
        }

        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // Save assistant message
      await chatStorage.createMessage(conversationId, 'assistant', assistantTranscript);
      res.end();
    } catch (error) {
      console.error('Error in voice stream:', error);
      if (error instanceof z.ZodError && !res.headersSent) {
        return sendValidationError(res, 'Invalid voice stream request', error);
      }
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Voice stream failed' })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: 'Voice stream failed' });
      }
    }
  });
}
