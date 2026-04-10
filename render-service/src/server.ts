console.log("=== STARTING RENDER SERVICE BOOT ===");
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { VideoRenderer } from './ffmpeg';
import { VisualFetcher } from './visuals';
import { ThumbnailGenerator } from './templates/thumbnails';
import dotenv from 'dotenv';

dotenv.config();

try {
  const filesBasePath = process.env.FILES_BASE_PATH || (process.env.NODE_ENV === 'production' ? '/files' : './files');
  const logsDir = path.join(filesBasePath, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

const publishLogPath = path.join(logsDir, 'published.json');

function readPublishedVideos(): Array<{ videoId?: string; youtubeVideoId?: string; title?: string; publishedAt?: string; articleUrl?: string }> {
  try {
    if (!fs.existsSync(publishLogPath)) return [];
    const raw = fs.readFileSync(publishLogPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePublishedVideos(items: Array<{ videoId?: string; youtubeVideoId?: string; title?: string; publishedAt?: string; articleUrl?: string }>) {
  fs.writeFileSync(publishLogPath, JSON.stringify(items, null, 2));
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [new winston.transports.File({ filename: path.join(logsDir, 'render-service.log') })]
      : [new winston.transports.File({ filename: path.join(logsDir, 'render-service.log') })])
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Job tracking
const jobs = new Map<string, JobStatus>();

interface JobStatus {
  id: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  progress: number;
  output?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Queue Processing variables
const jobQueue: Array<{
  jobId: string;
  output: string;
  segments: any[];
  music?: string;
  musicVolume?: number;
  thumbnail?: any;
}> = [];
let isProcessingQueue = false;

async function processNextJob() {
  if (isProcessingQueue || jobQueue.length === 0) return;
  isProcessingQueue = true;

  const jobArgs = jobQueue.shift();
  if (jobArgs) {
    try {
      await processVideo(
        jobArgs.jobId,
        jobArgs.output,
        jobArgs.segments,
        jobArgs.music,
        jobArgs.musicVolume,
        jobArgs.thumbnail
      );
    } catch (err) {
      logger.error('Queue processing error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  isProcessingQueue = false;
  // Trigger next job in queue automatically
  setImmediate(processNextJob);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Render video endpoint
app.post('/render', async (req, res) => {
  const jobId = uuidv4();
  
  try {
    const { output, segments, music, musicVolume = 0.15, thumbnail } = req.body;
    
    if (!output || !segments || !Array.isArray(segments)) {
      return res.status(400).json({ 
        error: 'Missing required fields: output, segments' 
      });
    }

    // Create job
    const job: JobStatus = {
      id: jobId,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    jobs.set(jobId, job);

     logger.info('Starting video render', { jobId, segments: segments.length });

    // Start processing asynchronously in heavily guarded Queue
    jobQueue.push({
      jobId,
      output,
      segments,
      music,
      musicVolume,
      thumbnail
    });
    setImmediate(processNextJob);

    res.json({ 
      jobId, 
      status: 'pending', // Queue architecture state
      message: 'Video added to render queue'
    });

  } catch (error) {
    logger.error('Failed to start render', { jobId, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ 
      error: 'Failed to start render',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get job status
app.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Check if an article has already been covered
app.post('/check-coverage', (req, res) => {
  const { link, title } = req.body;
  const published = readPublishedVideos();
  const covered = published.some(item => (link && item.articleUrl === link) || (title && item.title === title));

  res.json({
    covered,
    link,
    title,
    publishedCount: published.length
  });
});

// Log published videos for dedupe/traceability
app.post('/log-publish', (req, res) => {
  try {
    const { videoId, youtubeVideoId, title, publishedAt, articleUrl } = req.body;
    const published = readPublishedVideos();
    published.unshift({ videoId, youtubeVideoId, title, publishedAt, articleUrl });
    writePublishedVideos(published.slice(0, 500));

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to log publish', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Process video
async function processVideo(
  jobId: string,
  outputPath: string,
  segments: any[],
  music?: string,
  musicVolume?: number,
  thumbnail?: any
) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'processing';
    job.updatedAt = new Date();
    jobs.set(jobId, job);

    const renderer = new VideoRenderer(logger);
    
    // Update progress
    const updateProgress = (progress: number) => {
      job.progress = progress;
      job.updatedAt = new Date();
      jobs.set(jobId, job);
      logger.info('Render progress', { jobId, progress });
    };

    // Render video
    await renderer.render({
      output: outputPath,
      segments,
      music,
      musicVolume,
      onProgress: updateProgress
    });

    // Generate thumbnail if requested
    if (thumbnail) {
      updateProgress(95);
      const thumbnailGen = new ThumbnailGenerator(logger);
      await thumbnailGen.generate({
        output: thumbnail.output || outputPath.replace('.mp4', '_thumb.jpg'),
        title: thumbnail.title,
        image: thumbnail.image,
        style: thumbnail.style || 'viral-news'
      });
    }

    job.status = 'complete';
    job.progress = 100;
    job.output = outputPath;
    job.updatedAt = new Date();
    jobs.set(jobId, job);

    logger.info('Video render complete', { jobId, output: outputPath });

  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.updatedAt = new Date();
    jobs.set(jobId, job);

    logger.error('Video render failed', { jobId, error: error instanceof Error ? error.message : String(error) });
  }
}

// Fetch visual endpoint
app.post('/fetch-visual', async (req, res) => {
  try {
    const { type, query, output } = req.body;
    const fetcher = new VisualFetcher(logger);
    
    let result;
    switch (type) {
      case 'pexels':
        result = await fetcher.fromPexels(query, output);
        break;
      case 'pixabay':
        result = await fetcher.fromPixabay(query, output);
        break;
      case 'web':
        result = await fetcher.fromWeb(query, output);
        break;
      default:
        return res.status(400).json({ error: 'Unknown visual type' });
    }

    res.json(result);
  } catch (error) {
     logger.error('Failed to fetch visual', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({
      error: 'Failed to fetch visual',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Generate AI image via OpenRouter
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, output, model = 'black-forest-labs/flux.2-klein-4b', aspectRatio = '16:9' } = req.body;
    
    const fetcher = new VisualFetcher(logger);
    let result = await fetcher.generateImage(prompt, output, model, aspectRatio);
    
    if (!result.success) {
      logger.warn('OpenRouter image generation failed, falling back to Pixabay HD Videos', { error: result.error, prompt });
      result = await fetcher.fromPixabay(prompt, output);
    }
    
    if (!result.success) {
      logger.warn('Pixabay HD Video fallback failed, falling back to Web image search', { error: result.error, prompt });
      result = await fetcher.fromWeb(prompt, output);
    }
    
    res.json(result);
  } catch (error) {
     logger.error('Failed to generate image', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({
      error: 'Failed to generate image',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Generate Seedance video clip
app.post('/generate-seedance', async (req, res) => {
  try {
    const { prompt, output, duration = 8, width = 1280, height = 720 } = req.body;
    
    const fetcher = new VisualFetcher(logger);
    const result = await fetcher.generateSeedance(prompt, output, duration, width, height);
    
    res.json(result);
  } catch (error) {
     logger.error('Failed to generate Seedance clip', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({
      error: 'Failed to generate Seedance clip',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Generate Free TTS via Google API as a fallback
app.post('/generate-free-tts', async (req, res) => {
  try {
    const { text, output, lang = 'en', slow = false } = req.body;
    if (!text || !output) {
      return res.status(400).json({ error: 'Missing required fields: text, output' });
    }
    
    const googleTTS = require('google-tts-api');
    
    // For long text, split into 200 character chunks and download streams securely
    const results = await googleTTS.getAllAudioBase64(text, {
      lang: lang,
      slow: slow,
      host: 'https://translate.google.com',
      timeout: 10000,
    });
    
    // Stitch Base64 string buffers into MP3 output
    const audioBuffer = Buffer.concat(
      results.map((result: any) => Buffer.from(result.base64, 'base64'))
    );
    fs.writeFileSync(output, audioBuffer);
    
    logger.info('Generated Free TTS string', { characters: text.length, output });
    res.json({ success: true, path: output });
    
  } catch (error) {
     logger.error('Failed to generate Free TTS', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({
      error: 'Failed to generate Free TTS',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Cleanup old jobs (keep last 100)
setInterval(() => {
  if (jobs.size > 100) {
    const sorted = Array.from(jobs.entries())
      .sort((a, b) => b[1].createdAt.getTime() - a[1].createdAt.getTime());
    const toDelete = sorted.slice(100);
    toDelete.forEach(([id]) => jobs.delete(id));
  }
}, 60000); // Every minute

app.listen(PORT as number, '0.0.0.0', () => {
   logger.info('Vidomator Render Service started', { port: PORT });
});
} catch (err) {
  console.error("FATAL ERROR ON STARTUP:", err);
  process.exit(1);
}
