import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { Logger } from 'winston';

interface ThumbnailOptions {
  output: string;
  title: string;
  image?: string;
  style: 'viral-news' | 'breaking' | 'documentary' | 'minimal';
}

export class ThumbnailGenerator {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async generate(options: ThumbnailOptions): Promise<void> {
    const { output, title, image, style = 'viral-news' } = options;
    
    // Generate HTML template
    const html = this.generateHTML(title, image, style);
    
    // Launch puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      // Wait for fonts to load
      await page.evaluate(() => document.fonts.ready);
      
      // Take screenshot
      await page.screenshot({ 
        path: output,
        type: 'jpeg',
        quality: 95
      });

      this.logger.info({ output, title, style }, 'Thumbnail generated');

    } finally {
      await browser.close();
    }
  }

  private generateHTML(title: string, image?: string, style: string = 'viral-news'): string {
    const truncatedTitle = title.length > 60 ? title.substring(0, 57) + '...' : title;
    
    const styles: { [key: string]: string } = {
      'viral-news': this.viralNewsStyle(truncatedTitle, image),
      'breaking': this.breakingStyle(truncatedTitle, image),
      'documentary': this.documentaryStyle(truncatedTitle, image),
      'minimal': this.minimalStyle(truncatedTitle, image)
    };

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              width: 1280px; 
              height: 720px; 
              overflow: hidden;
              font-family: 'Inter', sans-serif;
            }
          </style>
        </head>
        <body>
          ${styles[style] || styles['viral-news']}
        </body>
      </html>
    `;
  }

  private viralNewsStyle(title: string, image?: string): string {
    const backgroundImage = image ? `url('file://${image}')` : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)';
    
    return `
      <div style="
        width: 100%;
        height: 100%;
        background: ${backgroundImage};
        background-size: cover;
        background-position: center;
        position: relative;
        display: flex;
        align-items: flex-end;
        padding: 60px;
      ">
        <!-- Gradient overlay -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.2) 100%);
          z-index: 1;
        "></div>
        
        <!-- Channel bug -->
        <div style="
          position: absolute;
          top: 30px;
          right: 40px;
          background: #e74c3c;
          padding: 12px 24px;
          border-radius: 4px;
          z-index: 3;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          color: white;
          letter-spacing: 2px;
          box-shadow: 0 4px 20px rgba(231, 76, 60, 0.5);
        ">THE UPDATE DESK</div>
        
        <!-- Breaking news bar -->
        <div style="
          position: absolute;
          top: 30px;
          left: 40px;
          background: #e74c3c;
          padding: 10px 20px;
          z-index: 3;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 20px;
          color: white;
          letter-spacing: 3px;
          animation: pulse 2s infinite;
        ">BREAKING NEWS</div>
        
        <!-- Content -->
        <div style="position: relative; z-index: 2; width: 100%;">
          <h1 style="
            font-family: 'Bebas Neue', sans-serif;
            font-size: 72px;
            color: white;
            line-height: 1.1;
            text-shadow: 3px 3px 6px rgba(0,0,0,0.8);
            margin-bottom: 20px;
            letter-spacing: 1px;
          ">${title}</h1>
          
          <div style="
            display: flex;
            align-items: center;
            gap: 15px;
          ">
            <div style="
              width: 60px;
              height: 4px;
              background: #e74c3c;
            "></div>
            <span style="
              color: #bdc3c7;
              font-size: 18px;
              font-weight: 600;
              letter-spacing: 2px;
              text-transform: uppercase;
            ">Global News Network</span>
          </div>
        </div>
        
        <style>
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
        </style>
      </div>
    `;
  }

  private breakingStyle(title: string, image?: string): string {
    const backgroundImage = image ? `url('file://${image}')` : '#c0392b';
    
    return `
      <div style="
        width: 100%;
        height: 100%;
        background: ${backgroundImage};
        background-size: cover;
        background-position: center;
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: 80px;
      ">
        <!-- Red overlay -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(192, 57, 43, 0.85);
          z-index: 1;
        "></div>
        
        <!-- Content -->
        <div style="position: relative; z-index: 2; text-align: center;">
          <div style="
            background: white;
            color: #c0392b;
            padding: 20px 60px;
            font-family: 'Bebas Neue', sans-serif;
            font-size: 48px;
            letter-spacing: 8px;
            margin-bottom: 40px;
            display: inline-block;
          ">BREAKING</div>
          
          <h1 style="
            font-family: 'Bebas Neue', sans-serif;
            font-size: 84px;
            color: white;
            line-height: 1.1;
            text-shadow: 4px 4px 8px rgba(0,0,0,0.5);
          ">${title}</h1>
          
          <div style="
            margin-top: 40px;
            color: rgba(255,255,255,0.8);
            font-size: 24px;
            letter-spacing: 4px;
          ">THE UPDATE DESK</div>
        </div>
      </div>
    `;
  }

  private documentaryStyle(title: string, image?: string): string {
    const backgroundImage = image ? `url('file://${image}')` : 'linear-gradient(to bottom, #2c3e50, #34495e)';
    
    return `
      <div style="
        width: 100%;
        height: 100%;
        background: ${backgroundImage};
        background-size: cover;
        background-position: center;
        position: relative;
        display: flex;
        align-items: center;
        padding: 80px;
      ">
        <!-- Dark overlay -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.6);
          z-index: 1;
        "></div>
        
        <!-- Side accent -->
        <div style="
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 10px;
          background: #3498db;
          z-index: 2;
        "></div>
        
        <!-- Content -->
        <div style="position: relative; z-index: 2; max-width: 900px;">
          <div style="
            color: #3498db;
            font-size: 16px;
            letter-spacing: 4px;
            margin-bottom: 20px;
            text-transform: uppercase;
          ">Documentary</div>
          
          <h1 style="
            font-family: 'Inter', sans-serif;
            font-size: 64px;
            font-weight: 800;
            color: white;
            line-height: 1.2;
            margin-bottom: 30px;
          ">${title}</h1>
          
          <div style="
            display: flex;
            align-items: center;
            gap: 20px;
            color: rgba(255,255,255,0.7);
            font-size: 18px;
          ">
            <span>THE UPDATE DESK</span>
            <span style="color: #3498db;">•</span>
            <span>In-Depth Analysis</span>
          </div>
        </div>
      </div>
    `;
  }

  private minimalStyle(title: string, image?: string): string {
    const backgroundImage = image ? `url('file://${image}')` : '#000000';
    
    return `
      <div style="
        width: 100%;
        height: 100%;
        background: ${backgroundImage};
        background-size: cover;
        background-position: center;
        position: relative;
        display: flex;
        align-items: flex-end;
        padding: 60px;
      ">
        <!-- Subtle overlay -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%);
          z-index: 1;
        "></div>
        
        <!-- Content -->
        <div style="position: relative; z-index: 2; width: 100%;">
          <h1 style="
            font-family: 'Inter', sans-serif;
            font-size: 56px;
            font-weight: 700;
            color: white;
            line-height: 1.2;
            max-width: 1000px;
          ">${title}</h1>
          
          <div style="
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid rgba(255,255,255,0.3);
            color: rgba(255,255,255,0.6);
            font-size: 16px;
            letter-spacing: 3px;
            text-transform: uppercase;
          ">The Update Desk</div>
        </div>
      </div>
    `;
  }
}
