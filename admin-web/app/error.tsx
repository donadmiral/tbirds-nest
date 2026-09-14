"use client";
export default function ErrorPage({reset}:{reset:()=>void}) {
 return <main className="p-8"><h1>Information unavailable</h1><p>The requested data could not be loaded completely. Retry or contact your administrator.</p><button type="button" onClick={reset}>Retry</button></main>;
}
