"use client";

import { useState, useEffect } from "react";
import { fetchGitHubData, getGoogleAuthUrl, fetchCalendarEvents, fetchSlackMessages } from "./actions";
import { GitCommit, GitPullRequest, CircleDot, Github, Loader2, Calendar, MessageSquare } from "lucide-react";

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

  // Load Slack messages on mount
  useEffect(() => {
      const loadSlack = async () => {
          setSlackLoading(true);
          const result = await fetchSlackMessages(SLACK_CHANNEL_ID);
          if (result.success && result.data) {
              setSlackMessages(result.data);
          }
          setSlackLoading(false);
      };
      loadSlack();
  }, []);


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

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-black">
      <div className="max-w-[1600px] mx-auto space-y-8">
        
        <header className="flex justify-between items-center mb-8">
            <div className="flex items-center space-x-4">
            <Github className="w-10 h-10" />
            <h1 className="text-3xl font-bold">Dev Dashboard</h1>
            </div>
            
            {/* Google Calendar Connect Button */}
            <div className="flex items-center space-x-2">
                 {isGoogleConnected ? (
                     <div className="flex items-center text-green-600 bg-green-50 px-3 py-1 rounded-full text-sm font-medium">
                         <Calendar className="w-4 h-4 mr-2" />
                         Calendar Connected
                     </div>
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
                {!slackLoading && slackMessages.length === 0 && (
                    <p className="text-gray-500 text-sm">No recent messages in #all-8090-hackathon.</p>
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
