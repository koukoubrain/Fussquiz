"use client";

import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import { signInPlayer } from "./lib/playerAuth";
import { QRCodeSVG } from "qrcode.react";

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Game Session States
  const [player, setPlayer] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<any>(null);
  const [playerAnswers, setPlayerAnswers] = useState<any[]>([]);
  const [myAnswer, setMyAnswer] = useState("");
  const [hasFinishedQuestion, setHasFinishedQuestion] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  // Multi-part sequential active state for player
  const [currentStep, setCurrentStep] = useState(0);
  const [mistakesCount, setMistakesCount] = useState(0);
  const [stepMessage, setStepMessage] = useState("");
  const [accumulatedAnswers, setAccumulatedAnswers] = useState<string[]>([]);

  // Modal state for full-screen photo viewing
  const [modalImage, setModalImage] = useState<string | null>(null);

  // Generate random room code
  function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "QB";
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomCode(code);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const cleanNickname = nickname.trim();
    const cleanRoomCode = roomCode.trim().toUpperCase();

    if (!cleanNickname || !cleanRoomCode) {
      setError("Please enter your nickname and room code.");
      return;
    }

    setLoading(true);

    try {
      const user = await signInPlayer();
      if (!user) throw new Error("Authentication failed.");

      let targetRoom = null;

      if (isCreatingRoom) {
        const { data: newRoomData, error: roomCreateError } = await supabase
          .from("rooms")
          .insert({ room_code: cleanRoomCode, game_status: "lobby" })
          .select()
          .single();

        if (roomCreateError) {
          if (roomCreateError.code === "23505") {
            throw new Error("This room code already exists. Try another or join it.");
          }
          throw roomCreateError;
        }
        targetRoom = newRoomData;
      } else {
        const { data: roomData, error: roomError } = await supabase
          .from("rooms")
          .select("*")
          .eq("room_code", cleanRoomCode)
          .single();

        if (roomError || !roomData) {
          throw new Error("Room not found. Check your room code or create a new room.");
        }
        targetRoom = roomData;
      }

      let makeAdmin = isCreatingRoom;
      if (!isCreatingRoom) {
        const { data: existingPlayer } = await supabase
          .from("players")
          .select("is_admin")
          .eq("room_id", targetRoom.id)
          .eq("auth_user_id", user.id)
          .maybeSingle();
        if (existingPlayer?.is_admin) makeAdmin = true;
      }

      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .upsert(
          {
            room_id: targetRoom.id,
            nickname: cleanNickname,
            auth_user_id: user.id,
            is_admin: makeAdmin,
          },
          { onConflict: "room_id,auth_user_id" }
        )
        .select()
        .single();

      if (playerError) throw playerError;

      setPlayer(playerData);
      setRoom(targetRoom);
      loadGameData(targetRoom.id);
    } catch (err: any) {
      console.error("AUTH/ROOM ERROR:", err);
      setError(err?.message || "Σφάλμα σύνδεσης.");
    } finally {
      setLoading(false);
    }
  }

  async function loadGameData(roomId: string) {
    const { data: qData } = await supabase.from("questions").select("*");
    if (qData) setQuestions(qData);
    fetchLeaderboard(roomId);
    fetchRoomStatus(roomId, qData || []);
  }

  async function fetchLeaderboard(roomId: string) {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("score", { ascending: false });
    if (data) setLeaderboard(data);
  }

  async function fetchRoomStatus(roomId: string, currentQuestions: any[]) {
    const { data } = await supabase
      .from("rooms")
      .select("active_question_id")
      .eq("id", roomId)
      .single();
    
    if (data?.active_question_id) {
      const q = currentQuestions.find((item) => item.id === data.active_question_id);
      if (q) setActiveQuestion(q);
    }
  }

  async function selectQuestion(question: any) {
    const { error } = await supabase
      .from("rooms")
      .update({ active_question_id: question.id, game_status: "answering" })
      .eq("id", room.id);

    if (!error) {
      setActiveQuestion(question);
      setHasFinishedQuestion(false);
      setMyAnswer("");
      setCurrentStep(0);
      setMistakesCount(0);
      setStepMessage("");
      setAccumulatedAnswers([]);
      setPlayerAnswers([]);
    }
  }

  async function closeQuestion() {
    await supabase
      .from("rooms")
      .update({ active_question_id: null, game_status: "lobby" })
      .eq("id", room.id);

    setActiveQuestion(null);
  }

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!myAnswer.trim()) return;

    if (activeQuestion.is_multi_part) {
      const newAccumulated = [...accumulatedAnswers, myAnswer.trim()];
      setAccumulatedAnswers(newAccumulated);
      setMyAnswer("");

      await supabase.from("player_answers").upsert({
        room_id: room.id,
        player_id: player.id,
        question_id: activeQuestion.id,
        answer_text: newAccumulated.join(" → "),
        current_step: currentStep,
        mistakes_count: mistakesCount,
        status: "pending",
      }, { onConflict: "room_id,player_id,question_id" });

      setStepMessage(`Part ${currentStep + 1} submitted. Waiting for referee assessment...`);
    } else {
      const { error } = await supabase.from("player_answers").insert({
        room_id: room.id,
        player_id: player.id,
        question_id: activeQuestion.id,
        answer_text: myAnswer.trim(),
        status: "pending",
      });

      if (!error) {
        setHasFinishedQuestion(true);
      }
    }
  }

  async function gradeStepOrAnswer(answerId: string, playerId: string, isCorrect: boolean, finalAwardPoints: number) {
    const targetAns = playerAnswers.find((a) => a.id === answerId);
    
    if (activeQuestion.is_multi_part) {
      const partsCount = activeQuestion.parts ? (Array.isArray(activeQuestion.parts) ? activeQuestion.parts.length : 2) : 2;
      
      if (isCorrect) {
        const nextStep = currentStep + 1;
        if (nextStep >= partsCount) {
          await supabase.from("player_answers").update({
            status: "accepted",
            awarded_points: finalAwardPoints,
            step_status: "passed"
          }).eq("id", answerId);

          updatePlayerScore(playerId, finalAwardPoints);
        } else {
          setCurrentStep(nextStep);
          setStepMessage("Right answer! Continue to the next step.");
        }
      } else {
        const newMistakes = (targetAns?.mistakes_count || 0) + 1;
        if (newMistakes >= 2) {
          await supabase.from("player_answers").update({
            status: "rejected",
            awarded_points: finalAwardPoints,
            mistakes_count: newMistakes,
            step_status: "failed"
          }).eq("id", answerId);

          updatePlayerScore(playerId, finalAwardPoints);
        } else {
          setMistakesCount(newMistakes);
          await supabase.from("player_answers").update({
            mistakes_count: newMistakes,
            step_status: "retry"
          }).eq("id", answerId);
          setStepMessage("Wrong answer! You have a 2nd chance to try this step again.");
        }
      }
    } else {
      await supabase.from("player_answers").update({
        status: isCorrect ? "accepted" : "rejected",
        awarded_points: finalAwardPoints,
      }).eq("id", answerId);

      updatePlayerScore(playerId, finalAwardPoints);
    }
  }

  async function updatePlayerScore(playerId: string, points: number) {
    const targetPlayer = leaderboard.find((p) => p.id === playerId);
    if (targetPlayer) {
      const newScore = (targetPlayer.score || 0) + points;
      await supabase.from("players").update({ score: newScore }).eq("id", playerId);
      fetchLeaderboard(room.id);
    }
  }

  useEffect(() => {
    if (!room) return;

    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload: any) => {
          const newActiveId = payload.new.active_question_id;
          if (!newActiveId) {
            setActiveQuestion(null);
          } else {
            const foundQ = questions.find((q) => q.id === newActiveId);
            if (foundQ) setActiveQuestion(foundQ);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_answers", filter: `room_id=eq.${room.id}` },
        async () => {
          if (activeQuestion) {
            const { data } = await supabase
              .from("player_answers")
              .select("*, players(nickname)")
              .eq("question_id", activeQuestion.id);
            if (data) setPlayerAnswers(data);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room, activeQuestion, questions]);

  // --- RENDER VIEW 1: LOGIN SCREEN ---
  if (!player) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-white">
        <div className="w-full max-w-2xl text-center">
          <div className="mb-8 inline-block rounded-full border border-yellow-400/30 bg-yellow-400/10 px-5 py-2 text-sm font-semibold tracking-widest text-yellow-300">
            QUIZBALL LIVE
          </div>
          <h1 className="text-5xl font-black tracking-tight sm:text-7xl">
            THE ULTIMATE <span className="mt-2 block text-yellow-400">QUIZ</span>
          </h1>
          
          <div className="mt-12 rounded-3xl border border-slate-700 bg-slate-900 p-8 shadow-2xl sm:p-12">
            <div className="grid grid-cols-2 gap-2 mb-8 bg-slate-800 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => { setIsCreatingRoom(false); setError(""); }}
                className={`py-3 rounded-xl font-bold text-sm transition ${!isCreatingRoom ? "bg-yellow-400 text-slate-950 shadow-lg" : "text-slate-400 hover:text-white"}`}
              >
                Join Room
              </button>
              <button
                type="button"
                onClick={() => { setIsCreatingRoom(true); setError(""); generateRoomCode(); }}
                className={`py-3 rounded-xl font-bold text-sm transition ${isCreatingRoom ? "bg-yellow-400 text-slate-950 shadow-lg" : "text-slate-400 hover:text-white"}`}
              >
                Create Room (Referee)
              </button>
            </div>

            <h2 className="text-2xl font-bold">
              {isCreatingRoom ? "Create a New Game Room" : "Join Existing Room"}
            </h2>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <input
                type="text"
                placeholder="Your nickname..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                disabled={loading}
                className="w-full rounded-xl border border-slate-600 bg-slate-800 px-5 py-4 text-center text-lg text-white outline-none focus:border-yellow-400"
              />

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Room code (e.g. QB99X)"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  disabled={loading}
                  className="w-full rounded-xl border border-slate-600 bg-slate-800 px-5 py-4 text-center text-lg uppercase tracking-widest text-white outline-none focus:border-yellow-400"
                />
                {isCreatingRoom && (
                  <button
                    type="button"
                    onClick={generateRoomCode}
                    className="bg-slate-700 hover:bg-slate-600 px-4 rounded-xl text-xs font-bold tracking-wider uppercase text-yellow-400"
                  >
                    🎲 Random
                  </button>
                )}
              </div>

              {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
              
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-yellow-400 px-6 py-4 text-lg font-black text-slate-950 transition hover:bg-yellow-300 mt-4"
              >
                {loading ? "PROCESSING..." : isCreatingRoom ? "CREATE ROOM & REFEREE →" : "JOIN THE GAME →"}
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  // --- RENDER VIEW 2: GAME DASHBOARD ---
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white relative">
      <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        <div className="lg:col-span-3 space-y-6">
          <div className="flex justify-between items-center bg-slate-900 p-6 rounded-2xl border border-slate-800">
            <div>
              <span className="text-xs uppercase tracking-widest text-yellow-400 font-bold">Room: {room.room_code}</span>
              <h2 className="text-2xl font-black">Welcome, {player.nickname}!</h2>
            </div>
            <span className="bg-slate-800 px-4 py-2 rounded-xl text-sm font-semibold text-slate-300">
              {player.is_admin ? "⚖️ REFEREE MODE" : "🎮 PLAYER MODE"}
            </span>
          </div>

          {/* JEOPARDY QUESTION BOARD */}
          {!activeQuestion && (
            <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800">
              <h3 className="text-xl font-bold mb-4 text-yellow-400">
                {player.is_admin ? "📋 Jeopardy Board (Waiting for players to choose...)" : "📋 Jeopardy Board (Choose a tile!)"}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {questions.map((q) => (
                  <div key={q.id} className="border border-slate-700 bg-slate-800/50 p-6 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="text-xl font-black text-white">{q.category}</h4>
                      <p className="text-sm font-bold text-yellow-400 mt-1">
                        {q.points} PTS {q.is_multi_part && "• 🔄 Multi-Part"} {q.image_url && "• 🖼️ Photo"}
                      </p>
                    </div>
                    {!player.is_admin && (
                      <button
                        onClick={() => selectQuestion(q)}
                        className="bg-yellow-400 text-slate-950 px-5 py-3 rounded-xl font-black text-sm hover:bg-yellow-300 transition shadow-lg"
                      >
                        Choose Tile →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ACTIVE QUESTION SCREEN */}
          {activeQuestion && (
            <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <span className="bg-yellow-400/10 text-yellow-400 px-3 py-1 rounded-full text-xs font-bold">
                  {activeQuestion.category} • {activeQuestion.points} PTS {activeQuestion.is_multi_part && "• Multi-Part Sequential"}
                </span>
                {player.is_admin && (
                  <button
                    onClick={closeQuestion}
                    className="text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-lg hover:bg-red-500/30 font-bold"
                  >
                    Close Question & Return to Board
                  </button>
                )}
              </div>

              <div>
                <h3 className="text-2xl font-bold text-white mb-4">{activeQuestion.question_text}</h3>
                
                {activeQuestion.image_url && (
                  <div className="mb-4 text-center">
                    <p className="text-xs text-yellow-400 font-semibold mb-2">👆 Click on the image to view it full-screen</p>
                    <div 
                      onClick={() => setModalImage(activeQuestion.image_url)}
                      className="cursor-pointer inline-block overflow-hidden rounded-2xl border-2 border-yellow-400/50 bg-slate-950 p-2 hover:border-yellow-400 transition shadow-xl"
                    >
                      <img src={activeQuestion.image_url} alt="Question visual" className="max-h-72 rounded-xl object-contain mx-auto" />
                    </div>
                  </div>
                )}
              </div>

              {player.is_admin && (
                <div className="bg-slate-800 p-4 rounded-xl border border-yellow-500/30">
                  <p className="text-xs font-bold text-yellow-400 uppercase">🔑 Referee Reference Answer Key:</p>
                  <p className="text-lg text-white mt-1">{activeQuestion.correct_answer || JSON.stringify(activeQuestion.parts)}</p>
                </div>
              )}

              {!player.is_admin && !hasFinishedQuestion && (
                <form onSubmit={submitAnswer} className="space-y-4">
                  {activeQuestion.is_multi_part && (
                    <div className="text-sm font-semibold text-yellow-400 bg-yellow-400/10 p-3 rounded-lg flex justify-between">
                      <span>Step {currentStep + 1}</span>
                      <span>Mistakes: {mistakesCount} / 2</span>
                    </div>
                  )}
                  <input
                    type="text"
                    placeholder={activeQuestion.is_multi_part ? `Enter answer for step ${currentStep + 1}...` : "Type your free-text answer here..."}
                    value={myAnswer}
                    onChange={(e) => setMyAnswer(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-5 py-4 text-white outline-none focus:border-yellow-400 text-lg"
                  />
                  <button type="submit" className="w-full bg-yellow-400 text-slate-950 font-black py-4 rounded-xl hover:bg-yellow-300 text-lg">
                    SUBMIT ANSWER
                  </button>
                  {stepMessage && <p className="text-center text-sm font-semibold text-yellow-400 mt-2">{stepMessage}</p>}
                </form>
              )}

              {!player.is_admin && hasFinishedQuestion && (
                <div className="bg-slate-800 p-4 rounded-xl text-center text-yellow-400 font-bold">
                  ✓ Finished answering! Waiting for referee assessment...
                </div>
              )}

              {player.is_admin && (
                <div className="space-y-4 mt-6">
                  <h4 className="font-bold text-slate-300 border-t border-slate-800 pt-4">Live Player Submissions (Referee Evaluation):</h4>
                  {playerAnswers.length === 0 ? (
                    <p className="text-slate-500 italic">Waiting for answers...</p>
                  ) : (
                    playerAnswers.map((ans) => (
                      <div key={ans.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-800 p-5 rounded-xl gap-4 border border-slate-700">
                        <div>
                          <span className="font-bold text-yellow-400 text-lg">{ans.players?.nickname}: </span>
                          <span className="text-white text-lg font-semibold">{ans.answer_text}</span>
                          <div className="text-xs text-slate-400 mt-1">
                            Status: <span className="text-yellow-300 font-bold">{ans.status}</span> | Mistakes: {ans.mistakes_count || 0}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-1 bg-slate-900 px-3 py-2 rounded-xl border border-slate-700">
                            <span className="text-xs text-slate-400">Award Points:</span>
                            <input
                              type="number"
                              defaultValue={activeQuestion.points}
                              id={`pts-${ans.id}`}
                              className="w-16 bg-slate-800 text-white font-bold text-center outline-none rounded"
                            />
                          </div>

                          <button
                            onClick={() => {
                              const pts = Number((document.getElementById(`pts-${ans.id}`) as HTMLInputElement)?.value || activeQuestion.points);
                              gradeStepOrAnswer(ans.id, ans.player_id, true, pts);
                            }}
                            className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-xl text-xs font-black shadow"
                          >
                            ✓ Right / Advance
                          </button>

                          <button
                            onClick={() => {
                              const pts = Number((document.getElementById(`pts-${ans.id}`) as HTMLInputElement)?.value || 0);
                              gradeStepOrAnswer(ans.id, ans.player_id, false, pts);
                            }}
                            className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl text-xs font-black shadow"
                          >
                            ✗ Wrong / Flag
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar: Leaderboard & QR Code Scanner for Room Joining */}
        <div className="space-y-6">
          <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
            <h3 className="text-lg font-bold text-yellow-400 mb-4">🏆 Live Leaderboard</h3>
            <div className="space-y-3">
              {leaderboard
                .filter((p) => !p.is_admin)
                .map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center bg-slate-800 p-3 rounded-xl">
                    <span className="font-semibold text-slate-200">
                      {idx + 1}. {p.nickname} {p.id === player.id && "(You)"}
                    </span>
                    <span className="font-black text-yellow-400">{p.score || 0} pts</span>
                  </div>
                ))}
              {leaderboard.filter((p) => !p.is_admin).length === 0 && (
                <p className="text-slate-500 text-sm italic">Waiting for players to join...</p>
              )}
            </div>
          </div>

          {/* QR CODE BOX FOR PLAYERS TO SCAN */}
          <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 text-center">
            <h3 className="text-sm font-bold text-yellow-400 mb-2 uppercase tracking-widest">📱 Scan to Join Room</h3>
            <p className="text-xs text-slate-400 mb-4">Point phone camera here to jump straight into room <b>{room.room_code}</b></p>
            <div className="bg-white p-4 rounded-xl inline-block shadow-lg">
              <QRCodeSVG 
                value={typeof window !== "undefined" ? window.location.href : ""} 
                size={150} 
              />
            </div>
          </div>
        </div>

      </div>

      {/* FULL-SCREEN IMAGE MODAL POP-UP */}
      {modalImage && (
        <div 
          onClick={() => setModalImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md cursor-pointer"
        >
          <div className="relative max-w-5xl max-h-[90vh] w-full flex flex-col items-center">
            <span className="text-yellow-400 text-sm font-bold mb-2">Κάντε κλικ οπουδήποτε για κλείσιμο ✕</span>
            <img 
              src={modalImage} 
              alt="Zoomed question visual" 
              className="max-h-[80vh] max-w-full rounded-2xl object-contain border-4 border-yellow-400 shadow-2xl" 
            />
          </div>
        </div>
      )}
    </main>
  );
}