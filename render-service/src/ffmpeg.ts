import ffmpeg from 'fluent-ffmpeg';
import { Logger } from 'winston';
import fs from 'fs';
import path from 'path';

interface RenderOptions {
  output: string;
  segments: VideoSegment[];
  music?: string;
  musicVolume?: number;
  onProgress?: (progress: number) => void;
}

interface VideoSegment {
  type: 'intro' | 'broll_stock' | 'broll_seedance' | 'image_web' | 'image_generated' | 'static_title';
  audio: string;
  visual?: string;
  query?: string;
  lowerThird?: string;
  title?: string;
  duration?: number;
}

export class VideoRenderer {
  private logger: Logger;
  private basePath = process.env.FILES_BASE_PATH || (process.env.NODE_ENV === 'production' ? '/files' : './files');

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async render(options: RenderOptions): Promise<void> {
    const { output, segments, music, musicVolume = 0.15, onProgress } = options;
    
    const tempDir = path.join(this.basePath, 'temp', `render_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Phase 1: Process each segment (0-80%)
      const processedSegments: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentFile = path.join(tempDir, `segment_${i}.mp4`);
        await this.processSegment(segment, segmentFile);
        processedSegments.push(segmentFile);
        onProgress?.(Math.round((i + 1) / segments.length * 80));
      }

      // Phase 2: Linear Assembly - Assemble all segments + music in one robust pass (80-100%)
      await this.assembleFinalBroadcast(processedSegments, music, musicVolume, output);
      onProgress?.(100);
      this.logger.info('Video render complete', { output });
    } finally {
      // Cleanup temp files
      this.cleanup(tempDir);
    }
  }

  private async processSegment(segment: VideoSegment, output: string): Promise<void> {
    const hasVisual = segment.visual && fs.existsSync(segment.visual);
    
    if (!hasVisual) {
      // Audio-only segment with black background + lower third
      await this.createAudioOnlySegment(segment, output);
    } else {
      // Process with visual
      await this.processVisualSegment(segment, output);
    }
  }

  private async processVisualSegment(segment: VideoSegment, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const visualPath = segment.visual!;
      const audioPath = segment.audio;
      
      // Get audio duration
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        
        const duration = metadata.format.duration || 10;
        const isImage = !visualPath.endsWith('.mp4') && !visualPath.endsWith('.mov');
        
        let command = ffmpeg()
          .input(visualPath);
        
        if (isImage) {
          command = command.loop().inputOptions(['-t', String(duration)]);
        } else {
          command = command.inputOptions(['-stream_loop', '-1']);
        }

        command = command.input(audioPath);
        
        // ABSOLUTE RECOVERY: Zero complex filters. Raw resolution and mapping only.
        command
          .size('1920x1080')
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-pix_fmt', 'yuv420p',
            '-preset', 'veryfast',
            '-crf', '28',
            '-y'
          ]);

        command
          .output(output)
          .on('start', (cmd) => console.log(`[INFO] RECOVERY Rendering: ${cmd}`))
          .on('end', () => resolve())
          .on('error', (err) => {
            console.error(`[ERRO] RECOVERY Rendering failed`, { error: err.message });
            reject(err);
          })
          .run();
      });
    });
  }

  private async createAudioOnlySegment(segment: VideoSegment, output: string): Promise<void> {
    // Basic black background for segments without visuals
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input('color=c=black:s=1920x1080:d=10')
        .inputOptions(['-f', 'lavfi'])
        .input(segment.audio)
        .outputOptions([
          '-c:v', 'libx264',
          '-tune', 'stillimage',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest',
          '-pix_fmt', 'yuv420p',
          '-y'
        ])
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  private buildLowerThirdFilter(text: string, duration: number): string {
    const escapedText = text.replace(/'/g, "'\\''");
    
    // News-style lower third with red bar and dynamic shadow
    return `drawbox=x=0:y=h-120:w=iw:h=120:color=red@0.9:t=fill,` +
           `drawtext=text='${escapedText}':fontcolor=white:fontsize=42:shadowcolor=black@0.6:shadowx=3:shadowy=3:` +
           `x=50:y=h-85:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf`;
  }

  private async assembleFinalBroadcast(
    segmentPaths: string[],
    musicPath: string | undefined,
    musicVolume: number,
    output: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg();
      
      // 1. Add all segments
      segmentPaths.forEach(p => command = command.input(p));
      
      // 2. Add music if provided
      const hasMusic = musicPath && fs.existsSync(musicPath);
      if (hasMusic) {
        command = command.input(musicPath!).inputOptions(['-stream_loop', '-1']);
      }

      const segmentCount = segmentPaths.length;
      
      // 3. Build the simplest possible concat + mix filter
      // [0:v][0:a][1:v][1:a]...concat=n=X:v=1:a=1[v][a]
      let filter = '';
      for (let i = 0; i < segmentCount; i++) {
        filter += `[${i}:v][${i}:a]`;
      }
      filter += `concat=n=${segmentCount}:v=1:a=1[vv][aa]`;

      if (hasMusic) {
        // [aa][music_input:a]amix=inputs=2:duration=first[a]
        filter += `;[${segmentCount}:a]volume=${musicVolume}[m];[aa][m]amix=inputs=2:duration=first[a]`;
      }

      command
        .complexFilter(filter)
        .outputOptions([
          '-map', '[vv]',
          '-map', hasMusic ? '[a]' : '[aa]',
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-y'
        ])
        .output(output)
        .on('start', (cmd) => console.log(`[INFO] Final Assembly Started: ${cmd}`))
        .on('end', () => resolve())
        .on('error', (err) => {
          console.error(`[ERRO] Final Assembly Failed`, { error: err.message });
          reject(err);
        })
        .run();
    });
  }

  private async finalEncode(input: string, output: string): Promise<void> {
    // Ensure output directory exists
    const outputDir = path.dirname(output);
    fs.mkdirSync(outputDir, { recursive: true });
    
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(input)
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'slow', // Better quality for final
          '-crf', '21',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart', // Web-optimized
          '-y'
        ])
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  private cleanup(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
     } catch (error) {
       this.logger.warn('Failed to cleanup temp directory', { dir, error: error instanceof Error ? error.message : String(error) });
     }
  }
}
