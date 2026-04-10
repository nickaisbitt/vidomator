import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import { Logger } from 'winston';

const execAsync = promisify(exec);

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
  text?: string;
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

      // Phase 2: Linear Assembly - Assemble all segments + music in one pass (80-100%)
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
      await this.createAudioOnlySegment(segment, output);
    } else {
      await this.processVisualSegment(segment, output);
    }
  }

  private async processVisualSegment(segment: VideoSegment, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const visualPath = segment.visual!;
      const audioPath = segment.audio;
      
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) return reject(err);
        
        const duration = metadata.format.duration || 10;
        const isImage = !visualPath.endsWith('.mp4') && !visualPath.endsWith('.mov');
        
        let command = ffmpeg().input(visualPath);
        if (isImage) {
          command = command.loop().inputOptions(['-t', String(duration)]);
        } else {
          command = command.inputOptions(['-stream_loop', '-1']);
        }

        command = command.input(audioPath);
        
        command
          .size('1920x1080')
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-pix_fmt', 'yuv420p',
            '-preset', 'veryfast',
            '-crf', '28',
            '-y'
          ])
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
    const segmentCount = segmentPaths.length;
    const hasMusic = musicPath && fs.existsSync(musicPath);

    // Build raw FFmpeg command string for 100% environment stability
    let inputs = segmentPaths.map(p => `-i "${p}"`).join(' ');
    let filter = '';
    
    // Concat segments
    let concatInput = '';
    for (let i = 0; i < segmentCount; i++) {
        concatInput += `[${i}:v][${i}:a]`;
    }
    filter += `${concatInput}concat=n=${segmentCount}:v=1:a=1[vv][aa]`;

    let mapV = '[vv]';
    let mapA = '[aa]';

    if (hasMusic) {
        inputs += ` -stream_loop -1 -i "${musicPath}"`;
        filter += `;[${segmentCount}:a]volume=${musicVolume}[m];[aa][m]amix=inputs=2:duration=first[a]`;
        mapA = '[a]';
    }

    const command = `ffmpeg ${inputs} -filter_complex "${filter}" -map "${mapV}" -map "${mapA}" -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 28 -c:a aac -b:a 128k -y "${output}"`;

    console.log(`[INFO] EXEC Final Assembly: ${command}`);
    
    try {
        const { stderr } = await execAsync(command);
        if (stderr && stderr.includes('Error') && !stderr.includes('swscaler')) {
            console.warn(`[WARN] FFmpeg STDERR: ${stderr}`);
        }
    } catch (err: any) {
        console.error(`[ERRO] FFmpeg EXEC failed`, { error: err.message, stderr: err.stderr });
        throw err;
    }
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
