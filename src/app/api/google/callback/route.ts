import { NextRequest, NextResponse } from "next/server";
import { GoogleCalendarService } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  try {
    const calendarService = new GoogleCalendarService();
    const tokens = await calendarService.setCredentials(code);
    
    // In a real app, we'd save these tokens securely (HTTP-only cookie or DB)
    // For this simple demo, we'll redirect back to home with the tokens in the URL hash or query params
    // (Note: Passing tokens in URL is not secure for production!)
    
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

