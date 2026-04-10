console.log("=== STARTING RENDER SERVICE BOOT ===");
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { VideoRenderer } from './ffmpeg';
import { VisualFetcher } from './visuals';
import { google } from 'googleapis';
import { ThumbnailGenerator } from './templates/thumbnails';
import axios from 'axios';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

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

// Native YouTube Uploader bypass
app.post('/publish-to-youtube', async (req, res) => {
  try {
    const { videoPath, title, description, tags = [], categoryId = '25' } = req.body;
    
    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video file not found', videoPath });
    }

    const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
    
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
      return res.status(500).json({ error: 'YouTube API credentials missing from environment' });
    }

    const oauth2Client = new google.auth.OAuth2(
      YOUTUBE_CLIENT_ID,
      YOUTUBE_CLIENT_SECRET,
      'http://localhost:3000/oauth2callback' // Native redirect block
    );

    oauth2Client.setCredentials({
      refresh_token: YOUTUBE_REFRESH_TOKEN
    });

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    logger.info('Starting YouTube upload protocol natively', { videoPath, title });

    const reqData = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId
        },
        status: {
          privacyStatus: 'public'
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    });

    logger.info('YouTube upload successful!', { videoId: reqData.data.id });
    res.json({ success: true, videoId: reqData.data.id, data: reqData.data });
    
  } catch (error) {
    logger.error('Failed to upload to YouTube natively', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({
      error: 'Failed to upload to YouTube',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==============================
// SELF-CONTAINED AUTO-PRODUCE
// Full pipeline: article → script → TTS → visuals → render → YouTube
// ==============================
app.post('/auto-produce', async (req, res) => {
  const jobId = uuidv4();
  const job: JobStatus = {
    id: jobId,
    status: 'pending',
    progress: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  jobs.set(jobId, job);

  // Return immediately so the caller doesn't time out
  res.json({ jobId, status: 'queued', message: 'Auto-produce pipeline started' });

  // Run the entire pipeline asynchronously
  (async () => {
    try {
      job.status = 'processing';
      job.updatedAt = new Date();
      jobs.set(jobId, job);

      const { title, link, content, source } = req.body;
      const filesBasePath = process.env.FILES_BASE_PATH || (process.env.NODE_ENV === 'production' ? '/files' : './files');
      const videoId = `auto_${Date.now()}`;

      logger.info('Auto-produce started', { jobId, title, source });

      // ---- STEP 1: Generate script via OpenRouter ----
      logger.info('Step 1: Generating script via OpenRouter', { jobId });
      let scriptData: any;
      try {
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterKey) throw new Error('OPENROUTER_API_KEY not set');

        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: 'google/gemini-2.0-flash-exp:free',
            messages: [
              {
                role: 'system',
                content: 'You are a professional broadcast news writer. Write scripts that are objective, engaging, and suitable for high-end news productions.'
              },
              {
                role: 'user',
                content: `Convert this news story into a 3-5 paragraph video script.
                Return ONLY a JSON object with this structure:
                {
                  "youtubeTitle": "string",
                  "description": "string",
                  "tags": ["string"],
                  "segments": [
                    { "text": "narration text", "visualQuery": "search term for visuals", "lowerThird": "on-screen text" }
                  ]
                }
                
                Story: ${title}
                Content: ${content}`
              }
            ]
          },
          {
            headers: {
              'Authorization': `Bearer ${openRouterKey.trim()}`,
              'Content-Type': 'application/json'
            },
            timeout: 45000
          }
        );

        scriptData = response.data.choices[0].message.content;
        // Strip code blocks if AI included them
        if (typeof scriptData === 'string') {
          scriptData = JSON.parse(scriptData.replace(/```json|```/g, '').trim());
        }
        logger.info('Script generated', { jobId, segments: scriptData.segments.length, title: scriptData.youtubeTitle });

      } catch (error: any) {
          const detail = error.response?.data?.error?.message || error.message;
          console.error(`[ERRO] OpenRouter Failure: ${detail}`, { 
            status: error.response?.status,
            jobId 
          });
          console.warn(`[WARN] LLM failed, using fallback script`, { error: detail, jobId });
          scriptData = {
          youtubeTitle: title?.substring(0, 60) || 'Breaking News Update',
          description: `Latest news from The Update Desk: ${title}`,
          tags: ['news', 'breaking', 'update desk'],
          segments: [
            {
              text: title ? `Our top story today: ${title}.` : "Welcome to the latest news update.",
              visualQuery: "news studio broadcast",
              lowerThird: title?.substring(0, 30) || "BREAKING NEWS"
            },
            {
              text: content?.substring(0, 200) || "We are tracking several developing stories across the globe.",
              visualQuery: title || "breaking news",
              lowerThird: "LATEST DEVELOPMENTS"
            }
          ]
        };
      }

      job.progress = 20;
      job.updatedAt = new Date();
      jobs.set(jobId, job);

      // ---- STEP 2: Generate TTS for each segment ----
      logger.info('Step 2: Generating TTS', { jobId, segmentCount: scriptData.segments.length });
      const audioDir = path.join(filesBasePath, 'audio');
      const videoDir = path.join(filesBasePath, 'video');
      const outputDir = path.join(filesBasePath, 'output');
      fs.mkdirSync(audioDir, { recursive: true });
      fs.mkdirSync(videoDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      const speechifyKey = process.env.SPEECHIFY_API_KEY;

      for (let i = 0; i < scriptData.segments.length; i++) {
        const seg = scriptData.segments[i];
        const audioPath = path.join(audioDir, `${videoId}_${i}.mp3`);

        try {
          if (speechifyKey) {
            logger.info(`Using Speechify for segment ${i}`, { jobId });
            const speechifyResponse = await axios.post(
              'https://api.speechify.ai/v1/audio/stream',
              {
                input: seg.script,
                voice_id: 'nick',
                model: 'simba-english',
                audio_format: 'mp3',
                options: {
                  text_normalization: false,
                  loudness_normalization: true
                }
              },
              {
                headers: {
                  'Authorization': `Bearer ${speechifyKey}`,
                  'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 30000
              }
            );
            fs.writeFileSync(audioPath, Buffer.from(speechifyResponse.data));
          } else {
            // Fallback to Google TTS
            const googleTTS = require('google-tts-api');
            const results = await googleTTS.getAllAudioBase64(seg.script, {
              lang: 'en',
              slow: false,
              host: 'https://translate.google.com',
              timeout: 10000,
            });
            const audioBuffer = Buffer.concat(
              results.map((r: any) => Buffer.from(r.base64, 'base64'))
            );
            fs.writeFileSync(audioPath, audioBuffer);
          }
          seg._audioPath = audioPath;
          logger.info(`TTS segment ${i} done`, { jobId, chars: seg.script.length });
        } catch (ttsErr) {
          logger.error(`TTS segment ${i} failed`, { jobId, error: ttsErr instanceof Error ? ttsErr.message : String(ttsErr) });
          // Write a short silence file as fallback
          seg._audioPath = null;
        }
      }

      job.progress = 40;
      job.updatedAt = new Date();
      jobs.set(jobId, job);

      // ---- STEP 3: Fetch visuals for each segment ----
      logger.info('Step 3: Fetching visuals', { jobId });
      const fetcher = new VisualFetcher(logger);

      for (let i = 0; i < scriptData.segments.length; i++) {
        const seg = scriptData.segments[i];

        try {
          // 1. Harvest from the web first for dynamic fair use images (highly specific to actual news event)
          const webVisualPath = path.join(videoDir, `${videoId}_${i}.jpg`);
          let result = await fetcher.fromWeb(seg.visualQuery || 'news', webVisualPath);
          
          if (result.success) {
            seg._visualPath = webVisualPath;
          } else {
            // 2. Fallback to generic stock footage if crawling fails
            const stockVisualPath = path.join(videoDir, `${videoId}_${i}.mp4`);
            result = await fetcher.fromPexels(seg.visualQuery || 'news', stockVisualPath);
            if (!result.success) {
              result = await fetcher.fromPixabay(seg.visualQuery || 'news', stockVisualPath);
            }
            seg._visualPath = result.success ? stockVisualPath : null;
          }
          
          logger.info(`Visual segment ${i} done`, { jobId, success: Boolean(seg._visualPath) });
        } catch (vizErr) {
          logger.error(`Visual segment ${i} failed`, { jobId, error: vizErr instanceof Error ? vizErr.message : String(vizErr) });
          seg._visualPath = null;
        }
      }

      job.progress = 60;
      job.updatedAt = new Date();
      jobs.set(jobId, job);

      // ---- STEP 4: Render video via FFmpeg ----
      logger.info('Step 4: Rendering video', { jobId });
      const outputPath = path.join(outputDir, `${videoId}.mp4`);

      // Pick random background music from library
      const musicDir = path.join(filesBasePath, 'audio', 'music');
      let selectedMusic: string | undefined;
      try {
        if (fs.existsSync(musicDir)) {
          const songs = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3'));
          if (songs.length > 0) {
            selectedMusic = path.join(musicDir, songs[Math.floor(Math.random() * songs.length)]);
          }
        }
      } catch (e) {}

      const renderSegments = scriptData.segments
        .filter((seg: any) => seg._audioPath) // Only segments with audio
        .map((seg: any) => ({
          type: seg.type || 'content',
          audio: seg._audioPath,
          visual: seg._visualPath || undefined,
          lowerThird: seg.lowerThird,
          title: seg.type === 'intro' ? scriptData.youtubeTitle : undefined
        }));

      if (renderSegments.length === 0) {
        throw new Error('No renderable segments (all TTS failed)');
      }

      const renderer = new VideoRenderer(logger);
      await renderer.render({
        output: outputPath,
        segments: renderSegments,
        music: selectedMusic,
        musicVolume: 0.12,
        onProgress: (p: number) => {
          job.progress = 60 + Math.round(p * 0.3); // 60-90%
          job.updatedAt = new Date();
          jobs.set(jobId, job);
        }
      });

      job.progress = 90;
      job.updatedAt = new Date();
      jobs.set(jobId, job);

      // ---- STEP 5: Upload to YouTube ----
      logger.info('Step 5: Uploading to YouTube', { jobId, outputPath });
      const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;

      if (YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET && YOUTUBE_REFRESH_TOKEN && fs.existsSync(outputPath)) {
        try {
          const oauth2Client = new google.auth.OAuth2(
            YOUTUBE_CLIENT_ID,
            YOUTUBE_CLIENT_SECRET,
            'http://localhost:3000/oauth2callback'
          );
          oauth2Client.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });

          const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

          const uploadResult = await youtube.videos.insert({
            part: ['snippet', 'status'],
            requestBody: {
              snippet: {
                title: scriptData.youtubeTitle || title,
                description: scriptData.description || `News coverage: ${title}`,
                tags: scriptData.tags || ['news'],
                categoryId: '25'
              },
              status: {
                privacyStatus: 'public'
              }
            },
            media: {
              body: fs.createReadStream(outputPath)
            }
          });

          logger.info('YouTube upload successful!', { jobId, youtubeVideoId: uploadResult.data.id });

          // Log to published list for dedup
          const published = readPublishedVideos();
          published.unshift({
            videoId,
            youtubeVideoId: uploadResult.data.id || undefined,
            title: scriptData.youtubeTitle || title,
            publishedAt: new Date().toISOString(),
            articleUrl: link
          });
          writePublishedVideos(published.slice(0, 500));

        } catch (ytErr) {
          logger.error('YouTube upload failed', { jobId, error: ytErr instanceof Error ? ytErr.message : String(ytErr) });
        }
      } else {
        logger.warn('YouTube credentials missing or video file missing, skipping upload', { jobId });
      }

      job.status = 'complete';
      job.progress = 100;
      job.output = outputPath;
      job.updatedAt = new Date();
      jobs.set(jobId, job);

      logger.info('Auto-produce pipeline complete!', { jobId, title: scriptData.youtubeTitle });

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.updatedAt = new Date();
      jobs.set(jobId, job);
      logger.error('Auto-produce pipeline failed', { jobId, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

//Helper to ensure background music library exists
async function ensureMusicLibrary() {
  const filesBasePath = process.env.FILES_BASE_PATH || (process.env.NODE_ENV === 'production' ? '/files' : './files');
  const musicDir = path.join(filesBasePath, 'audio', 'music');
  fs.mkdirSync(musicDir, { recursive: true });

  const tracks = [
    { name: 'news_urgent.mp3', url: 'https://www.soundimage.org/wp-content/uploads/2016/10/Global-News-Reporting.mp3' },
    { name: 'news_tech.mp3', url: 'https://www.soundimage.org/wp-content/uploads/2015/06/High-Tech-News.mp3' },
    { name: 'news_corporate.mp3', url: 'https://www.soundimage.org/wp-content/uploads/2014/09/Information-Grid.mp3' }
  ];

  for (const track of tracks) {
    const trackPath = path.join(musicDir, track.name);
    if (!fs.existsSync(trackPath)) {
      try {
        logger.info(`Downloading music asset: ${track.name}`);
        await execPromise(`wget -q -O "${trackPath}" "${track.url}"`);
      } catch (err) {
        logger.warn(`Failed to download music track ${track.name}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

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
   ensureMusicLibrary().catch(e => logger.error('Music library check failed', { error: e.message }));
});
} catch (err) {
  console.error("FATAL ERROR ON STARTUP:", err);
  process.exit(1);
}
