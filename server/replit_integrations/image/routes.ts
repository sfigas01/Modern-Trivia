import type { Express, Request, Response } from 'express';
import { aiLimiter } from '../../middleware/rateLimiter';
import { openai } from './client';

export function registerImageRoutes(app: Express): void {
  app.post('/api/generate-image', aiLimiter, async (req: Request, res: Response) => {
    try {
      const { prompt, size = '1024x1024' } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

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
      res.status(500).json({ error: 'Failed to generate image' });
    }
  });
}
