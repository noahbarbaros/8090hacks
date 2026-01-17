"use client";

import { useState, useRef } from "react";
import { Users, CheckCircle2, XCircle, Send, Loader2, RefreshCw, MessageSquare, Calendar, Github, MessageCircle, Video, FileText, X, Copy, Check, Play, Pause, Volume2 } from "lucide-react";
import ChatSidebar from "@/components/ChatSidebar";

interface Member {
  slackUserId: string;
  name: string;
  hasCompletedRecap: boolean;
  integrations?: {
    slack: boolean;
    calendar: boolean;
    github: boolean;
  };
  githubInfo?: {
    owner: string | null;
    repo: string | null;
  } | null;
}

interface ScriptData {
  script: string;
  recapCount: number;
  date: string;
  participants: string[];
}

export default function AdminDashboard() {
  const [teamId, setTeamId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [searchByChannel, setSearchByChannel] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("Please complete your daily recap!");
  const [sendingNotification, setSendingNotification] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [sentNotifications, setSentNotifications] = useState<Set<string>>(new Set());
  const [sendingToAll, setSendingToAll] = useState(false);
  const [sendingStandUp, setSendingStandUp] = useState<string | null>(null);
  const [sendingStandUpToAll, setSendingStandUpToAll] = useState(false);
  const [sentStandUpLinks, setSentStandUpLinks] = useState<Set<string>>(new Set());
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Script generation state
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Audio playback state
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchMembers = async () => {
    if (searchByChannel && !channelId.trim()) {
      setError("Please enter a Channel ID");
      return;
    }
    if (!searchByChannel && !teamId.trim()) {
      setError("Please enter a Team ID");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const url = searchByChannel
        ? `/api/group-members?channel_id=${encodeURIComponent(channelId)}`
        : `/api/group-members?team_id=${encodeURIComponent(teamId)}`;
      const response = await fetch(url);
      
      // Check if response is actually JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Server returned non-JSON response. Please check your environment variables and ensure the API route is working. Status: ${response.status}`);
      }

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error || "Failed to fetch group members";
        const details = data.details ? ` (${data.details})` : "";
        throw new Error(errorMsg + details);
      }

      // Log debug info if available
      if (data.debug) {
        console.log("Debug info:", data.debug);
        if (data.members.length === 0 && data.debug.sampleTeamIds) {
          const uniqueTeamIds = [...new Set(data.debug.sampleTeamIds)];
          console.log("Available team_ids in database:", uniqueTeamIds);
          if (!searchByChannel) {
            // Show helpful message if team ID format is wrong
            if (teamId && teamId.startsWith('C')) {
              setError(`You entered a Channel ID (starts with C). Team IDs start with T. Available team IDs: ${uniqueTeamIds.join(', ')}`);
            } else if (teamId && !teamId.startsWith('T')) {
              setError(`Team IDs should start with "T". Available team IDs: ${uniqueTeamIds.join(', ')}`);
            } else {
              setError(`No members found for team ID "${teamId}". Available team IDs: ${uniqueTeamIds.join(', ')}`);
            }
          }
        }
      }
      
      if (data.warning) {
        console.warn("Warning:", data.warning);
      }

      setMembers(data.members || []);
      // Reset sent notifications when reloading
      setSentNotifications(new Set());
      setSentStandUpLinks(new Set());
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred";
      setError(errorMessage);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  const sendNotification = async (slackUserId: string, name: string) => {
    if (!notificationMessage.trim()) {
      setNotificationStatus({ type: "error", message: "Please enter a notification message" });
      setTimeout(() => setNotificationStatus(null), 3000);
      return;
    }

    setSendingNotification(slackUserId);
    setNotificationStatus(null);

    try {
      const response = await fetch("/api/send-notification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slackUserId,
          message: notificationMessage,
          teamId: searchByChannel ? null : teamId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send notification");
      }

      // Mark as sent
      setSentNotifications((prev) => new Set(prev).add(slackUserId));
      
      setNotificationStatus({
        type: "success",
        message: `Notification sent to ${name}!`,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send notification";
      setNotificationStatus({
        type: "error",
        message: errorMessage,
      });
    } finally {
      setSendingNotification(null);
      setTimeout(() => setNotificationStatus(null), 3000);
    }
  };

  const sendToAll = async () => {
    if (!notificationMessage.trim()) {
      setNotificationStatus({ type: "error", message: "Please enter a notification message" });
      setTimeout(() => setNotificationStatus(null), 3000);
      return;
    }

    const incompleteMembers = members.filter((m) => !m.hasCompletedRecap);
    if (incompleteMembers.length === 0) {
      setNotificationStatus({ type: "error", message: "All members have completed their recap!" });
      setTimeout(() => setNotificationStatus(null), 3000);
      return;
    }

    setSendingToAll(true);
    setNotificationStatus(null);

    let successCount = 0;
    let errorCount = 0;

    for (const member of incompleteMembers) {
      try {
        const response = await fetch("/api/send-notification", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            slackUserId: member.slackUserId,
            message: notificationMessage,
            teamId: searchByChannel ? null : teamId,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          successCount++;
          setSentNotifications((prev) => new Set(prev).add(member.slackUserId));
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    setNotificationStatus({
      type: successCount > 0 ? "success" : "error",
      message: `Sent ${successCount} notification(s)${errorCount > 0 ? `, ${errorCount} failed` : ""}`,
    });

    setSendingToAll(false);
    setTimeout(() => setNotificationStatus(null), 5000);
  };

  const getMeetPageUrl = () => {
    const baseUrl = window.location.origin;
    if (searchByChannel && channelId) {
      return `${baseUrl}/meet?channel_id=${encodeURIComponent(channelId)}`;
    } else if (teamId) {
      return `${baseUrl}/meet?team_id=${encodeURIComponent(teamId)}`;
    }
    return null;
  };

  // Generate standup script from daily recaps
  const generateStandupScript = async (): Promise<ScriptData | null> => {
    setGeneratingScript(true);
    // Reset audio state when generating new script
    setAudioUrl(null);
    setAudioError(null);
    setIsPlaying(false);
    
    try {
      const today = new Date().toISOString().split("T")[0];
      
      const response = await fetch("/api/generate-standup-script", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: searchByChannel ? null : teamId,
          channelId: searchByChannel ? channelId : null,
          date: today,
        }),
      });

      const data = await response.json();

      if (data.error && !data.script) {
        setNotificationStatus({ type: "error", message: data.error });
        setTimeout(() => setNotificationStatus(null), 5000);
        return null;
      }

      if (data.script) {
        setScriptData(data);
        return data;
      }
      
      return null;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to generate script";
      setNotificationStatus({ type: "error", message: errorMessage });
      setTimeout(() => setNotificationStatus(null), 5000);
      return null;
    } finally {
      setGeneratingScript(false);
    }
  };

  // Generate audio from script using ElevenLabs
  const generateAudio = async () => {
    if (!scriptData?.script) return;

    setGeneratingAudio(true);
    setAudioError(null);

    try {
      const response = await fetch("/api/generate-audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          script: scriptData.script,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate audio");
      }

      // Get audio blob
      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);

      // Auto-play the audio
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to generate audio";
      setAudioError(errorMessage);
    } finally {
      setGeneratingAudio(false);
    }
  };

  // Toggle audio play/pause
  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const sendStandUpLink = async (slackUserId: string, name: string) => {
    const meetUrl = getMeetPageUrl();
    if (!meetUrl) {
      setNotificationStatus({ type: "error", message: "Please enter a Team ID or Channel ID first" });
      setTimeout(() => setNotificationStatus(null), 3000);
      return;
    }

    setSendingStandUp(slackUserId);
    setNotificationStatus(null);

    try {
      // First, generate the standup script
      const script = await generateStandupScript();
      
      if (script) {
        // Show the script modal
        setShowScriptModal(true);
      }

      // Send the meet link to Slack
      const message = `🎥 Stand Up Meeting\n\nJoin the stand up meeting here: ${meetUrl}`;
      
      const response = await fetch("/api/send-notification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slackUserId,
          message,
          teamId: searchByChannel ? null : teamId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send stand up link");
      }

      // Mark as sent
      setSentStandUpLinks((prev) => new Set(prev).add(slackUserId));
      
      if (!script) {
        setNotificationStatus({
          type: "success",
          message: `Stand up link sent to ${name}! (No recaps found to generate script)`,
        });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send stand up link";
      setNotificationStatus({
        type: "error",
        message: errorMessage,
      });
    } finally {
      setSendingStandUp(null);
      if (!showScriptModal) {
        setTimeout(() => setNotificationStatus(null), 3000);
      }
    }
  };

  const sendStandUpLinkToAll = async () => {
    const meetUrl = getMeetPageUrl();
    if (!meetUrl) {
      setNotificationStatus({ type: "error", message: "Please enter a Team ID or Channel ID first" });
      setTimeout(() => setNotificationStatus(null), 3000);
      return;
    }

    if (members.length === 0) {
      setNotificationStatus({ type: "error", message: "No members to send to" });
      setTimeout(() => setNotificationStatus(null), 3000);
      return;
    }

    setSendingStandUpToAll(true);
    setNotificationStatus(null);

    // First, generate the standup script
    const script = await generateStandupScript();
    
    if (script) {
      // Show the script modal
      setShowScriptModal(true);
    }

    let successCount = 0;
    let errorCount = 0;

    const message = `🎥 Stand Up Meeting\n\nJoin the stand up meeting here: ${meetUrl}`;

    for (const member of members) {
      try {
        const response = await fetch("/api/send-notification", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            slackUserId: member.slackUserId,
            message,
            teamId: searchByChannel ? null : teamId,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          successCount++;
          setSentStandUpLinks((prev) => new Set(prev).add(member.slackUserId));
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    if (!script) {
      setNotificationStatus({
        type: successCount > 0 ? "success" : "error",
        message: `Sent stand up link to ${successCount} member(s)${errorCount > 0 ? `, ${errorCount} failed` : ""} (No recaps found to generate script)`,
      });
    }

    setSendingStandUpToAll(false);
    if (!showScriptModal) {
      setTimeout(() => setNotificationStatus(null), 5000);
    }
  };

  const copyToClipboard = async () => {
    if (scriptData?.script) {
      await navigator.clipboard.writeText(scriptData.script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Cleanup audio URL when modal closes
  const handleCloseModal = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setShowScriptModal(false);
    setAudioUrl(null);
    setIsPlaying(false);
    setAudioError(null);
  };

  const completedCount = members.filter((m) => m.hasCompletedRecap).length;
  const totalCount = members.length;
  const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-black">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <Users className="w-10 h-10 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
              <p className="text-gray-600 mt-1">Manage team daily recaps</p>
            </div>
          </div>
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            aria-label="Toggle chat assistant"
          >
            <MessageSquare className="w-5 h-5" />
            <span>Ask Assistant</span>
          </button>
        </header>

        {/* Team/Channel ID Input */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">Team Configuration</h2>
          
          {/* Toggle between Channel and Team ID */}
          <div className="mb-4 flex gap-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                checked={searchByChannel}
                onChange={() => setSearchByChannel(true)}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm font-medium">Search by Channel ID</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                checked={!searchByChannel}
                onChange={() => setSearchByChannel(false)}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm font-medium">Search by Team ID</span>
            </label>
          </div>

          <div className="flex gap-4 items-end">
            <div className="flex-grow">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                {searchByChannel ? "Slack Channel ID" : "Slack Team ID"}
              </label>
              {searchByChannel ? (
                <input
                  type="text"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  placeholder="Enter your Slack Channel ID (starts with C...)"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              ) : (
                <input
                  type="text"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  placeholder="Enter your Slack Team ID (starts with T...)"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              )}
              <p className="text-xs text-gray-500 mt-1">
                {searchByChannel 
                  ? "Channel ID starts with 'C' (e.g., C0A9QRDR465)"
                  : "Team ID starts with 'T' (e.g., T0A9QRC2Q1X)"}
              </p>
            </div>
            <button
              onClick={fetchMembers}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2 whitespace-nowrap"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  <span>Load Members</span>
                </>
              )}
            </button>
          </div>
          {error && <p className="text-red-500 mt-3 text-sm">{error}</p>}
        </div>

        {/* Stats */}
        {members.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Members</p>
                  <p className="text-3xl font-bold mt-2">{totalCount}</p>
                </div>
                <Users className="w-12 h-12 text-blue-500 opacity-50" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Completed Today</p>
                  <p className="text-3xl font-bold mt-2 text-green-600">
                    {completedCount}
                  </p>
                </div>
                <CheckCircle2 className="w-12 h-12 text-green-500 opacity-50" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Completion Rate</p>
                  <p className="text-3xl font-bold mt-2">{completionRate}%</p>
                </div>
                <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-full">
                  <span className="text-blue-600 font-bold text-lg">
                    {completionRate}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notification Message Input */}
        {members.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 flex items-center space-x-2">
              <MessageSquare className="w-6 h-6" />
              <span>Notification Message</span>
            </h2>
            <textarea
              value={notificationMessage}
              onChange={(e) => setNotificationMessage(e.target.value)}
              placeholder="Enter the message to send when requesting daily recap completion"
              rows={3}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
            <p className="text-sm text-gray-500 mt-2">
              This message will be sent as a Slack DM to selected members.
            </p>
            {notificationStatus && (
              <div
                className={`mt-3 px-4 py-2 rounded-lg text-sm ${
                  notificationStatus.type === "success"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {notificationStatus.message}
              </div>
            )}
          </div>
        )}

        {/* Members List */}
        {members.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Team Members</h2>
              <div className="flex items-center space-x-3">
                <button
                  onClick={sendStandUpLinkToAll}
                  disabled={sendingStandUpToAll || generatingScript || (!teamId && !channelId)}
                  className="flex items-center space-x-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {sendingStandUpToAll || generatingScript ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{generatingScript ? "Generating Script..." : "Sending Stand Up..."}</span>
                    </>
                  ) : (
                    <>
                      <Video className="w-4 h-4" />
                      <span>Send Stand Up to All</span>
                    </>
                  )}
                </button>
                {members.some((m) => !m.hasCompletedRecap) && (
                  <button
                    onClick={sendToAll}
                    disabled={sendingToAll}
                    className="flex items-center space-x-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {sendingToAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sending to All...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Send to All</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={fetchMembers}
                  disabled={loading}
                  className="flex items-center space-x-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  <span>Reload Status</span>
                </button>
              </div>
            </div>
            <div className="space-y-4">
              {members.map((member) => (
                <div
                  key={member.slackUserId}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-4 flex-grow">
                    <div className="flex-shrink-0">
                      {member.hasCompletedRecap ? (
                        <CheckCircle2 className="w-6 h-6 text-green-500" />
                      ) : (
                        <XCircle className="w-6 h-6 text-red-500" />
                      )}
                    </div>
                    <div className="flex-grow">
                      <p className="font-medium text-gray-900">{member.name}</p>
                      <div className="flex items-center space-x-3 mt-1">
                        <p className="text-sm text-gray-500">
                          {member.hasCompletedRecap
                            ? "Daily recap completed"
                            : "Daily recap pending"}
                        </p>
                        {member.integrations && (
                          <div className="flex items-center space-x-2">
                            {member.integrations.slack && (
                              <div className="flex items-center space-x-1" title="Slack connected">
                                <MessageCircle className="w-4 h-4 text-purple-500" />
                              </div>
                            )}
                            {member.integrations.calendar && (
                              <div className="flex items-center space-x-1" title="Google Calendar connected">
                                <Calendar className="w-4 h-4 text-blue-500" />
                              </div>
                            )}
                            {member.integrations.github && (
                              <div className="flex items-center space-x-1" title={`GitHub connected${member.githubInfo?.owner ? ` (${member.githubInfo.owner}${member.githubInfo.repo ? `/${member.githubInfo.repo}` : ''})` : ''}`}>
                                <Github className="w-4 h-4 text-gray-800" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {sentStandUpLinks.has(member.slackUserId) ? (
                      <div className="flex items-center space-x-2 text-green-600 font-medium whitespace-nowrap px-3 py-2">
                        <Video className="w-4 h-4" />
                        <span className="text-xs">Stand Up Sent</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => sendStandUpLink(member.slackUserId, member.name)}
                        disabled={sendingStandUp === member.slackUserId || sendingStandUpToAll || generatingScript || (!teamId && !channelId)}
                        className="flex items-center space-x-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        title="Generate script and send stand up meeting link"
                      >
                        {sendingStandUp === member.slackUserId ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{generatingScript ? "Generating..." : "Sending..."}</span>
                          </>
                        ) : (
                          <>
                            <Video className="w-4 h-4" />
                            <span>Send Stand Up</span>
                          </>
                        )}
                      </button>
                    )}
                    {member.hasCompletedRecap ? (
                      <div className="flex items-center space-x-2 text-green-600 font-medium whitespace-nowrap px-3 py-2">
                        <CheckCircle2 className="w-5 h-5" />
                        <span>Recap completed</span>
                      </div>
                    ) : sentNotifications.has(member.slackUserId) ? (
                      <div className="flex items-center space-x-2 text-blue-600 font-medium whitespace-nowrap px-3 py-2">
                        <CheckCircle2 className="w-5 h-5" />
                        <span>Notification sent</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => sendNotification(member.slackUserId, member.name)}
                        disabled={sendingNotification === member.slackUserId || sendingToAll}
                        className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {sendingNotification === member.slackUserId ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Sending...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            <span>Send Notification</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {members.length === 0 && !loading && teamId && (
          <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">
              No members found for this team. Make sure the Team ID is correct.
            </p>
          </div>
        )}

        {/* Initial State */}
        {members.length === 0 && !loading && !teamId && (
          <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">
              Enter a Team ID above to load team members and their daily recap status.
            </p>
          </div>
        )}
      </div>

      {/* Chat Sidebar */}
      <ChatSidebar
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        teamId={searchByChannel ? undefined : teamId}
        channelId={searchByChannel ? channelId : undefined}
      />

      {/* Script Modal */}
      {showScriptModal && scriptData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-gray-900 font-semibold text-lg">Standup Meeting Script</h2>
                  <p className="text-gray-500 text-sm">
                    {scriptData.date} • {scriptData.recapCount} recap{scriptData.recapCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Participants badges */}
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500 mb-2 font-medium">PARTICIPANTS</p>
              <div className="flex flex-wrap gap-2">
                {scriptData.participants.map((name, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-white border border-gray-200 text-gray-700 rounded-full text-xs font-medium shadow-sm"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>

            {/* Audio Player Section */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-violet-50 to-purple-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Volume2 className="w-5 h-5 text-violet-600" />
                  <span className="text-sm font-medium text-gray-700">Audio Playback</span>
                </div>
                <div className="flex items-center gap-2">
                  {audioError && (
                    <span className="text-xs text-red-500 mr-2">{audioError}</span>
                  )}
                  {!audioUrl ? (
                    <button
                      onClick={generateAudio}
                      disabled={generatingAudio}
                      className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
                    >
                      {generatingAudio ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Generating Audio...</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4" />
                          <span>Generate & Play Audio</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={togglePlayPause}
                      className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-4 h-4" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {isPlaying && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-violet-200 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-600 rounded-full animate-pulse" style={{ width: '30%' }}></div>
                  </div>
                  <span className="text-xs text-violet-600 font-medium">Playing...</span>
                </div>
              )}
            </div>

            {/* Script Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="text-gray-700 whitespace-pre-wrap leading-relaxed text-[15px]">
                {scriptData.script}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center bg-gray-50">
              <p className="text-xs text-gray-500">
                Stand up link has been sent to team members via Slack
              </p>
              <div className="flex gap-3">
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg font-medium text-sm transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-green-500" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy Script</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleCloseModal}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
