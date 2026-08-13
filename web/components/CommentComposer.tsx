"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function CommentComposer({ postId }: { postId: string }) {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const body = text.trim();
    if (!body || pending) return;
    setPending(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { router.push("/login"); return; }
    const { error: insErr } = await supabase.from("post_comments").insert({
      post_id: postId,
      user_id: uid,
      body,
      content: body,
      parent_comment_id: null,
      media_url: null,
      media_type: null,
    });
    setPending(false);
    if (insErr) { setError(insErr.message); return; }
    setText("");
    router.refresh();
  }

  return (
    <div className="mt-4">
      <div className="flex items-end gap-2">
        <textarea value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Add a comment"
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-md bg-surface px-4 py-2.5 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
        />
        <button onClick={submit} disabled={pending || !text.trim()} className="rounded-md bg-pearl p-2.5 text-ink transition-opacity hover:opacity-90 disabled:opacity-30" title="Comment">
          <Send size={17} />
        </button>
      </div>
      {error ? <p className="mt-1 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}