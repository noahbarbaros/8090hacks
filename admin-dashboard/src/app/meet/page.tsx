"use client";

import { useState, useEffect } from "react";
import { Loader2, Users } from "lucide-react";

interface Participant {
  slackUserId: string;
  name: string;
  profileImage: string | null;
}

export default function MeetPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // Get team_id or channel_id from URL params
    const params = new URLSearchParams(window.location.search);
    const teamId = params.get("team_id");
    const channelId = params.get("channel_id");

    if (!teamId && !channelId) {
      setError("Please provide team_id or channel_id in the URL");
      setLoading(false);
      return;
    }

    const fetchParticipants = async () => {
      try {
        const url = channelId
          ? `/api/meet-participants?channel_id=${encodeURIComponent(channelId)}`
          : `/api/meet-participants?team_id=${encodeURIComponent(teamId!)}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch participants");
        }

        setParticipants(data.participants || []);
      } catch (err: any) {
        setError(err.message || "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchParticipants();
  }, []);

  // Calculate grid layout based on number of participants (Google Meet style)
  const getGridCols = (count: number) => {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 9) return "grid-cols-3";
    if (count <= 16) return "grid-cols-4";
    if (count <= 25) return "grid-cols-5";
    return "grid-cols-6";
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading participants...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">Error</p>
          <p className="text-gray-300">{error}</p>
          <p className="text-gray-400 text-sm mt-4">
            Add ?team_id=T... or ?channel_id=C... to the URL
          </p>
        </div>
      </div>
    );
  }

  if (participants.length === 0) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-300 text-lg">No participants found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#202124] overflow-hidden relative">
      {/* Main video grid */}
      <div className="h-full flex items-center justify-center p-2 sm:p-4">
        <div
          className={`grid ${getGridCols(participants.length)} gap-1 sm:gap-2 w-full h-full`}
          style={{
            aspectRatio: participants.length === 1 ? "16/9" : "auto",
          }}
        >
          {participants.map((participant) => (
            <div
              key={participant.slackUserId}
              className="relative bg-[#1a1a1a] rounded overflow-hidden flex items-center justify-center group hover:ring-2 hover:ring-blue-500 transition-all"
            >
              {/* Profile Image or Initials */}
              {participant.profileImage ? (
                <img
                  src={participant.profileImage}
                  alt={participant.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback to initials if image fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                    const parent = target.parentElement;
                    if (parent) {
                      const fallback = parent.querySelector(".initials-fallback") as HTMLElement;
                      if (fallback) fallback.style.display = "flex";
                    }
                  }}
                />
              ) : null}
              
              {/* Initials fallback (shown if no image or image fails) */}
              <div
                className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 ${
                  participant.profileImage ? "hidden initials-fallback" : ""
                }`}
              >
                <span className="text-white text-2xl sm:text-4xl font-semibold">
                  {participant.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)}
                </span>
              </div>

              {/* Name label overlay (Google Meet style) */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2">
                <p className="text-white text-xs sm:text-sm font-medium truncate drop-shadow-lg">
                  {participant.name}
                </p>
              </div>

              {/* Status indicator (green dot for active) */}
              <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded-full p-1.5 flex items-center gap-1.5">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom controls bar (Google Meet style) */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#1a1a1a] border-t border-gray-800/50 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-center">
          {/* Placeholder for future controls - timer, play/pause, etc. */}
          <div className="flex items-center space-x-2 text-gray-400 text-xs sm:text-sm font-medium">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-1"></div>
            <span>Recording</span>
            <span className="mx-2">•</span>
            <span>00:00</span>
          </div>
        </div>
      </div>
    </div>
  );
}

