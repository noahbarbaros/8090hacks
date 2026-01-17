import { NextRequest, NextResponse } from "next/server";

// ElevenLabs API configuration
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

// Default voice - "Rachel" is a clear, professional voice
// You can change this to any ElevenLabs voice ID
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "ElevenLabs API key is not configured. Please set ELEVENLABS_API_KEY in your environment variables.",
        },
        { status: 500 }
      );
    }

    const { script, voiceId } = await request.json();

    if (!script || !script.trim()) {
      return NextResponse.json(
        { error: "Script text is required" },
        { status: 400 }
      );
    }

    // Use provided voice ID or default
    const selectedVoiceId = voiceId || DEFAULT_VOICE_ID;

    // Truncate script if it's too long (ElevenLabs has limits)
    // Max ~5000 characters for good performance
    const maxLength = 5000;
    let processedScript = script;
    if (script.length > maxLength) {
      console.log(`Script too long (${script.length} chars), truncating to ${maxLength}`);
      processedScript = script.substring(0, maxLength) + "... That's all for today's standup!";
    }

    console.log(`Generating audio for script (${processedScript.length} chars)...`);

    // Create AbortController for timeout (60 seconds for long scripts)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      // Call ElevenLabs Text-to-Speech API
      const response = await fetch(
        `${ELEVENLABS_API_URL}/text-to-speech/${selectedVoiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: processedScript,
            model_id: "eleven_turbo_v2_5", // Latest model, available on free tier
            voice_settings: {
              stability: 0.5, // Balance between stability and expressiveness
              similarity_boost: 0.75, // How closely to match the original voice
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("ElevenLabs API error:", errorText);

        // Parse error if it's JSON
        let errorMessage = "Failed to generate audio";
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage =
            errorJson.detail?.message || errorJson.error || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }

        return NextResponse.json(
          { error: errorMessage },
          { status: response.status }
        );
      }

      // Get the audio data as an ArrayBuffer
      const audioBuffer = await response.arrayBuffer();

      console.log(`Audio generated successfully (${audioBuffer.byteLength} bytes)`);

      // Return the audio as a binary response
      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": audioBuffer.byteLength.toString(),
        },
      });
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      
      // Check if it's an abort error (timeout)
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error("ElevenLabs request timed out after 60s");
        return NextResponse.json(
          { error: "Audio generation timed out. Try with a shorter script." },
          { status: 504 }
        );
      }
      
      // Network error
      console.error("Network error calling ElevenLabs:", fetchError);
      return NextResponse.json(
        { error: "Network error connecting to ElevenLabs. Please check your internet connection and try again." },
        { status: 503 }
      );
    }
  } catch (error: unknown) {
    console.error("Error in POST /api/generate-audio:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// GET endpoint to list available voices (optional, useful for testing)
export async function GET() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "ElevenLabs API key is not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch voices" },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Return simplified voice list
    const voices = data.voices.map(
      (voice: {
        voice_id: string;
        name: string;
        labels: Record<string, string>;
      }) => ({
        id: voice.voice_id,
        name: voice.name,
        labels: voice.labels,
      })
    );

    return NextResponse.json({ voices });
  } catch (error: unknown) {
    console.error("Error fetching voices:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
