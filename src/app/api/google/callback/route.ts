import { NextRequest, NextResponse } from "next/server";
import { GoogleCalendarService } from "@/lib/google-calendar";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // Format: "slack_user_id|team_id"

  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  try {
    const calendarService = new GoogleCalendarService();
    const tokens = await calendarService.setCredentials(code);
    const email = await calendarService.getUserEmail(tokens);
    
    // If state is provided (from Slack), save to Supabase and notify Slack
    if (state) {
      const [slackUserId, teamId] = state.split('|');
      
      if (slackUserId && teamId) {
        // Save tokens to Supabase
        const { error: dbError } = await supabase
          .from("user_connections")
          .upsert({
            slack_user_id: slackUserId,
            team_id: teamId,
            google_tokens: tokens,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: "slack_user_id,team_id"
          });
        
        if (dbError) {
          console.error("❌ Failed to save to Supabase:", dbError);
        }
        
        // Notify backend to send Slack message
        const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
        try {
          await fetch(`${backendUrl}/api/google/callback-notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slackUserId,
              email,
              success: !dbError,
            }),
          });
        } catch (notifyError) {
          console.error("Failed to notify backend:", notifyError);
        }
        
        return NextResponse.redirect(new URL("/?slack_connected=true", request.url));
      }
    }
    
    // Fallback: save to cookie for dashboard use
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set("google_tokens", JSON.stringify(tokens), { 
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7 // 1 week
    });
    
    return response;
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}

