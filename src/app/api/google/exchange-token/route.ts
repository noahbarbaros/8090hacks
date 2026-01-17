import { NextRequest, NextResponse } from "next/server";
import { GoogleCalendarService } from "@/lib/google-calendar";

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();
    
    if (!code) {
      return NextResponse.json(
        { error: "No authorization code provided" },
        { status: 400 }
      );
    }
    
    const calendarService = new GoogleCalendarService();
    const tokens = await calendarService.setCredentials(code);
    const email = await calendarService.getUserEmail(tokens);
    
    return NextResponse.json({ tokens, email });
  } catch (error: any) {
    console.error("Error exchanging code for tokens:", error);
    return NextResponse.json(
      { error: error.message || "Failed to exchange code for tokens" },
      { status: 500 }
    );
  }
}

