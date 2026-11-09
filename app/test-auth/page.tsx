"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { signInPlayer } from "../lib/playerAuth";

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [player, setPlayer] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<any>(null);
  const [answerText, setAnswerText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [liveAnswers, setLiveAnswers] = useState<any[]>([]);
  const [error, setError] = useState("");

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!nickname.trim() || !roomCode.trim()) return;

    try {
      await signInPlayer();
      const { data, error } = await supabase.rpc("join_room", {
        p_room_code: roomCode,
        p_nickname: nickname,
      });

      if (error) throw error;
      if (data && data.length > 0) {
        setPlayer(data[0]);
        setRoom({ id: data[0].room_id, room_code: roomCode });
        loadGameData(data[0].room_id);
      }
    } catch (err: any) {
      setError(err.message || "Σφάλμα κατά τη σύνδεση.");
    }
  }

  async function loadGameData(roomId: string) {
    const { data: catData } = await supabase.from("categories").select("*").eq("room_id", roomId);
    if (catData) setCategories(catData);

    const { data: qData } = await supabase
      .from("questions")
      .select("*, categories!inner(room_id)")
      .eq("categories.room_id", roomId);
    if (qData) setQuestions(qData);

    fetchLeaderboard(roomId);
  }

  async function fetchLeaderboard(roomId: string) {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("score", { ascending: false });
    if (data) setLeaderboard(data);
  }

  useEffect(() => {
    if (!room) return;
    const channel = supabase
      .channel("room-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` }, () => fetchLeaderboard(room.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "answers" }, () => fetchLiveAnswers(selectedQuestion?.id))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room, selectedQuestion]);

  async function fetchLiveAnswers(qId?: string) {
    if (!qId) return;
    const { data } = await supabase.from("answers").select("*, players(nickname)").eq("question_id", qId);
    if (data) setLiveAnswers(data);
  }

  async function handleSubmitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedQuestion || !player) return;

    const { error } = await supabase.from("answers").insert({
      question_id: selectedQuestion.id,
      player_id: player.id,
      answer_text: answerText,
      status: "pending",
    });

    if (error) setError(error.message);
    else setSubmitted(true);
  }

  async function evaluateAnswer(answerId: string, playerId: string, points: number, accept: boolean) {
    const newStatus = accept ? "accepted" : "rejected";
    await supabase.from("answers").update({ status: newStatus }).eq("id", answerId);

    if (accept) {
      const { data: pData } = await supabase.from("players").select("score").eq("id", playerId).single();
      if (pData) {
        await supabase.from("players").update({ score: pData.score + points }).eq("id", playerId);
      }
    }
    fetchLeaderboard(room.id);
  }

  if (!player) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-white">
        <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
          <h1 className="text-2xl font-black text-center mb-6 text-yellow-400">QUIZBALL ΣΥΝΔΕΣΗ</h1>
          {error && <p className="mb-4 text-center text-sm text-red-400">{error}</p>}
          <form onSubmit={handleJoin} className="space-y-4">
            <input
              type="text"
              placeholder="Nickname..."
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-yellow-400"
            />
            <input
              type="text"
              placeholder="Room Code (π.χ. QBTEST01)..."
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              required
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-yellow-400"
            />
            <button type="submit" className="w-full rounded-xl bg-yellow-400 px-6 py-4 font-black text-slate-950 transition hover:bg-yellow-300">
              ΕΙΣΟΔΟΣ
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-3 space-y-6">
        <header className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
          <h2 className="font-bold text-yellow-400">Παίκτης: {player.nickname}</h2>
          <span className="text-sm bg-slate-800 px-3 py-1 rounded-lg">Room: {room.room_code}</span>
        </header>

        {!selectedQuestion ? (
          <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800">
            <h3 className="text-xl font-bold mb-4 text-yellow-300">Κατηγορίες & Ερωτήσεις</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {categories.map((cat) => (
                <div key={cat.id} className="bg-slate-800 p-4 rounded-2xl border border-slate-700">
                  <h4 className="font-bold text-yellow-400 mb-3">{cat.name}</h4>
                  <div className="space-y-2">
                    {questions
                      .filter((q) => q.category_id === cat.id && !q.is_used)
                      .map((q) => (
                        <button
                          key={q.id}
                          onClick={() => {
                            setSelectedQuestion(q);
                            setSubmitted(false);
                            setAnswerText("");
                            fetchLiveAnswers(q.id);
                          }}
                          className="w-full py-2 bg-yellow-500/10 hover:bg-yellow-400 hover:text-slate-950 border border-yellow-400/30 rounded-xl font-bold text-yellow-300 transition text-sm"
                        >
                          {q.points} Πόντοι
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800">
            <button onClick={() => setSelectedQuestion(null)} className="text-xs text-slate-400 hover:text-white mb-4">
              ← Πίσω
            </button>
            <h3 className="text-xl font-bold mb-4">{selectedQuestion.question_text}</h3>
            {!submitted ? (
              <form onSubmit={handleSubmitAnswer} className="space-y-3">
                <input
                  type="text"
                  placeholder="Η απάντησή σου..."
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-yellow-400"
                />
                <button type="submit" className="w-full rounded-xl bg-yellow-400 px-4 py-3 font-bold text-slate-950">
                  ΥΠΟΒΟΛΗ
                </button>
              </form>
            ) : (
              <p className="text-emerald-400 text-sm">Υποβλήθηκε! Αναμονή έγκρισης.</p>
            )}

            <div className="mt-6 border-t border-slate-800 pt-4">
              <h4 className="font-bold mb-2 text-yellow-300 text-sm">Live Admin Panel</h4>
              {liveAnswers.map((ans) => (
                <div key={ans.id} className="flex justify-between items-center bg-slate-800 p-2 rounded-lg mb-2 text-sm">
                  <span>{ans.players?.nickname}: {ans.answer_text} ({ans.status})</span>
                  <div className="space-x-1">
                    <button onClick={() => evaluateAnswer(ans.id, ans.player_id, selectedQuestion.points, true)} className="px-2 py-1 bg-green-600 rounded text-xs">✓</button>
                    <button onClick={() => evaluateAnswer(ans.id, ans.player_id, selectedQuestion.points, false)} className="px-2 py-1 bg-red-600 rounded text-xs">✗</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 h-fit">
        <h3 className="font-bold mb-4 text-yellow-400">🏆 Leaderboard</h3>
        <ul className="space-y-2 text-sm">
          {leaderboard.map((p, i) => (
            <li key={p.id} className="flex justify-between bg-slate-800 px-3 py-2 rounded-xl">
              <span>{i + 1}. {p.nickname}</span>
              <span className="font-bold text-yellow-400">{p.score}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}