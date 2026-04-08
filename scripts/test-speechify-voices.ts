/**
 * Speechify Voice Tester
 * 
 * Tests multiple Speechify voices and generates samples for comparison.
 * 
 * Usage:
 *   npx ts-node scripts/test-speechify-voices.ts
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';

const SPEECHIFY_API_KEY = process.env.SPEECHIFY_API_KEY || 'YOUR_API_KEY_HERE';

// Test voices - using "nick" as requested by user
// You can add more voices here to compare
const TEST_VOICES = [
  {
    id: 'nick',
    name: 'Nick (Primary)',
    description: 'Male, professional news anchor style - REQUESTED BY USER'
  }
];

const TEST_SCRIPT = `Breaking news tonight. Tensions escalate in the Middle East as diplomats race against time to secure a lasting peace agreement. I'm your host with the latest developments on this developing story.`;

async function testVoice(voice: typeof TEST_VOICES[0]) {
  try {
    console.log(`\n🎙️  Testing: ${voice.name}`);
    console.log(`   Description: ${voice.description}`);
    console.log(`   Voice ID: ${voice.id}`);
    
    const response = await axios.post(
      'https://api.speechify.ai/v1/audio/stream',
      {
        input: TEST_SCRIPT,
        voice_id: voice.id,
        model: 'simba-english',
        audio_format: 'mp3',
        options: {
          text_normalization: false,
          loudness_normalization: true
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${SPEECHIFY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );

    const outputPath = path.join(__dirname, `../test-output/voice_${voice.id.replace(/[^a-z0-9]/gi, '_')}.mp3`);
    
    // Ensure directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    
    fs.writeFileSync(outputPath, Buffer.from(response.data));
    
    console.log(`   ✅ Saved: ${outputPath}`);
    return { success: true, voice: voice.name, path: outputPath };
    
  } catch (error) {
    console.log(`   ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { success: false, voice: voice.name, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function main() {
  console.log('\n🎤 Speechify Voice Tester');
  console.log('='.repeat(50));
  
  if (SPEECHIFY_API_KEY === 'YOUR_API_KEY_HERE') {
    console.error('\n❌ Error: Please set SPEECHIFY_API_KEY environment variable');
    console.log('   Example: SPEECHIFY_API_KEY=your_key npx ts-node scripts/test-speechify-voices.ts\n');
    process.exit(1);
  }

  const results = [];
  
  for (const voice of TEST_VOICES) {
    const result = await testVoice(voice);
    results.push(result);
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 Results Summary\n');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}\n`);
  
  if (successful.length > 0) {
    console.log('🎙️  Working voices:');
    successful.forEach(r => {
      console.log(`   - ${r.voice}: ${r.path}`);
    });
    console.log('\n👉 Listen to the samples and choose your preferred voice.');
    console.log('   Then update the voice_id in n8n workflows.\n');
  }
  
  if (failed.length > 0) {
    console.log('⚠️  Failed voices:');
    failed.forEach(r => {
      console.log(`   - ${r.voice}: ${r.error}`);
    });
    console.log('\nThese voice IDs may not be available on your account.');
    console.log('Check your Speechify dashboard for available voices.\n');
  }
}

main().catch(console.error);
