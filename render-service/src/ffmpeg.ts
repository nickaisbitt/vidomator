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
      // Phase 1: Process each segment (0-50%)
      const processedSegments: string[] = [];
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentFile = path.join(tempDir, `segment_${i}.mp4`);
        
        await this.processSegment(segment, segmentFile);
        processedSegments.push(segmentFile);
        
        onProgress?.(Math.round((i + 1) / segments.length * 50));
      }

      // Phase 2: Concatenate segments (50-80%)
      const concatFile = path.join(tempDir, 'concat.txt');
      const concatList = processedSegments.map(s => `file '${s}'`).join('\n');
      fs.writeFileSync(concatFile, concatList);

      const concatOutput = path.join(tempDir, 'concatenated.mp4');
      await this.concatenateSegments(concatFile, concatOutput);
      
      onProgress?.(80);

      // Phase 3: Add background music if provided (80-90%)
      let finalOutput = concatOutput;
      if (music && fs.existsSync(music)) {
        const withMusic = path.join(tempDir, 'with_music.mp4');
        await this.addBackgroundMusic(concatOutput, music, withMusic, musicVolume);
        finalOutput = withMusic;
        onProgress?.(90);
      }

       // Phase 4: Final encoding (90-100%)
       await this.finalEncode(finalOutput, output);
       
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
        
        let command = ffmpeg();
        let currentV = 'v_proc';
        if (isImage) {
          // Image input - loop for duration
          command = command.input(visualPath)
            .loop()
            .inputOptions(['-t', String(duration)]);
          
          // Ultra-stable cinematic vignette and resize
          filters.push(`[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,vignette=angle=0.4,format=yuv420p[v_proc]`);
        } else {
          // Video input - infinite loop
          command = command.input(visualPath).inputOptions(['-stream_loop', '-1']);
          filters.push('[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,vignette=angle=0.4,format=yuv420p[v_proc]');
        }
        
        command = command.input(audioPath);
        
        // Add lower third if specified
        if (segment.lowerThird) {
          const lowerThirdFilter = this.buildLowerThirdFilter(segment.lowerThird, duration);
          filters.push(`[${currentV}]${lowerThirdFilter}[v_text]`);
          currentV = 'v_text';
        }
        
        // Add a subtle fade in/out with rounded timings
        const fadeDuration = Math.min(0.8, duration / 4);
        const fadeStart = Math.max(0, duration - fadeDuration);
        filters.push(`[${currentV}]fade=t=in:st=0:d=${fadeDuration.toFixed(2)},fade=t=out:st=${fadeStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}[v_faded]`);
        
        command.complexFilter(filters)
          .outputOptions([
            '-map', '[v_faded]',
            '-map', '1:a',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-shortest',
            '-y'
          ])
          .output(output)
          .on('end', () => resolve())
          .on('error', reject)
          .run();
      });
    });
  }

  private async createAudioOnlySegment(segment: VideoSegment, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(segment.audio, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        
        const duration = metadata.format.duration || 10;
        
        // Generate black background with optional title
        let videoFilter = 'color=c=black:s=1920x1080:d=' + duration;
        
        if (segment.title) {
          const escapedTitle = segment.title.replace(/'/g, "'\\''");
          videoFilter += `,drawtext=text='${escapedTitle}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf`;
        }
        
        if (segment.lowerThird) {
          const escapedLowerThird = segment.lowerThird.replace(/'/g, "'\\''");
          videoFilter += `,drawtext=text='${escapedLowerThird}':fontcolor=white:fontsize=48:x=100:y=h-100:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf:box=1:boxcolor=red@0.8:boxborderw=10`;
        }
        
        ffmpeg()
          .input(segment.audio)
          .inputFormat('mp3')
          .outputOptions([
            '-f', 'lavfi',
            '-i', videoFilter,
            '-shortest',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-y'
          ])
          .output(output)
          .on('end', () => resolve())
          .on('error', reject)
          .run();
      });
    });
  }

  private buildLowerThirdFilter(text: string, duration: number): string {
    const escapedText = text.replace(/'/g, "'\\''");
    
    // News-style lower third with red bar and dynamic shadow
    return `drawbox=x=0:y=h-120:w=iw:h=120:color=red@0.9:t=fill,` +
           `drawtext=text='${escapedText}':fontcolor=white:fontsize=42:shadowcolor=black@0.6:shadowx=3:shadowy=3:` +
           `x=50:y=h-85:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf`;
  }

  private async concatenateSegments(concatFile: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c', 'copy',
          '-y'
        ])
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  private async addBackgroundMusic(
    videoPath: string, 
    musicPath: string, 
    output: string,
    volume: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(musicPath)
        .complexFilter([
          `[1:a]aloop=loop=-1:size=2e+09,volume=${volume}[music]`,
          `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[a]`
        ])
        .outputOptions([
          '-map', '0:v',
          '-map', '[a]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest',
          '-y'
        ])
        .output(output)
        .on('end', () => resolve())
        .on('error', reject)
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
