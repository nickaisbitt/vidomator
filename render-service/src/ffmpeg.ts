import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
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
  type: string;
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
      this.logger.info('Starting Scorched Earth Render (Direct CLI)', { segmentCount: segments.length });

      // Phase 1: Process each segment (0-70%)
      const processedSegments: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segFile = path.join(tempDir, `seg_${i}.mp4`);
        await this.processSegmentSurgical(segments[i], segFile);
        processedSegments.push(segFile);
        onProgress?.(Math.round(((i + 1) / segments.length) * 70));
      }

      // Phase 2: Final Assembly (70-100%)
      await this.assembleFinalSurgical(processedSegments, music, musicVolume, output);
      onProgress?.(100);
      
      this.logger.info('Broadcast stabilized and rendered', { output });
    } catch (err: any) {
      this.logger.error('Surgical render failed', { error: err.message, stack: err.stack });
      throw err;
    } finally {
      this.cleanup(tempDir);
    }
  }

  private async processSegmentSurgical(segment: VideoSegment, output: string): Promise<void> {
    const hasVisual = segment.visual && fs.existsSync(segment.visual);
    const audioPath = segment.audio;
    
    if (!hasVisual) {
       // Black screen baseline
       const cmd = `ffmpeg -f lavfi -i color=c=black:s=1920x1080:d=10 -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 128k -shortest -pix_fmt yuv420p -y "${output}"`;
       await execAsync(cmd);
    } else {
       const visualPath = segment.visual!;
       const isImage = !visualPath.endsWith('.mp4') && !visualPath.endsWith('.mov');
       
       let cmd: string;
       if (isImage) {
         // Use -shortest to match audio length for image loop
         cmd = `ffmpeg -loop 1 -i "${visualPath}" -i "${audioPath}" -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 28 -c:a aac -b:a 128k -shortest -y "${output}"`;
       } else {
         // Loop video to match audio length - try to be more robust with -fflags +genpts
         cmd = `ffmpeg -stream_loop -1 -fflags +genpts -i "${visualPath}" -i "${audioPath}" -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 28 -c:a aac -b:a 128k -shortest -y "${output}"`;
       }
       
       console.log(`[INFO] Surgically processing segment: ${output}`);
       await execAsync(cmd);
    }
  }

  private async assembleFinalSurgical(
    segments: string[],
    music: string | undefined,
    volume: number,
    output: string
  ): Promise<void> {
    const hasMusic = music && fs.existsSync(music);
    let inputs = segments.map(s => `-i "${s}"`).join(' ');
    let filter = '';
    
    // Concat
    let concat = '';
    for (let i = 0; i < segments.length; i++) concat += `[${i}:v][${i}:a]`;
    filter += `${concat}concat=n=${segments.length}:v=1:a=1[vv][aa]`;

    let mapV = '[vv]';
    let mapA = '[aa]';

    if (hasMusic) {
      inputs += ` -stream_loop -1 -i "${music}"`;
      filter += `;[${segments.length}:a]volume=${volume}[m];[aa][m]amix=inputs=2:duration=first[a]`;
      mapA = '[a]';
    }

    const finalCmd = `ffmpeg ${inputs} -filter_complex "${filter}" -map "${mapV}" -map "${mapA}" -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 28 -c:a aac -b:a 128k -y "${output}"`;
    
    console.log(`[INFO] Scorched Earth Final Assembly: ${finalCmd}`);
    await execAsync(finalCmd);
  }

  private cleanup(dir: string): void {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[WARN] Cleanup failed`, err);
    }
  }
}
