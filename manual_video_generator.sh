#!/bin/bash
# Manual Video Generation Script for Vidomator
# Use this when the automated pipeline is unavailable

echo "Vidomator Manual Video Generator"
echo "================================="

# Configuration
RENDER_SERVICE_URL="https://render-service-production-3b75.up.railway.app"
N8N_URL="https://vidomator.up.railway.app"
API_KEY="test-key"  # From your .env.example

# Check if render service is available
check_render_service() {
    echo "Checking render service availability..."
    response=$(curl -s -o /dev/null -w "%{http_code}" "${RENDER_SERVICE_URL}/health")
    if [ "$response" = "200" ]; then
        echo "✓ Render service is available"
        return 0
    else
        echo "✗ Render service is unavailable (HTTP $response)"
        return 1
    fi
}

# Generate a test video using direct API calls
generate_test_video() {
    local title="$1"
    local script="$2"
    local voice="${3:-matt}"
    
    echo "Generating video: $title"
    echo "Script length: ${#script} characters"
    
    # Step 1: Generate TTS audio files (simplified - would need Speechify integration)
    echo "Step 1: Generating TTS audio..."
    mkdir -p /tmp/vidomator_manual
    
    # Split script into segments (by double newline)
    IFS=$'\n\n' read -d '' -r -a segments <<< "$script"
    segment_count=${#segments[@]}
    echo "Split into $segment_count segments"
    
    audio_files=()
    for i in "${!segments[@]}"; do
        # In a real implementation, this would call Speechify API
        audio_file="/tmp/vidomator_manual/audio_${i}.mp3"
        touch "$audio_file"  # Placeholder
        audio_files+=("$audio_file")
        echo "  Segment $((i+1)): ${segments[$i]:0:50}... -> $audio_file"
    done
    
    # Step 2: Generate thumbnail/visuals
    echo "Step 2: Generating visuals..."
    # In real implementation, this would call image generation APIs
    thumbnail_file="/tmp/vidomator_manual/thumbnail.jpg"
    touch "$thumbnail_file"
    echo "  Thumbnail: $thumbnail_file"
    
    # Step 3: Assemble video using render service (if available)
    if check_render_service; then
        echo "Step 3: Assembling video via render service..."
        
        # Build segments array for render service
        segments_json=""
        for i in "${!audio_files[@]}"; do
            if [ -n "$segments_json" ]; then
                segments_json="$segments_json,"
            fi
            segments_json="$segments_json{\"type\":\"static_title\",\"audio\":\"${audio_files[$i]}\",\"visual\":\"\",\"lowerThird\":\"\",\"title\":\"\"}"
        done
        
        # Call render service
        response=$(curl -s -X POST "${RENDER_SERVICE_URL}/render" \
            -H "Content-Type: application/json" \
            -H "x-api-key: $API_KEY" \
            -d "{
                \"output\": \"/tmp/vidomator_manual/output.mp4\",
                \"segments\": [${segments_json}],
                \"music\": null,
                \"musicVolume\": 0.15,
                \"thumbnail\": {
                    \"output\": \"/tmp/vidomator_manual/thumbnail.jpg\",
                    \"title\": \"$title\",
                    \"style\": \"viral-news\"
                }
            }")
        
        echo "Render service response: $response"
        
        if echo "$response" | grep -q '"status":"ok"'; then
            echo "✓ Video generation started successfully"
            job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
            echo "Job ID: $job_id"
            
            # Poll for completion
            echo "Polling for completion..."
            for i in {1..30}; do
                status_response=$(curl -s "${RENDER_SERVICE_URL}/status/${job_id}")
                status=$(echo "$status_response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
                progress=$(echo "$status_response" | grep -o '"progress":[0-9]*' | cut -d'"' -f4)
                
                echo "Status: $status (${progress}%)"
                
                if [ "$status" = "complete" ]; then
                    echo "✓ Video generation complete!"
                    echo "Output: /tmp/vidomator_manual/output.mp4"
                    break
                elif [ "$status" = "failed" ]; then
                    error=$(echo "$status_response" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
                    echo "✗ Video generation failed: $error"
                    break
                fi
                
                sleep 10
            done
        else
            echo "✗ Failed to start video generation: $response"
        fi
    else
        echo "⚠ Render service unavailable - generated placeholder files only"
        echo "Generated files in /tmp/vidomator_manual/:"
        ls -la /tmp/vidomator_manual/
    fi
}

# Main execution
if [ $# -lt 2 ]; then
    echo "Usage: $0 \"<title>\" \"<script>\" [voice]"
    echo "Example: $0 \"Breaking News\" \"Today in tech...\" matt"
    exit 1
fi

title="$1"
script="$2"
voice="${3:-matt}"

echo "Title: $title"
echo "Voice: $voice"
echo

generate_test_video "$title" "$script" "$voice"

echo
echo "Manual video generation process completed."
echo "Check /tmp/vidomator_manual/ for generated files."