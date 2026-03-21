import React from "react";
import { Plus, X, Users, Trophy, Play, AlertTriangle } from "lucide-react";

export function ArcadeRush() {
  const teams = ["Northern Lights", "Maple Squad"];
  const categories = [
    { name: "All", count: 200 },
    { name: "Geography", count: 45 },
    { name: "Sports", count: 32 },
    { name: "Science", count: 28 },
    { name: "History", count: 34 },
    { name: "Entertainment", count: 41 },
    { name: "Music", count: 22 },
    { name: "Food", count: 18 },
    { name: "Nature", count: 25 },
    { name: "Literature", count: 30 },
    { name: "Technology", count: 35 },
    { name: "General", count: 50 }
  ];
  const rounds = [5, 10, 15, 20];

  return (
    <div className="min-h-screen bg-[#080c0a] text-white font-['Space_Grotesk'] p-4 sm:p-6 md:p-8 flex justify-center selection:bg-[#00ff88] selection:text-[#080c0a]">
      <div className="w-full max-w-md space-y-6 pb-12">
        
        {/* Header */}
        <header className="text-center space-y-3 pt-6 pb-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-[#0f1a13] border border-[#00ff88]/30 mb-2 shadow-[0_0_10px_rgba(0,255,136,0.1)]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00ff88] animate-pulse shadow-[0_0_8px_#00ff88]"></span>
            <span className="text-[#00ff88] text-xs font-['Roboto_Mono'] uppercase tracking-[0.2em] font-bold">Not Started</span>
          </div>
          
          <h1 className="text-5xl sm:text-6xl font-black font-['Outfit'] tracking-tighter text-white uppercase" 
              style={{ textShadow: '0 0 10px rgba(0,255,136,0.5), 0 0 20px rgba(0,255,136,0.3), 0 0 40px rgba(0,255,136,0.1)' }}>
            TRIVIA CLASH
          </h1>
          <p className="text-[#00f0ff] text-xs sm:text-sm font-['Roboto_Mono'] tracking-[0.3em] uppercase opacity-90">
            THE COMPETITIVE PARTY GAME
          </p>
        </header>

        {/* Team Setup Card */}
        <section className="bg-[#0f1a13] border-2 border-[#00ff88]/50 rounded-md p-5 shadow-[0_0_15px_rgba(0,255,136,0.15)] relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00ff88] to-transparent opacity-50"></div>
          
          <h2 className="flex items-center gap-2 text-sm font-['Roboto_Mono'] text-[#00ff88] uppercase tracking-wider mb-4 font-bold">
            <Users size={16} /> Player Roster
          </h2>
          
          <div className="flex gap-2 mb-4">
            <input 
              type="text" 
              placeholder="ENTER TEAM NAME..." 
              className="flex-1 bg-[#080c0a] border-2 border-[#00ff88]/30 rounded-md text-sm px-3 py-2 text-white placeholder:text-[#00ff88]/30 focus:outline-none focus:border-[#00ff88] focus:shadow-[0_0_10px_rgba(0,255,136,0.2)] font-['Roboto_Mono'] transition-all"
            />
            <button className="bg-[#00ff88]/10 hover:bg-[#00ff88]/20 border-2 border-[#00ff88] text-[#00ff88] rounded-md px-4 py-2 font-bold transition-all hover:shadow-[0_0_15px_rgba(0,255,136,0.3)] hover:scale-105 active:scale-95">
              <Plus size={18} strokeWidth={3} />
            </button>
          </div>

          <div className="space-y-2">
            {teams.map((team, idx) => (
              <div 
                key={team} 
                className={`flex justify-between items-center px-3 py-2.5 rounded-md border-2 transition-all ${
                  idx === 0 
                    ? 'bg-[#00ff88]/10 border-[#00ff88] shadow-[inset_4px_0_0_#00ff88,0_0_10px_rgba(0,255,136,0.2)]' 
                    : 'bg-[#080c0a] border-[#00ff88]/20 hover:border-[#00ff88]/50'
                }`}
              >
                <span className={`font-['Space_Grotesk'] font-bold text-sm tracking-wide ${idx === 0 ? 'text-white' : 'text-gray-300'}`}>{team}</span>
                <button className="text-[#ff0055]/70 hover:text-[#ff0055] hover:bg-[#ff0055]/10 p-1.5 rounded transition-colors hover:shadow-[0_0_8px_rgba(255,0,85,0.3)]">
                  <X size={16} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Categories Card */}
        <section className="bg-[#0f1a13] border-2 border-[#00ff88]/50 rounded-md p-5 shadow-[0_0_15px_rgba(0,255,136,0.15)] relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00ff88] to-transparent opacity-50"></div>
          
          <h2 className="flex items-center gap-2 text-sm font-['Roboto_Mono'] text-[#00ff88] uppercase tracking-wider mb-4 font-bold">
            <Trophy size={16} /> Select Domain
          </h2>
          
          <div className="grid grid-cols-2 gap-2.5">
            {categories.map((cat) => {
              const isSelected = cat.name === "All";
              return (
                <button 
                  key={cat.name}
                  className={`flex justify-between items-center px-3 py-2.5 rounded-md text-xs sm:text-sm font-bold border-2 transition-all active:scale-95 ${
                    isSelected 
                      ? 'bg-[#00ff88] border-[#00ff88] text-[#080c0a] shadow-[0_0_15px_rgba(0,255,136,0.5)]' 
                      : 'bg-[#080c0a] border-[#00ff88]/30 text-[#00ff88]/80 hover:border-[#00ff88] hover:text-[#00ff88] hover:shadow-[0_0_10px_rgba(0,255,136,0.3)] hover:bg-[#00ff88]/5'
                  }`}
                >
                  <span className="truncate mr-2 uppercase tracking-wide">{cat.name}</span>
                  <span className={`text-[10px] font-['Roboto_Mono'] ${isSelected ? 'text-[#080c0a]/70 font-black' : 'text-[#00ff88]/40'}`}>
                    [{cat.count}]
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Rounds Card */}
        <section className="bg-[#0f1a13] border-2 border-[#00ff88]/50 rounded-md p-5 shadow-[0_0_15px_rgba(0,255,136,0.15)] relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00ff88] to-transparent opacity-50"></div>
          
          <h2 className="text-sm font-['Roboto_Mono'] text-[#00ff88] uppercase tracking-wider mb-4 font-bold">
            Round Limit
          </h2>
          
          <div className="grid grid-cols-4 gap-3">
            {rounds.map((round) => {
              const isSelected = round === 10;
              return (
                <button 
                  key={round}
                  className={`py-3.5 rounded-md font-['Outfit'] text-xl font-black border-2 transition-all active:scale-95 ${
                    isSelected 
                      ? 'bg-[#00f0ff] border-[#00f0ff] text-[#080c0a] shadow-[0_0_15px_rgba(0,240,255,0.6)]' 
                      : 'bg-[#080c0a] border-[#00ff88]/30 text-[#00ff88]/80 hover:border-[#00ff88] hover:text-[#00ff88] hover:shadow-[0_0_10px_rgba(0,255,136,0.3)]'
                  }`}
                >
                  {round}
                </button>
              );
            })}
          </div>
        </section>

        {/* Warning Banner */}
        <div className="bg-[#ffaa00]/10 border-2 border-[#ffaa00] rounded-md p-4 flex items-start gap-3 shadow-[0_0_15px_rgba(255,170,0,0.15)]">
          <AlertTriangle className="text-[#ffaa00] shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-[#ffaa00] font-['Roboto_Mono'] text-sm font-bold uppercase mb-1">Low Question Count</h3>
            <p className="text-[#ffaa00]/80 text-xs font-['Space_Grotesk'] leading-relaxed">
              Not enough questions in the selected category for the requested number of rounds. Some questions may repeat.
            </p>
          </div>
        </div>

        {/* Start Button */}
        <div className="pt-2">
          <button className="w-full relative group block">
            <div className="absolute inset-0 bg-[#00ff88] blur-[20px] opacity-40 group-hover:opacity-80 group-hover:blur-[25px] transition-all duration-300 rounded-md"></div>
            <div className="relative bg-[#00ff88] group-hover:bg-[#33ff99] group-active:scale-[0.98] text-[#080c0a] border-2 border-[#ffffff]/40 rounded-md py-6 px-6 flex items-center justify-center gap-4 transition-all overflow-hidden shadow-[inset_0_0_20px_rgba(255,255,255,0.3)]">
              
              {/* Scanline overlay on button */}
              <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px] opacity-30 pointer-events-none"></div>
              
              <Play className="fill-current relative z-10" size={28} />
              <span className="font-['Outfit'] font-black text-3xl tracking-[0.15em] relative z-10">START GAME</span>
            </div>
          </button>
        </div>

        {/* Footer Links */}
        <footer className="flex justify-center items-center gap-6 text-xs font-['Roboto_Mono'] tracking-[0.2em] text-[#00ff88]/50 pt-4">
          <a href="#" className="hover:text-[#00f0ff] hover:shadow-[#00f0ff] transition-colors uppercase">Sign In</a>
          <span className="opacity-30">|</span>
          <a href="#" className="hover:text-[#ff0055] transition-colors uppercase">Admin Panel</a>
        </footer>
      </div>
    </div>
  );
}
