"use client";

import { useEffect } from "react";

// Shown in place of the page when rendering it throws. Without this file Next
// swaps the whole document for a bare "Application error" line with no way
// back; this keeps the reader on the site and gives them a retry. (A single
// tab's failure is caught closer in — see TabBoundary in tracker.js — so this
// is the last resort for an error above the tabs.)
export default function Error({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="min-h-screen bg-stone-100 flex items-center justify-center px-4">
      <div role="alert" className="max-w-sm w-full bg-white border-2 border-stone-900 p-4 text-center">
        <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Something went wrong</h1>
        <p className="text-sm text-stone-700 mb-3">The page hit an error it couldn’t recover from. Your link is still good — try again, or reload.</p>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={() => reset()} className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest bg-stone-900 text-white">Try again</button>
          <button type="button" onClick={() => window.location.reload()} className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-stone-400 text-stone-700">Reload</button>
        </div>
      </div>
    </main>
  );
}
