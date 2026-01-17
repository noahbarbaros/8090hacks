"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Users, Volume2, Play, Pause, SkipForward, Settings, User, MessageSquare } from "lucide-react";
import ChatSidebar from "../../components/ChatSidebar";

// ElevenLabs voice options
const VOICES = {
  female: [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "Warm & professional" },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Soft & gentle" },
    { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", description: "Young & bubbly" },
    { id: "jsCqWAovK2LkecY7zXl4", name: "Freya", description: "Confident & clear" },
  ],
  male: [
    { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Deep & authoritative" },
    { id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "Warm & friendly" },
    { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", description: "Young & energetic" },
    { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", description: "Strong & confident" },
  ],
};

interface Participant {
  oduserId: string;
  name: string;
  profileImage: string | null;
  voiceType?: "male" | "female";
  voiceId?: string;
}

interface Segment {
  oduserId: string;
  name: string;
  script: string;
  order: number;
  audioUrl?: string;
  voiceId?: string;
}

export default function MeetPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);

  // Voice setup state
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);
  const [voiceAssignments, setVoiceAssignments] = useState<Record<string, { type: "male" | "female"; voiceId: string }>>({});

  // Audio state
  const [generatingScript, setGeneratingScript] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [autoplayTriggered, setAutoplayTriggered] = useState(false);
  const [currentAudioProgress, setCurrentAudioProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Chat sidebar state
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Get current speaker's userId
  const currentSpeakerId = currentSegmentIndex >= 0 && segments[currentSegmentIndex] 
    ? segments[currentSegmentIndex].oduserId 
    : null;

  useEffect(() => {
    // Get team_id or channel_id from URL params
    const params = new URLSearchParams(window.location.search);
    const teamIdParam = params.get("team_id");
    const channelIdParam = params.get("channel_id");
    const autoplay = params.get("autoplay") === "true";

    setTeamId(teamIdParam);
    setChannelId(channelIdParam);

    if (!teamIdParam && !channelIdParam) {
      setError("Please provide team_id or channel_id in the URL");
      setLoading(false);
      return;
    }

    const fetchParticipants = async () => {
      try {
        const url = channelIdParam
          ? `/api/meet-participants?channel_id=${encodeURIComponent(channelIdParam)}`
          : `/api/meet-participants?team_id=${encodeURIComponent(teamIdParam!)}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch participants");
        }

        // Map participants to include oduserId
        const participantsWithId = (data.participants || []).map((p: { slackUserId: string; name: string; profileImage: string | null }) => ({
          oduserId: p.slackUserId,
          name: p.name,
          profileImage: p.profileImage,
        }));

        setParticipants(participantsWithId);
        
        // Initialize voice assignments with defaults (alternate male/female)
        const initialAssignments: Record<string, { type: "male" | "female"; voiceId: string }> = {};
        participantsWithId.forEach((p: Participant, i: number) => {
          // Try to guess gender from name (basic heuristic) or alternate
          const isFemale = i % 2 === 1; // Simple alternating pattern as default
          const type = isFemale ? "female" : "male";
          const voices = VOICES[type];
          const voiceId = voices[i % voices.length].id;
          initialAssignments[p.oduserId] = { type, voiceId };
        });
        setVoiceAssignments(initialAssignments);
        
        // If autoplay is enabled, show voice setup first
        if (autoplay && !autoplayTriggered) {
          setAutoplayTriggered(true);
          setShowVoiceSetup(true);
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "An error occurred";
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchParticipants();
  }, [autoplayTriggered]);

  // Update voice assignment for a participant
  const updateVoiceAssignment = (userId: string, type: "male" | "female", voiceId?: string) => {
    const voices = VOICES[type];
    const newVoiceId = voiceId || voices[0].id;
    setVoiceAssignments(prev => ({
      ...prev,
      [userId]: { type, voiceId: newVoiceId }
    }));
  };

  // Generate script segments and audio for each person
  const startStandup = async (channelIdParam?: string | null, teamIdParam?: string | null) => {
    const cId = channelIdParam || channelId;
    const tId = teamIdParam || teamId;

    setShowVoiceSetup(false);
    setGeneratingScript(true);
    setAudioError(null);
    setSegments([]);
    setCurrentSegmentIndex(-1);

    try {
      // Step 1: Generate the scripts for each person
      const today = new Date().toISOString().split("T")[0];
      const scriptResponse = await fetch("/api/generate-standup-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: tId,
          channelId: cId,
          date: today,
        }),
      });

      const scriptData = await scriptResponse.json();

      if (scriptData.error && !scriptData.segments) {
        throw new Error(scriptData.error);
      }

      if (!scriptData.segments || scriptData.segments.length === 0) {
        throw new Error("No recaps found for today");
      }

      const scriptSegments: Segment[] = scriptData.segments;
      setSegments(scriptSegments);
      setGeneratingScript(false);
      setGeneratingAudio(true);

      // Step 2: Generate audio for each segment with assigned voice
      const segmentsWithAudio: Segment[] = [];
      
      for (let i = 0; i < scriptSegments.length; i++) {
        const segment = scriptSegments[i];
        const voiceAssignment = voiceAssignments[segment.oduserId];
        const voiceId = voiceAssignment?.voiceId || VOICES.male[0].id;
        
        try {
          const audioResponse = await fetch("/api/generate-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              script: segment.script,
              voiceId: voiceId 
            }),
          });

          if (!audioResponse.ok) {
            const errorData = await audioResponse.json().catch(() => ({}));
            console.error(`Failed to generate audio for ${segment.name}:`, errorData.error);
            segmentsWithAudio.push({ ...segment, voiceId });
            continue;
          }

          const audioBlob = await audioResponse.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          
          segmentsWithAudio.push({
            ...segment,
            audioUrl,
            voiceId,
          });

          // Update segments as we go so UI can show progress
          setSegments([...segmentsWithAudio, ...scriptSegments.slice(i + 1)]);
        } catch (audioErr) {
          console.error(`Error generating audio for ${segment.name}:`, audioErr);
          segmentsWithAudio.push({ ...segment, voiceId });
        }
      }

      setSegments(segmentsWithAudio);
      setGeneratingAudio(false);

      // Step 3: Start playing from the first segment
      if (segmentsWithAudio.length > 0 && segmentsWithAudio[0].audioUrl) {
        playSegment(0, segmentsWithAudio);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to start standup";
      setAudioError(errorMessage);
      setGeneratingScript(false);
      setGeneratingAudio(false);
    }
  };

  // Play a specific segment
  const playSegment = (index: number, segs?: Segment[]) => {
    const segmentsToUse = segs || segments;
    if (index < 0 || index >= segmentsToUse.length) return;
    
    const segment = segmentsToUse[index];
    if (!segment.audioUrl) {
      // Skip to next segment if no audio
      if (index < segmentsToUse.length - 1) {
        playSegment(index + 1, segmentsToUse);
      }
      return;
    }

    setCurrentSegmentIndex(index);
    
    if (audioRef.current) {
      audioRef.current.src = segment.audioUrl;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  // Handle audio ended - play next segment
  const handleAudioEnded = () => {
    setIsPlaying(false);
    
    // Play next segment if available
    if (currentSegmentIndex < segments.length - 1) {
      setTimeout(() => {
        playSegment(currentSegmentIndex + 1);
      }, 500); // Small pause between speakers
    } else {
      // All segments done
      setCurrentSegmentIndex(-1);
    }
  };

  // Toggle play/pause
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

  // Skip to next speaker
  const skipToNext = () => {
    if (currentSegmentIndex < segments.length - 1) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      playSegment(currentSegmentIndex + 1);
    }
  };

  // Track audio progress
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const progress = (audioRef.current.currentTime / audioRef.current.duration) * 100;
      setCurrentAudioProgress(progress || 0);
    }
  };

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

  // Get voice name for a user
  const getVoiceName = (userId: string) => {
    const assignment = voiceAssignments[userId];
    if (!assignment) return "Unknown";
    const voices = VOICES[assignment.type];
    const voice = voices.find(v => v.id === assignment.voiceId);
    return voice?.name || "Unknown";
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

  const currentSpeaker = currentSegmentIndex >= 0 ? segments[currentSegmentIndex] : null;

  // Voice Setup Modal
  if (showVoiceSetup) {
    return (
      <div className="h-screen bg-[#202124] flex items-center justify-center p-4">
        <div className="bg-[#2d2d30] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Voice Setup
            </h2>
            <p className="text-violet-200 text-sm mt-1">
              Assign voices to each team member before starting the standup
            </p>
          </div>
          
          {/* Participant list */}
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {participants.map((participant) => {
              const assignment = voiceAssignments[participant.oduserId] || { type: "male", voiceId: VOICES.male[0].id };
              const voices = VOICES[assignment.type];
              
              return (
                <div key={participant.oduserId} className="bg-[#1a1a1a] rounded-xl p-4">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="relative">
                      {participant.profileImage ? (
                        <img 
                          src={participant.profileImage} 
                          alt={participant.name}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                          <span className="text-white font-semibold">
                            {participant.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* Name */}
                    <div className="flex-1">
                      <p className="text-white font-medium">{participant.name}</p>
                      <p className="text-gray-400 text-sm">
                        Voice: {getVoiceName(participant.oduserId)}
                      </p>
                    </div>
                    
                    {/* Voice type toggle */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateVoiceAssignment(participant.oduserId, "male")}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                          assignment.type === "male"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                        }`}
                      >
                        👨 Male
                      </button>
                      <button
                        onClick={() => updateVoiceAssignment(participant.oduserId, "female")}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                          assignment.type === "female"
                            ? "bg-pink-600 text-white"
                            : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                        }`}
                      >
                        👩 Female
                      </button>
                    </div>
                  </div>
                  
                  {/* Voice selection */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {voices.map((voice) => (
                      <button
                        key={voice.id}
                        onClick={() => updateVoiceAssignment(participant.oduserId, assignment.type, voice.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          assignment.voiceId === voice.id
                            ? assignment.type === "male" 
                              ? "bg-blue-600/20 text-blue-400 ring-1 ring-blue-500" 
                              : "bg-pink-600/20 text-pink-400 ring-1 ring-pink-500"
                            : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        }`}
                      >
                        {voice.name}
                        <span className="text-gray-500 ml-1">({voice.description})</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Actions */}
          <div className="p-6 border-t border-gray-700 flex justify-end gap-3">
            <button
              onClick={() => setShowVoiceSetup(false)}
              className="px-4 py-2 rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => startStandup()}
              className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white font-medium transition-all flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Start Standup
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#202124] overflow-hidden relative">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={handleTimeUpdate}
      />

      {/* Main video grid */}
      <div className="h-full flex items-center justify-center p-2 sm:p-4 pb-32">
        <div
          className={`grid ${getGridCols(participants.length)} gap-2 sm:gap-3 w-full h-full`}
          style={{
            aspectRatio: participants.length === 1 ? "16/9" : "auto",
          }}
        >
          {participants.map((participant) => {
            const isSpeaking = participant.oduserId === currentSpeakerId;
            const voiceAssignment = voiceAssignments[participant.oduserId];
            
            return (
              <div
                key={participant.oduserId}
                className={`relative bg-[#1a1a1a] rounded-lg overflow-hidden flex items-center justify-center transition-all duration-300 ${
                  isSpeaking 
                    ? "ring-4 ring-green-500 shadow-lg shadow-green-500/30 scale-[1.02]" 
                    : "hover:ring-2 hover:ring-blue-500"
                }`}
              >
                {/* Profile Image or Initials */}
                {participant.profileImage ? (
                  <img
                    src={participant.profileImage}
                    alt={participant.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
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
                
                {/* Initials fallback */}
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

                {/* Speaking indicator - animated glow */}
                {isSpeaking && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-0 bg-green-500/10 animate-pulse"></div>
                    <div className="absolute top-3 right-3 flex items-center gap-2 bg-green-500 text-white px-2 py-1 rounded-full text-xs font-medium">
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                      Speaking
                    </div>
                  </div>
                )}

                {/* Name label overlay */}
                <div className={`absolute bottom-0 left-0 right-0 px-3 py-2 ${
                  isSpeaking 
                    ? "bg-gradient-to-t from-green-900/90 via-green-900/50 to-transparent" 
                    : "bg-gradient-to-t from-black/80 via-black/40 to-transparent"
                }`}>
                  <p className={`text-xs sm:text-sm font-medium truncate drop-shadow-lg ${
                    isSpeaking ? "text-green-100" : "text-white"
                  }`}>
                    {participant.name}
                  </p>
                  {voiceAssignment && (
                    <p className="text-[10px] text-gray-400 truncate">
                      {voiceAssignment.type === "female" ? "👩" : "👨"} {getVoiceName(participant.oduserId)}
                    </p>
                  )}
                </div>

                {/* Status indicator */}
                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded-full p-1.5 flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${
                    isSpeaking ? "bg-green-500 animate-pulse" : "bg-gray-500"
                  }`}></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom controls bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#1a1a1a] border-t border-gray-800/50 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto">
          {/* Current speaker info */}
          {currentSpeaker && (
            <div className="text-center mb-3">
              <span className="text-green-400 text-sm font-medium">
                🎤 {currentSpeaker.name} is speaking
              </span>
              <span className="text-gray-500 text-sm ml-2">
                ({currentSegmentIndex + 1} of {segments.length})
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            {/* Status indicator */}
            <div className="flex items-center space-x-2 text-gray-400 text-xs sm:text-sm font-medium w-32">
              <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
              <span>{isPlaying ? 'Live' : 'Ready'}</span>
            </div>

            {/* Audio controls */}
            <div className="flex items-center gap-3">
              {audioError && (
                <span className="text-red-400 text-xs mr-2">{audioError}</span>
              )}
              
              {generatingScript || generatingAudio ? (
                <div className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-full font-medium text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {generatingScript 
                      ? "Generating scripts..." 
                      : `Generating audio (${segments.filter(s => s.audioUrl).length}/${segments.length})...`
                    }
                  </span>
                </div>
              ) : segments.length === 0 ? (
                <button
                  onClick={() => setShowVoiceSetup(true)}
                  className="flex items-center gap-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white px-5 py-2.5 rounded-full font-medium text-sm transition-all shadow-lg"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Setup & Start</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={togglePlayPause}
                    className="flex items-center gap-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white px-4 py-2 rounded-full font-medium text-sm transition-all shadow-lg"
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
                  
                  {currentSegmentIndex < segments.length - 1 && (
                    <button
                      onClick={skipToNext}
                      className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-full font-medium text-sm transition-all"
                    >
                      <SkipForward className="w-4 h-4" />
                      <span>Next</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Voice setup & Chat buttons */}
            <div className="w-32 flex justify-end gap-2">
              {segments.length === 0 && (
                <button
                  onClick={() => setShowVoiceSetup(true)}
                  className="text-gray-400 hover:text-white transition-colors p-2"
                  title="Voice Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setIsChatOpen(true)}
                className="text-gray-400 hover:text-white transition-colors p-2 relative"
                title="Ask the Recap Assistant"
              >
                <MessageSquare className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Audio progress bar */}
          {isPlaying && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-200" 
                  style={{ width: `${currentAudioProgress}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat Sidebar */}
      <ChatSidebar
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        teamId={teamId || undefined}
        channelId={channelId || undefined}
      />
    </div>
  );
}
