import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { aiLimiter } from '../../middleware/rateLimiter';
import { openai } from './client';

const generateImageSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1000),
    size: z.enum(['1024x1024', '512x512', '256x256']).optional().default('1024x1024'),
  })
  .strict();

export function registerImageRoutes(app: Express): void {
  app.post('/api/generate-image', aiLimiter, async (req: Request, res: Response) => {
    try {
      const { prompt, size } = generateImageSchema.parse(req.body);

      const response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: size as '1024x1024' | '512x512' | '256x256',
      });

      const imageData = response.data?.[0];
      if (!imageData?.url && !imageData?.b64_json) {
        return res.status(502).json({ error: 'Image provider returned an empty image response' });
      }

      res.json({
        url: imageData.url,
        b64_json: imageData.b64_json,
      });
    } catch (error) {
      console.error('Error generating image:', error);
      if (error instanceof z.ZodError) {
        return res.status(422).json({ error: 'Invalid image request', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to generate image' });
    }
  });
}
