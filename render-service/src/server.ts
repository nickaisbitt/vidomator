import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { VideoRenderer } from './ffmpeg';
import { VisualFetcher } from './visuals';
import { ThumbnailGenerator } from './templates/thumbnails';
import dotenv from 'dotenv';

dotenv.config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: '/files/logs/render-service.log' })
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

    logger.info({ jobId, segments: segments.length }, 'Starting video render');

    // Start processing in background
    processVideo(jobId, output, segments, music, musicVolume, thumbnail);

    res.json({ 
      jobId, 
      status: 'processing',
      message: 'Video rendering started'
    });

  } catch (error) {
    logger.error({ jobId, error }, 'Failed to start render');
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
      logger.info({ jobId, progress }, 'Render progress');
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

    logger.info({ jobId, output: outputPath }, 'Video render complete');

  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.updatedAt = new Date();
    jobs.set(jobId, job);

    logger.error({ jobId, error }, 'Video render failed');
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
    logger.error({ error }, 'Failed to fetch visual');
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
    const result = await fetcher.generateImage(prompt, output, model, aspectRatio);
    
    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Failed to generate image');
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
    logger.error({ error }, 'Failed to generate Seedance clip');
    res.status(500).json({
      error: 'Failed to generate Seedance clip',
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

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Vidomator Render Service started');
});
