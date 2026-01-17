import { NextRequest, NextResponse } from "next/server";
import { GoogleCalendarService } from "@/lib/google-calendar";

export async function POST(request: NextRequest) {
  try {
    const { tokens } = await request.json();
    
    if (!tokens) {
      return NextResponse.json(
        { error: "No tokens provided" },
        { status: 400 }
      );
    }
    
    const calendarService = new GoogleCalendarService();
    const events = await calendarService.listEvents(tokens);
    
    return NextResponse.json({ events });
  } catch (error: any) {
    console.error("Error fetching calendar events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch calendar events" },
      { status: 500 }
    );
  }
}

