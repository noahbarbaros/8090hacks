import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});

// Helper function to get today's date string in YYYY-MM-DD format
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

export async function POST(request: NextRequest) {
  try {
    // Check if Cerebras API is configured
    if (!process.env.CEREBRAS_API_KEY) {
      return NextResponse.json(
        { error: "Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your environment variables." },
        { status: 500 }
      );
    }

    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Supabase configuration is missing." },
        { status: 500 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase client is not initialized." },
        { status: 500 }
      );
    }

    const { question, teamId, channelId } = await request.json();

    if (!question || !question.trim()) {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    // Determine team ID
    let resolvedTeamId = teamId;
    if (channelId && !teamId) {
      // Try to get team ID from channel
      const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
      try {
        const response = await fetch(`${backendUrl}/api/channel-members?channel_id=${encodeURIComponent(channelId)}`);
        if (response.ok) {
          const data = await response.json();
          resolvedTeamId = data.teamId;
        }
      } catch (e) {
        console.error("Error fetching team ID from channel:", e);
      }
    }

    if (!resolvedTeamId) {
      return NextResponse.json(
        { error: "Team ID is required. Please load members first or provide a team ID." },
        { status: 400 }
      );
    }

    // Fetch all recent recaps for the team (last 7 days)
    const today = getTodayDateString();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoString = sevenDaysAgo.toISOString().split('T')[0];

    const { data: recaps, error: recapsError } = await supabase
      .from("daily_recaps")
      .select("user_id, team_id, submitted_at, progress, blockers, plan, notes, is_ai_generated")
      .eq("team_id", resolvedTeamId)
      .gte("submitted_at", `${sevenDaysAgoString}T00:00:00Z`)
      .lte("submitted_at", `${today}T23:59:59Z`)
      .order("submitted_at", { ascending: false });

    if (recapsError) {
      console.error("Error fetching recaps:", recapsError);
      return NextResponse.json(
        { error: "Failed to fetch recap data from database." },
        { status: 500 }
      );
    }

    // Get user names for context
    const userIds = [...new Set((recaps || []).map((r: any) => r.user_id))];
    const { data: connections } = await supabase
      .from("user_connections")
      .select("slack_user_id, slack_user_name")
      .eq("team_id", resolvedTeamId)
      .in("slack_user_id", userIds);

    const userNameMap = new Map(
      (connections || []).map((c: any) => [c.slack_user_id, c.slack_user_name || c.slack_user_id])
    );

    // Format recaps for context
    const recapsContext = (recaps || []).map((recap: any) => {
      const userName = userNameMap.get(recap.user_id) || recap.user_id;
      const date = new Date(recap.submitted_at).toLocaleDateString();
      return {
        user: userName,
        date: date,
        progress: recap.progress || "",
        blockers: recap.blockers || "",
        plan: recap.plan || "",
        notes: recap.notes || "",
        is_ai_generated: recap.is_ai_generated || false,
      };
    });

    // Build context string
    const contextString = recapsContext.length > 0
      ? `Here are the daily recaps from the team (last 7 days):\n\n${recapsContext.map((r: any, idx: number) => 
          `Recap ${idx + 1}:\n` +
          `- User: ${r.user}\n` +
          `- Date: ${r.date}\n` +
          `- Progress: ${r.progress || "None"}\n` +
          `- Blockers: ${r.blockers || "None"}\n` +
          `- Plan: ${r.plan || "None"}\n` +
          `- Notes: ${r.notes || "None"}\n` +
          `- AI Generated: ${r.is_ai_generated ? "Yes" : "No"}\n`
        ).join("\n")}`
      : "No recaps found for this team in the last 7 days.";

    // Query Cerebras AI with the context (streaming enabled)
    const stream = await openai.chat.completions.create({
      model: "llama-3.3-70b",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that answers questions about daily team recaps. 
You have access to recap data including progress, blockers, plans, and notes from team members.
Answer questions based on the provided recap data. Be concise, accurate, and helpful.
If the question cannot be answered with the available data, say so clearly.`,
        },
        {
          role: "user",
          content: `${contextString}\n\nQuestion: ${question}\n\nPlease provide a helpful answer based on the recap data above.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
    });

    // Create a streaming response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Error in POST /api/chat:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

