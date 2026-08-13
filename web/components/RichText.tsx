import Link from "next/link";
import React from "react";

// Linkifies #hashtags and @mentions with the feed's own tag pattern.
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(#[A-Za-z0-9_]+|@[A-Za-z0-9_.]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("#")) {
          return (
            <Link key={i} href={"/topic/" + encodeURIComponent(p.slice(1))} onClick={(e) => e.stopPropagation()} className="text-pearl hover:underline">
              {p}
            </Link>
          );
        }
        if (p.startsWith("@") && p.length > 1) {
          return (
            <Link key={i} href={"/" + p.slice(1).replace(/\.$/, "")} onClick={(e) => e.stopPropagation()} className="text-pearl hover:underline">
              {p}
            </Link>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}