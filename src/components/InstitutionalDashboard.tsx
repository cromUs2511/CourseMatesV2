import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  ShieldCheck,
  Heart,
  Users,
  Compass,
  Award,
  Terminal,
  Activity,
} from 'lucide-react';
import { InstitutionalAnalytics } from '../types';

export const InstitutionalDashboard: React.FC = () => {
  const [analytics, setAnalytics] = useState<InstitutionalAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const res = await fetch('/api/analytics');
      const data = await res.json();
      setAnalytics(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !analytics) {
    return (
      <div className="max-w-5xl mx-auto p-12 text-center text-stone-500 font-mono">
        <div className="w-4 h-4 bg-[#990000] animate-ping mx-auto mb-3" />
        <p className="text-xs uppercase font-bold">SYNCHRONIZING TELEMETRY TELETYPES...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-3 sm:p-6 md:p-8 space-y-5 max-w-6xl mx-auto w-full font-mono select-none">
      {/* Header Schematic Box */}
      <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 sm:p-6 shadow-[4px_4px_0px_#000] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-[#990000] dark:text-[#E63946] uppercase mb-1">
            <Terminal className="w-4 h-4" />
            <span>INSTITUTIONAL METRICS // RAM TELEMETRY</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black tracking-tight text-black dark:text-white uppercase">
            MAPÚA ACADEMIC PEER TELEMETRY
          </h2>
          <p className="text-xs text-stone-600 dark:text-stone-400 mt-1 max-w-2xl leading-relaxed">
            Aggregated, non-identifying telemetry tracking peer collaboration, cross-discipline bridging, and student academic wellness.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-[#DCFCE7] dark:bg-[#142E1F] border-2 border-black px-3 py-2 text-[#14532D] dark:text-[#86EFAC] text-xs font-bold shrink-0 shadow-[2px_2px_0px_#000]">
          <ShieldCheck className="w-4 h-4" />
          <span>RAM AUDIT • ZERO TRANSCRIPTS</span>
        </div>
      </div>

      {/* 4 Core Success Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-stone-500 uppercase font-bold">
            <span>CROSS-DISCIPLINE</span>
            <Compass className="w-4 h-4 text-[#990000]" />
          </div>
          <div className="text-3xl font-black text-black dark:text-white">
            {analytics.crossDisciplineRate}%
          </div>
          <p className="text-[11px] text-[#15803D] dark:text-[#4ADE80] font-bold">
            + SOIT + ENG CROSS-COLLAB
          </p>
        </div>

        <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-stone-500 uppercase font-bold">
            <span>AVG SESSION BURST</span>
            <Users className="w-4 h-4 text-black dark:text-white" />
          </div>
          <div className="text-3xl font-black text-black dark:text-white">
            {analytics.avgSessionDurationMins}m
          </div>
          <p className="text-[11px] text-stone-500">OPTIMAL FOCUS CYCLES</p>
        </div>

        <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-stone-500 uppercase font-bold">
            <span>STRESS RELIEF</span>
            <Heart className="w-4 h-4 text-[#990000]" />
          </div>
          <div className="text-3xl font-black text-black dark:text-white">
            {analytics.stressReliefRating}%
          </div>
          <p className="text-[11px] text-[#15803D] dark:text-[#4ADE80] font-bold">VENTING & BURNOUT INDEX</p>
        </div>

        <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 shadow-[4px_4px_0px_#000] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-stone-500 uppercase font-bold">
            <span>COMMUNITY NPS</span>
            <Award className="w-4 h-4 text-[#FFD700]" />
          </div>
          <div className="text-3xl font-black text-black dark:text-white">
            +{analytics.satisfactionNps}
          </div>
          <p className="text-[11px] text-stone-500">
            {analytics.todayMatchedStudents.toLocaleString()} PEER STUDENTS MATCHED TODAY
          </p>
        </div>
      </div>

      {/* Top Academic Subjects Bar */}
      <div className="border-2 border-black dark:border-stone-500 bg-white dark:bg-[#181B20] p-5 sm:p-6 shadow-[4px_4px_0px_#000] space-y-4">
        <div className="flex items-center justify-between border-b-2 border-black dark:border-stone-600 pb-3">
          <h3 className="text-xs font-bold tracking-wider uppercase text-black dark:text-white">
            ACTIVE MAPÚA COURSE NODES (CURRENT QUARTER)
          </h3>
          <span className="text-xs text-stone-500 uppercase font-bold">LIVE TELEMETRY</span>
        </div>

        <div className="space-y-3 pt-1">
          {analytics.topSubjects.map((sub) => (
            <div key={sub.name} className="space-y-1">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-black dark:text-white">
                  {sub.name}
                </span>
                <span className="text-stone-500">{sub.count} SESSIONS</span>
              </div>
              <div className="w-full h-3 bg-stone-200 dark:bg-stone-800 border border-black dark:border-stone-600">
                <div
                  className="h-full bg-[#990000]"
                  style={{ width: `${Math.min(100, (sub.count / 300) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
