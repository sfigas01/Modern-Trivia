import React, { useState } from "react";
import { Plus, X, AlertCircle } from "lucide-react";

export function CleanSlate() {
  const [teamName, setTeamName] = useState("");
  
  const teams = [
    { id: 1, name: "Northern Lights", active: true },
    { id: 2, name: "Maple Squad", active: false }
  ];

  const categories = [
    { name: "All", count: 200 },
    { name: "Geography", count: 45 },
    { name: "Sports", count: 32 },
    { name: "Science", count: 56 },
    { name: "History", count: 41 },
    { name: "Entertainment", count: 67 },
    { name: "Music", count: 29 },
    { name: "Food", count: 18 },
    { name: "Nature", count: 24 }
  ];
  
  const selectedCategory = "All";
  const rounds = [5, 10, 15, 20];
  const selectedRounds = 10;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-gray-900 selection:bg-green-100 selection:text-green-900 p-6 md:p-12 overflow-y-auto">
      <div className="mx-auto max-w-md space-y-10 pb-16">
        
        {/* Header Area */}
        <div className="flex flex-col items-center text-center space-y-3 pt-8">
          <div className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800 tracking-wide">
            Not Started
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tighter text-gray-900 uppercase" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
            Trivia Clash
          </h1>
          <p className="text-sm font-medium tracking-widest text-gray-500 uppercase">
            The Competitive Party Game
          </p>
        </div>

        {/* Team Setup Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Teams</h2>
          
          <div className="flex space-x-2 mb-6">
            <input 
              type="text" 
              placeholder="Enter team name..." 
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="flex-1 bg-white border border-gray-300 rounded-md px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent transition-shadow"
            />
            <button className="bg-gray-900 hover:bg-gray-800 text-white rounded-md px-4 py-2 flex items-center justify-center transition-colors">
              <Plus className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3">
            {teams.map((team) => (
              <div 
                key={team.id} 
                className={`flex items-center justify-between p-3 rounded-md border ${team.active ? 'border-green-600 bg-green-50/50' : 'border-gray-200 bg-gray-50'}`}
              >
                <span className={`text-sm font-medium ${team.active ? 'text-green-800' : 'text-gray-700'}`}>
                  {team.name}
                </span>
                <button className="text-gray-400 hover:text-red-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Categories Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Category</h2>
          <div className="grid grid-cols-2 gap-3">
            {categories.map((cat) => (
              <button
                key={cat.name}
                className={`flex justify-between items-center px-4 py-3 rounded-md border text-sm transition-all ${
                  selectedCategory === cat.name
                    ? 'border-green-600 bg-green-600 text-white font-medium shadow-sm'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span>{cat.name}</span>
                <span className={`text-xs ${selectedCategory === cat.name ? 'text-green-100' : 'text-gray-400'}`}>
                  {cat.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Rounds Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Rounds</h2>
            <span className="text-xs text-gray-500">Max 20</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {rounds.map((round) => (
              <button
                key={round}
                className={`py-3 rounded-md border text-sm font-medium transition-all ${
                  selectedRounds === round
                    ? 'border-green-600 bg-green-600 text-white shadow-sm'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {round}
              </button>
            ))}
          </div>
        </div>

        {/* Warning Banner */}
        <div className="flex items-start p-4 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
          <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5 text-amber-600" />
          <p className="text-sm leading-relaxed">
            Not enough questions in this category. Only 18 available, but you need 20 for the selected rounds.
          </p>
        </div>

        {/* Start Button */}
        <button className="w-full py-5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold tracking-widest uppercase text-lg transition-colors">
          Start Game
        </button>

        {/* Footer Links */}
        <div className="flex justify-center items-center space-x-6 pt-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
          <button className="hover:text-gray-900 transition-colors">Sign In</button>
          <span>•</span>
          <button className="hover:text-gray-900 transition-colors">Admin Panel</button>
        </div>

      </div>
    </div>
  );
}
