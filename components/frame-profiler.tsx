import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

export function FrameProfiler({ metrics, stats }: { metrics: any, stats: any }) {
  if (!metrics) return null;
  
  return (
    <div className="fixed bottom-4 left-4 bg-gray-900 text-green-400 font-mono text-[10px] p-3 rounded-lg shadow-2xl border border-gray-700 z-[9999] opacity-90 hover:opacity-100 transition-opacity w-[320px] pointer-events-none">
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-700 font-bold text-white uppercase tracking-wider">
        <Activity className="w-4 h-4 text-emerald-400" /> Pipeline Profiler
      </div>
      
      <div className="space-y-1">
        <div className="flex justify-between text-slate-300">
          <span>Frame Complete</span>
          <span className="font-bold text-white">{metrics.frameTotal?.toFixed(1)} ms</span>
        </div>
        
        <div className="mt-2 space-y-0.5 border-l-2 border-gray-700 pl-2 ml-1 text-slate-400">
          <div className="flex justify-between">
            <span>↳ Tile Selection</span>
            <span>{metrics.tileSelection?.toFixed(2)} ms</span>
          </div>
          <div className="flex justify-between">
            <span>↳ Cache Lookup</span>
            <span>{metrics.cacheLookup?.toFixed(2)} ms</span>
          </div>
          <div className="flex justify-between">
            <span>↳ Canvas Draw</span>
            <span className={metrics.canvasDraw > 16 ? "text-red-400 font-bold" : ""}>{metrics.canvasDraw?.toFixed(2)} ms</span>
          </div>
        </div>

        <div className="mt-2 pt-2 border-t border-gray-700 space-y-1 text-slate-400">
          <div className="flex justify-between">
            <span>Tile Decode (Worker)</span>
            <span>{stats?.averageTileExtractTime?.toFixed(1)} ms/tile</span>
          </div>
          <div className="flex justify-between">
            <span>Bitmap Transfer</span>
            <span>{stats?.averageTileBitmapTime?.toFixed(1)} ms/tile</span>
          </div>
          <div className="flex justify-between">
            <span>Worker Queue</span>
            <span>{stats?.decodeQueueLength || 0} tasks</span>
          </div>
          <div className="flex justify-between">
            <span>Cache Hit Ratio</span>
            <span>{((stats?.cacheHitRatio || 0) * 100).toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
