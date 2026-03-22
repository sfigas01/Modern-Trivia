import React from 'react';
import { Plus, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function ApresMidnight() {
  const teams = [
    { id: 1, name: 'Northern Lights', active: true },
    { id: 2, name: 'Maple Squad', active: false },
  ];

  const categories = [
    { name: 'All', count: 200, selected: true },
    { name: 'Geography', count: 45, selected: false },
    { name: 'Sports', count: 32, selected: false },
    { name: 'Science', count: 51, selected: false },
    { name: 'History', count: 48, selected: false },
    { name: 'Entertainment', count: 62, selected: false },
    { name: 'Music', count: 38, selected: false },
    { name: 'Food', count: 24, selected: false },
    { name: 'Nature', count: 31, selected: false },
  ];

  const rounds = [
    { value: 5, selected: false },
    { value: 10, selected: true },
    { value: 15, selected: false },
    { value: 20, selected: false },
  ];

  return (
    <div
      className="min-h-screen w-full flex justify-center py-12 px-4 relative overflow-hidden font-['DM_Sans'] text-[#f5e6c8]"
      style={{
        backgroundColor: '#1a1410',
        backgroundImage:
          'radial-gradient(circle at 50% 30%, rgba(212, 168, 83, 0.08) 0%, rgba(26, 20, 16, 0) 70%)',
      }}
    >
      <div className="w-full max-w-md flex flex-col gap-8 relative z-10">
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-3 mt-4">
          <Badge
            variant="outline"
            className="bg-[#241e17] text-[#d4a853] border-[#3d3020] font-medium tracking-wide"
          >
            Not Started
          </Badge>
          <h1
            className="text-5xl font-bold tracking-normal font-['Playfair_Display']"
            style={{ color: '#f5e6c8', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
          >
            TRIVIA CLASH
          </h1>
          <p
            className="text-sm tracking-[0.2em] font-medium uppercase"
            style={{ color: '#9a8068' }}
          >
            The Competitive Party Game
          </p>
        </div>

        {/* Team Setup Card */}
        <div
          className="rounded-[16px] p-6 shadow-xl"
          style={{ backgroundColor: '#241e17', border: '1px solid #3d3020' }}
        >
          <h2 className="text-xl font-['Playfair_Display'] mb-4 text-[#f5e6c8]">Teams</h2>

          <div className="flex gap-2 mb-6">
            <Input
              placeholder="Enter team name..."
              className="bg-[#1a1410] border-[#3d3020] text-[#f5e6c8] placeholder:text-[#9a8068] focus-visible:ring-[#d4a853] h-11 rounded-xl"
            />
            <Button className="bg-[#d4a853] hover:bg-[#b88c3a] text-[#1a1410] h-11 w-11 p-0 rounded-xl transition-colors">
              <Plus className="h-5 w-5" />
            </Button>
          </div>

          <div className="space-y-3">
            {teams.map((team) => (
              <div
                key={team.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                  team.active
                    ? 'border-[#d4a853] bg-[rgba(212,168,83,0.1)] shadow-[0_0_15px_rgba(212,168,83,0.05)]'
                    : 'border-[#3d3020] bg-[#1a1410]'
                }`}
              >
                <span
                  className={`font-medium ${team.active ? 'text-[#d4a853]' : 'text-[#e0c9a3]'}`}
                >
                  {team.name}
                </span>
                <button className="text-[#9a8068] hover:text-[#d4a853] transition-colors p-1 rounded-md hover:bg-[#241e17]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Category Card */}
        <div
          className="rounded-[16px] p-6 shadow-xl"
          style={{ backgroundColor: '#241e17', border: '1px solid #3d3020' }}
        >
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-xl font-['Playfair_Display'] text-[#f5e6c8]">Category</h2>
            <span className="text-sm text-[#9a8068] font-medium">Select one</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {categories.map((cat) => (
              <button
                key={cat.name}
                className={`flex justify-between items-center px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 ${
                  cat.selected
                    ? 'bg-[#d4a853] border-[#d4a853] text-[#1a1410] shadow-[0_2px_10px_rgba(212,168,83,0.2)]'
                    : 'bg-[#1a1410] border-[#3d3020] text-[#e0c9a3] hover:border-[#d4a853] hover:bg-[rgba(212,168,83,0.05)]'
                }`}
              >
                <span>{cat.name}</span>
                <span className={cat.selected ? 'text-[#1a1410] opacity-80' : 'text-[#9a8068]'}>
                  {cat.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Rounds Card */}
        <div
          className="rounded-[16px] p-6 shadow-xl"
          style={{ backgroundColor: '#241e17', border: '1px solid #3d3020' }}
        >
          <h2 className="text-xl font-['Playfair_Display'] mb-4 text-[#f5e6c8]">
            Questions per Team
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {rounds.map((round) => (
              <button
                key={round.value}
                className={`py-3 rounded-xl border text-lg font-medium transition-all duration-200 ${
                  round.selected
                    ? 'bg-[#d4a853] border-[#d4a853] text-[#1a1410] shadow-[0_2px_10px_rgba(212,168,83,0.2)]'
                    : 'bg-[#1a1410] border-[#3d3020] text-[#e0c9a3] hover:border-[#d4a853] hover:bg-[rgba(212,168,83,0.05)]'
                }`}
              >
                {round.value}
              </button>
            ))}
          </div>
        </div>

        {/* Warning Banner */}
        <div className="rounded-xl border border-amber-900/50 bg-amber-900/10 p-4 flex items-start gap-3 text-amber-500">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Not enough questions</p>
            <p className="opacity-80">This category only has 200 questions available.</p>
          </div>
        </div>

        {/* Start Button */}
        <Button
          className="w-full h-16 text-xl font-bold tracking-wide rounded-[16px] bg-[#d4a853] text-[#1a1410] hover:bg-[#e6bb69] transition-all"
          style={{
            boxShadow: '0 8px 30px rgba(212, 168, 83, 0.3), inset 0 2px 0 rgba(255,255,255,0.2)',
          }}
        >
          START GAME
        </Button>

        {/* Footer Links */}
        <div className="flex justify-center gap-6 mt-4">
          <button className="text-sm font-medium text-[#9a8068] hover:text-[#d4a853] transition-colors">
            Sign In
          </button>
          <span className="text-[#3d3020]">•</span>
          <button className="text-sm font-medium text-[#9a8068] hover:text-[#d4a853] transition-colors">
            Admin Panel
          </button>
        </div>
      </div>
    </div>
  );
}
