/**
 * YouTube OAuth Refresh Token Generator
 * 
 * This script generates a refresh token for YouTube Data API access.
 * Run this locally to get your refresh token, then add it to your Railway environment variables.
 * 
 * Usage:
 *   npx ts-node scripts/get-youtube-refresh-token.ts
 */

import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import open from 'open';

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || 'YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

async function getRefreshToken() {
  if (CLIENT_ID === 'YOUR_CLIENT_ID_HERE' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET_HERE') {
    console.error('❌ Error: Please set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    include_granted_scopes: true,
    prompt: 'consent' // Force to get refresh token
  });

  console.log('🌐 Opening browser for authentication...\n');
  console.log('If browser does not open automatically, visit this URL:');
  console.log(authUrl + '\n');

  // Open browser
  await open(authUrl);

  // Create temporary server to handle callback
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = url.parse(req.url!, true);
        
        if (reqUrl.pathname === '/oauth2callback') {
          const code = reqUrl.query.code as string;
          
          if (!code) {
            const error = reqUrl.query.error as string;
            res.end(`Authorization failed: ${error}`);
            reject(new Error(`Authorization failed: ${error}`));
            server.close();
            return;
          }

          // Exchange code for tokens
          const { tokens } = await oauth2Client.getToken(code);
          
          res.end(`
            <html>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: green;">✅ Authorization Successful!</h1>
                <p>You can close this window now.</p>
              </body>
            </html>
          `);
          
          server.close();
          
          if (!tokens.refresh_token) {
            reject(new Error('No refresh token received. Make sure you set prompt: "consent"'));
            return;
          }
          
          resolve(tokens.refresh_token);
        }
      } catch (error) {
        res.end('Error occurred');
        server.close();
        reject(error);
      }
    });

    server.listen(3000, () => {
      console.log('⏳ Waiting for authorization...');
    });

    // Timeout after 15 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timeout: Authorization took too long'));
    }, 900000);
  });
}

async function main() {
  console.log('📺 YouTube OAuth Refresh Token Generator\n');
  console.log('=' .repeat(50) + '\n');
  
  try {
    const refreshToken = await getRefreshToken();
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ SUCCESS! Your refresh token:\n');
    console.log(refreshToken);
    console.log('\n' + '='.repeat(50));
    console.log('\n📋 Next steps:');
    console.log('1. Copy the refresh token above');
    console.log('2. Add it to your Railway environment variables as YOUTUBE_REFRESH_TOKEN');
    console.log('3. You can now use the YouTube API without re-authenticating\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
