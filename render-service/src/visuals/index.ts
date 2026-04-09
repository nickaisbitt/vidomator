import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Logger } from 'winston';
import { v4 as uuidv4 } from 'uuid';

export class VisualFetcher {
  private logger: Logger;
  private basePath = process.env.FILES_BASE_PATH || (process.env.NODE_ENV === 'production' ? '/files' : './files');
  
  // API Keys
  private pexelsKey = process.env.PEXELS_API_KEY;
  private pixabayKey = process.env.PIXABAY_API_KEY;
  private openRouterKey = process.env.OPENROUTER_API_KEY;
  private byteplusAccessKey = process.env.BYTEPLUS_ACCESS_KEY;
  private byteplusSecretKey = process.env.BYTEPLUS_SECRET_KEY;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // Fetch from Pexels API
  async fromPexels(query: string, output: string): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      if (!this.pexelsKey) {
        throw new Error('Pexels API key not configured');
      }

      const response = await axios.get('https://api.pexels.com/videos/search', {
        headers: { Authorization: this.pexelsKey },
        params: { query, per_page: 5, orientation: 'landscape' }
      });

      const videos = response.data.videos;
      if (!videos || videos.length === 0) {
        return { success: false, error: 'No videos found' };
      }

      // Get best quality video file
      const video = videos[0];
      const videoFile = video.video_files
        .filter((f: any) => f.quality === 'hd' || f.quality === 'sd')
        .sort((a: any, b: any) => b.width - a.width)[0];

      if (!videoFile) {
        return { success: false, error: 'No suitable video quality found' };
      }

      // Download video
      const videoResponse = await axios.get(videoFile.link, { responseType: 'stream' });
      const writer = fs.createWriteStream(output);
      videoResponse.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

       this.logger.info('Downloaded video from Pexels', { query, source: 'pexels', output });
      return { success: true, path: output };

    } catch (error) {
       this.logger.error('Failed to fetch from Pexels', { query, error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Fetch from Pixabay API
  async fromPixabay(query: string, output: string): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      if (!this.pixabayKey) {
        throw new Error('Pixabay API key not configured');
      }

      const response = await axios.get('https://pixabay.com/api/videos/', {
        params: {
          key: this.pixabayKey,
          q: query,
          per_page: 5,
          orientation: 'horizontal'
        }
      });

      const videos = response.data.hits;
      if (!videos || videos.length === 0) {
        return { success: false, error: 'No videos found' };
      }

      // Download video
      const videoUrl = videos[0].videos.large?.url || videos[0].videos.medium?.url || videos[0].videos.small?.url;
      if (!videoUrl) {
        return { success: false, error: 'No video URL found' };
      }

      const videoResponse = await axios.get(videoUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(output);
      videoResponse.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

       this.logger.info('Downloaded video from Pixabay', { query, source: 'pixabay', output });
      return { success: true, path: output };

    } catch (error) {
       this.logger.error('Failed to fetch from Pixabay', { query, error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Web scraping for images
  async fromWeb(query: string, output: string): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      // Use DuckDuckGo image search (no API key needed)
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
      
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Extract image URLs (basic regex approach)
      const html = response.data;
      const imageUrls: string[] = [];
      
      // Look for image URLs in the HTML
      const matches = html.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif)/gi);
      if (matches) {
        imageUrls.push(...matches.slice(0, 5));
      }

      if (imageUrls.length === 0) {
        return { success: false, error: 'No images found via web search' };
      }

      // Try to download each image until one succeeds
      for (const imageUrl of imageUrls) {
        try {
          const imageResponse = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });

          // Check if image is large enough (min 100KB)
          if (imageResponse.data.length < 100000) {
            continue;
          }

          fs.writeFileSync(output, Buffer.from(imageResponse.data));
          
           this.logger.info('Downloaded image from web', { query, source: 'web', output });
          return { success: true, path: output };
          
        } catch (err) {
          continue; // Try next image
        }
      }

      return { success: false, error: 'Failed to download any suitable image' };

     } catch (error) {
        this.logger.error('Failed to fetch from web', { query, error: error instanceof Error ? error.message : String(error) });
       return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
     }
  }

  // Generate image via OpenRouter (Flux, Gemini, etc.)
  async generateImage(
    prompt: string, 
    output: string, 
    model: string = 'black-forest-labs/flux.2-klein-4b',
    aspectRatio: string = '16:9'
  ): Promise<{ success: boolean; path?: string; error?: string; cost?: number }> {
    try {
      if (!this.openRouterKey) {
        throw new Error('OpenRouter API key not configured');
      }

      // Map aspect ratio to dimensions
      const ratioMap: { [key: string]: string } = {
        '1:1': '1024x1024',
        '16:9': '1344x768',
        '9:16': '768x1344',
        '4:3': '1184x864',
        '3:4': '864x1184'
      };

      const imageSize = ratioMap[aspectRatio] || '1344x768';

      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: model,
          messages: [
            {
              role: 'user',
              content: `Generate an image: ${prompt}. Style: photorealistic, professional news broadcast quality, dramatic lighting.`
            }
          ],
          modalities: ['image'],
          image_config: {
            aspect_ratio: aspectRatio,
            image_size: '1K'
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://vidomator.railway.app',
            'X-Title': 'Vidomator'
          }
        }
      );

      // Extract image from response
      const message = response.data.choices?.[0]?.message;
      if (!message || !message.images || message.images.length === 0) {
        return { success: false, error: 'No image generated' };
      }

      const imageData = message.images[0].image_url?.url;
      if (!imageData) {
        return { success: false, error: 'No image data in response' };
      }

      // Decode base64 and save
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(output, buffer);

      const cost = response.data.usage?.total_cost || 0;
      
       this.logger.info('Generated image via OpenRouter', { prompt, model, output, cost });
      return { success: true, path: output, cost };

     } catch (error) {
       this.logger.error('Image generation failed', { model, error: error instanceof Error ? error.message : String(error) });
       return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
     }
  }

  // Generate video via Seedance (BytePlus)
  async generateSeedance(
    prompt: string,
    output: string,
    duration: number = 8,
    width: number = 1280,
    height: number = 720
  ): Promise<{ success: boolean; path?: string; error?: string; jobId?: string }> {
    try {
      if (!this.byteplusAccessKey || !this.byteplusSecretKey) {
        throw new Error('BytePlus credentials not configured');
      }

      // BytePlus/Seedance API endpoint
      const endpoint = 'https://visual.volces.com/api/v3/imagex/generate_video';
      
      // Create generation request
      const response = await axios.post(
        endpoint,
        {
          prompt: prompt,
          width: width,
          height: height,
          duration: duration,
          fps: 24
        },
        {
          headers: {
            'Authorization': `Bearer ${this.byteplusAccessKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const jobId = response.data.job_id;
      if (!jobId) {
        return { success: false, error: 'No job ID returned' };
      }

       this.logger.info('Seedance generation started', { prompt, jobId });

      // Poll for completion
      const maxAttempts = 30;
      const pollInterval = 10000; // 10 seconds

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        const statusResponse = await axios.get(
          `https://visual.volces.com/api/v3/imagex/get_video_result?job_id=${jobId}`,
          {
            headers: {
              'Authorization': `Bearer ${this.byteplusAccessKey}`
            }
          }
        );

        const status = statusResponse.data.status;
        
        if (status === 'success') {
          const videoUrl = statusResponse.data.video_url;
          
          // Download video
          const videoResponse = await axios.get(videoUrl, { responseType: 'stream' });
          const writer = fs.createWriteStream(output);
       videoResponse.data.pipe(writer);
       
       await new Promise<void>((resolve, reject) => {
         writer.once('finish', resolve);
         writer.once('error', reject);
       });

          this.logger.info('Seedance generation complete', { prompt, jobId, output });
          return { success: true, path: output, jobId };
          
        } else if (status === 'failed') {
          return { success: false, error: 'Generation failed', jobId };
        }
        // else continue polling
      }

      return { success: false, error: 'Generation timeout', jobId };

    } catch (error) {
       this.logger.error('Failed to generate Seedance video', { prompt, error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Check BytePlus account balance/credits
  async checkBytePlusBalance(): Promise<{ success: boolean; balance?: number; error?: string }> {
    try {
      if (!this.byteplusAccessKey) {
        return { success: false, error: 'BytePlus credentials not configured' };
      }

      const response = await axios.get(
        'https://visual.volces.com/api/v3/imagex/get_account_info',
        {
          headers: {
            'Authorization': `Bearer ${this.byteplusAccessKey}`
          }
        }
      );

      const balance = response.data.balance || response.data.credits || 0;
      
       this.logger.info('BytePlus account balance checked', { balance });
      return { success: true, balance };

    } catch (error) {
       this.logger.error('Failed to check BytePlus balance', { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
