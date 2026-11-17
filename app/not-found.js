import Link from "next/link";

export const metadata = { title: "Not found · Value Added Tracker" };

// Any path but "/" — the app is one page, so a mistyped or outdated link
// lands here. Points back at it rather than leaving Next's bare 404.
export default function NotFound() {
  return (
    <main className="min-h-screen bg-stone-100 flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-white border-2 border-stone-900 p-4 text-center">
        <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Page not found</h1>
        <p className="text-sm text-stone-700 mb-3">There’s nothing at this address.</p>
        <Link href="/" className="inline-block px-3 py-2 text-[11px] font-bold uppercase tracking-widest bg-stone-900 text-white">Open the tracker</Link>
      </div>
    </main>
  );
}
