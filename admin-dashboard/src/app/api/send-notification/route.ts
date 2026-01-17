import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { slackUserId, message, teamId } = body;

    if (!slackUserId || !message) {
      return NextResponse.json(
        { error: "slackUserId and message are required" },
        { status: 400 }
      );
    }

    // Call the backend API to send Slack notification
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
    
    const response = await fetch(`${backendUrl}/api/send-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slackUserId,
        message,
        teamId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to send notification" },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true, message: data.message });
  } catch (error: any) {
    console.error("Error in POST /api/send-notification:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

