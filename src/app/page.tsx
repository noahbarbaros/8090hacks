"use client";

import { useState, useEffect } from "react";
import { fetchGitHubData, getGoogleAuthUrl, fetchCalendarEvents, fetchSlackMessages, sendSlackPrompts, getGoogleUserEmail, disconnectGoogleCalendar } from "./actions";
import { GitCommit, GitPullRequest, CircleDot, Github, Loader2, Calendar, MessageSquare, Send } from "lucide-react";

export default function Home() {
  const [token, setToken] = useState("");
  const owner = "noahbarbaros";
  const repo = "8090hacks";
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  const [slackMessages, setSlackMessages] = useState<any[]>([]);
  const [slackLoading, setSlackLoading] = useState(false);
  const [sendingPrompts, setSendingPrompts] = useState(false);
  const [promptStatus, setPromptStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  // Hardcoded channel ID for #all-8090-hackathon found via script
  const SLACK_CHANNEL_ID = "C0A95GGELEP"; 

  // Load calendar events on mount if cookie exists
  useEffect(() => {
    const loadCalendar = async () => {
        setCalendarLoading(true);
        const result = await fetchCalendarEvents();
        if (result.success && result.data) {
            setCalendarEvents(result.data);
            setIsGoogleConnected(true);
        }
        setCalendarLoading(false);
    };
    loadCalendar();
  }, []);

  // Load Slack messages on mount and when Google email is available
  useEffect(() => {
      const loadSlack = async () => {
          setSlackLoading(true);
          // Get Google email to filter messages by user
          const googleEmailResult = await getGoogleUserEmail();
          const userEmail = googleEmailResult.success ? googleEmailResult.email : undefined;
          
          const result = await fetchSlackMessages(SLACK_CHANNEL_ID, userEmail);
          if (result.success && result.data) {
              setSlackMessages(result.data);
          }
          setSlackLoading(false);
      };
      loadSlack();
  }, [isGoogleConnected]);


  const handleConnectGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setData(null);

    try {
      const result = await fetchGitHubData(token, owner, repo);
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleConnectGoogle = async () => {
      const url = await getGoogleAuthUrl();
      window.location.href = url;
  };

  const handleReconnectGoogle = async () => {
      // Disconnect first, then reconnect
      await disconnectGoogleCalendar();
      setIsGoogleConnected(false);
      setCalendarEvents([]);
      // Small delay to ensure cookie is cleared, then redirect to reconnect
      setTimeout(() => {
          handleConnectGoogle();
      }, 100);
  };

  const handleSendSlackPrompts = async () => {
    setSendingPrompts(true);
    setPromptStatus(null);
    
    try {
      // Get Google Calendar email (required for sending to specific user)
      const googleEmailResult = await getGoogleUserEmail();
      if (!googleEmailResult.success || !googleEmailResult.email) {
        const errorMsg = googleEmailResult.error?.includes('reconnect') 
          ? "Please reconnect Google Calendar to grant email access"
          : "Please connect Google Calendar first";
        setPromptStatus({ type: "error", message: errorMsg });
        setSendingPrompts(false);
        setTimeout(() => setPromptStatus(null), 5000);
        return;
      }
      
      // Filter calendar events to only today and yesterday
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const filteredCalendarEvents = calendarEvents.filter((event: any) => {
        if (!event.start?.dateTime && !event.start?.date) return false;
        
        const eventDate = event.start.dateTime 
          ? new Date(event.start.dateTime)
          : new Date(event.start.date);
        eventDate.setHours(0, 0, 0, 0);
        
        return eventDate.getTime() === today.getTime() || eventDate.getTime() === yesterday.getTime();
      });
      
      // Pass commits from the dashboard + Slack messages + filtered calendar events for the AI summary
      // Pass Google email to send prompt only to that user's Slack account
      const commits = data?.commits || [];
      const result = await sendSlackPrompts(commits, slackMessages, filteredCalendarEvents, googleEmailResult.email);
      if (result.success) {
        setPromptStatus({ type: "success", message: result.message || "Prompts sent!" });
      } else {
        setPromptStatus({ type: "error", message: result.error || "Failed to send prompts" });
      }
    } catch {
      setPromptStatus({ type: "error", message: "An unexpected error occurred" });
    } finally {
      setSendingPrompts(false);
      // Clear status after 3 seconds
      setTimeout(() => setPromptStatus(null), 3000);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-black">
      <div className="max-w-[1600px] mx-auto space-y-8">
        
        <header className="flex justify-between items-center mb-8">
            <div className="flex items-center space-x-4">
            <Github className="w-10 h-10" />
            <h1 className="text-3xl font-bold">Dev Dashboard</h1>
            </div>
            
            {/* Header Buttons */}
            <div className="flex items-center space-x-3">
                 {/* Send Slack Prompts Button */}
                 <div className="relative">
                    <button 
                        onClick={handleSendSlackPrompts}
                        disabled={sendingPrompts}
                        className="flex items-center space-x-2 bg-pink-500 text-white px-4 py-2 rounded-lg hover:bg-pink-600 transition-colors disabled:opacity-50"
                    >
                        {sendingPrompts ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <Send className="w-5 h-5" />
                        )}
                        <span>Send Slack Prompts</span>
                    </button>
                    {promptStatus && (
                        <div className={`absolute top-full mt-2 right-0 px-3 py-1 rounded-lg text-sm whitespace-nowrap ${
                            promptStatus.type === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                            {promptStatus.message}
                        </div>
                    )}
                 </div>
                 
                 {/* Google Calendar Connect/Reconnect Button */}
                 {isGoogleConnected ? (
                     <button 
                        onClick={handleReconnectGoogle}
                        className="flex items-center space-x-2 bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg hover:bg-green-100 transition-colors"
                        title="Reconnect to grant email access"
                    >
                        <Calendar className="w-5 h-5" />
                        <span>Reconnect Calendar</span>
                    </button>
                 ) : (
                    <button 
                        onClick={handleConnectGoogle}
                        className="flex items-center space-x-2 bg-white border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <Calendar className="w-5 h-5 text-blue-500" />
                        <span>Connect Google Calendar</span>
                    </button>
                 )}
            </div>
        </header>

        {/* Connection Form */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">GitHub Connection</h2>
          <form onSubmit={handleConnectGitHub} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="space-y-2 flex-grow">
              <label className="text-sm font-medium">Personal Access Token</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-black text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center whitespace-nowrap h-[42px]"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Connect GitHub"}
            </button>
          </form>
          {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}
        </div>

        {/* Dashboard Grid - Now 5 Columns */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            
            {/* Calendar Column */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 md:col-span-1">
              <div className="flex items-center space-x-2 mb-6">
                <Calendar className="w-6 h-6 text-red-500" />
                <h3 className="text-lg font-bold">Upcoming Events</h3>
              </div>
              <div className="space-y-4">
                {calendarLoading && <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />}
                {!calendarLoading && calendarEvents.length === 0 && (
                    <p className="text-gray-500 text-sm">
                        {isGoogleConnected ? "No upcoming events found." : "Connect Google Calendar to see your events."}
                    </p>
                )}
                {calendarEvents.map((event: any) => (
                  <div key={event.id} className="border-b border-gray-100 pb-3 last:border-0">
                    <p className="font-medium text-sm truncate">{event.summary}</p>
                    <div className="mt-1 text-xs text-gray-500">
                      {event.start.dateTime ? (
                          <>
                            <div className="font-semibold">{new Date(event.start.dateTime).toLocaleDateString()}</div>
                            <div>{new Date(event.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                          </>
                      ) : (
                          <span>All Day</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Slack Column */}
             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 md:col-span-1">
              <div className="flex items-center space-x-2 mb-6">
                <MessageSquare className="w-6 h-6 text-pink-500" />
                <h3 className="text-lg font-bold">Slack Activity</h3>
              </div>
              <div className="space-y-4">
                {slackLoading && <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />}
                {!slackLoading && !isGoogleConnected && (
                    <p className="text-gray-500 text-sm">Connect Google Calendar to see your Slack messages.</p>
                )}
                {!slackLoading && isGoogleConnected && slackMessages.length === 0 && (
                    <p className="text-gray-500 text-sm">No recent messages from you in #all-8090-hackathon.</p>
                )}
                {slackMessages.map((msg: any) => (
                  <div key={msg.ts} className="border-b border-gray-100 pb-3 last:border-0">
                    <p className="font-medium text-sm text-gray-800 line-clamp-3">{msg.text}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                      <span className="font-semibold text-pink-600">{msg.user}</span>
                      <span>{new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Commits Column */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 md:col-span-1">
              <div className="flex items-center space-x-2 mb-6">
                <GitCommit className="w-6 h-6 text-blue-500" />
                <h3 className="text-lg font-bold">Recent Commits</h3>
              </div>
              <div className="space-y-4">
                {data ? data.commits.map((commit: any) => (
                  <div key={commit.sha} className="border-b border-gray-100 pb-4 last:border-0">
                    <p className="font-medium text-sm truncate" title={commit.commit.message}>{commit.commit.message}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                      <span>{commit.commit.author.name}</span>
                      <span>{new Date(commit.commit.author.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                )) : <p className="text-gray-500 text-sm">Connect GitHub to see commits.</p>}
                {data && data.commits.length === 0 && <p className="text-gray-500">No commits found</p>}
              </div>
            </div>

            {/* PRs Column */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 md:col-span-1">
              <div className="flex items-center space-x-2 mb-6">
                <GitPullRequest className="w-6 h-6 text-purple-500" />
                <h3 className="text-lg font-bold">Pull Requests</h3>
              </div>
              <div className="space-y-4">
                {data ? data.prs.map((pr: any) => (
                  <div key={pr.id} className="border-b border-gray-100 pb-4 last:border-0">
                    <p className="font-medium text-sm truncate">{pr.title}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full ${
                        pr.state === 'open' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {pr.state}
                      </span>
                      <span>#{pr.number}</span>
                    </div>
                  </div>
                )) : <p className="text-gray-500 text-sm">Connect GitHub to see PRs.</p>}
                {data && data.prs.length === 0 && <p className="text-gray-500">No pull requests found</p>}
              </div>
            </div>

            {/* Issues Column */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 md:col-span-1">
              <div className="flex items-center space-x-2 mb-6">
                <CircleDot className="w-6 h-6 text-orange-500" />
                <h3 className="text-lg font-bold">Issues</h3>
              </div>
              <div className="space-y-4">
                {data ? data.issues.map((issue: any) => (
                  <div key={issue.id} className="border-b border-gray-100 pb-4 last:border-0">
                    <p className="font-medium text-sm truncate">{issue.title}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full ${
                        issue.state === 'open' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {issue.state}
                      </span>
                      <span>#{issue.number}</span>
                    </div>
                  </div>
                )) : <p className="text-gray-500 text-sm">Connect GitHub to see issues.</p>}
                {data && data.issues.length === 0 && <p className="text-gray-500">No issues found</p>}
              </div>
            </div>
            
          </div>
      </div>
    </main>
  );
}
