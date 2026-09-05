/**
 * Renders an article body.
 *
 * Articles are stored as plain text with a small markup subset, the same one
 * X uses under the hood: headings, bold, italic, quotes, links and images.
 * Plain text with no markup renders exactly as paragraphs, so every article
 * written before this existed looks the same as it always did.
 *
 * No HTML is ever interpreted from the text; every construct is parsed and
 * emitted as React elements, so nothing an author types can become a script.
 */
import Link from "next/link";

const H1 = /^# (.+)$/;
const H2 = /^## (.+)$/;
const QUOTE = /^> ?(.*)$/;
const IMG = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/;
const RULE = /^---+$/;
const BULLET_LINE = /^- (.+)$/;
const NUMBERED_LINE = /^\d+\. (.+)$/;

function inline(
  text: string,
  key: string,
  onMention?: (u: string) => void,
  onHashtag?: (t: string) => void,
): React.ReactNode[] {
  // bold, italic, links and mentions/hashtags, left to right, one pass
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(_[^_]+_)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|([@#][\w.]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={key + i++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("_")) out.push(<em key={key + i++}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("#") && onHashtag) {
      out.push(<button key={key + i++} type="button" onClick={() => onHashtag(tok.slice(1))} className="font-semibold text-pearl-muted hover:underline">{tok}</button>);
    } else if (tok.startsWith("@") && onMention) {
      out.push(<button key={key + i++} type="button" onClick={() => onMention(tok.slice(1))} className="font-semibold text-ink hover:underline">{tok}</button>);
    } else if (tok.startsWith("@") || tok.startsWith("#")) {
      out.push(tok);
    } else {
      const lm = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok);
      if (lm) {
        const internal = lm[2].startsWith(typeof window !== "undefined" ? window.location.origin : "\u0000");
        out.push(
          internal
            ? <Link key={key + i++} href={lm[2].replace(window.location.origin, "")} className="text-pearl-muted underline underline-offset-2">{lm[1]}</Link>
            : <a key={key + i++} href={lm[2]} target="_blank" rel="noopener noreferrer" className="text-pearl-muted underline underline-offset-2">{lm[1]}</a>,
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ArticleBody({
  text,
  className = "",
  onMention,
  onHashtag,
}: {
  text: string;
  className?: string;
  onMention?: (u: string) => void;
  onHashtag?: (t: string) => void;
}) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={"article-body " + className}>
      {blocks.map((raw, bi) => {
        const block = raw.trim();
        if (!block) return null;
        const k = "b" + bi;
        let m: RegExpExecArray | null;
        if ((m = H1.exec(block))) return <h2 key={k} className="mt-6 font-display text-[24px] leading-tight text-porcelain">{inline(m[1], k, onMention, onHashtag)}</h2>;
        if ((m = H2.exec(block))) return <h3 key={k} className="mt-5 text-[18px] font-semibold text-ink">{inline(m[1], k, onMention, onHashtag)}</h3>;
        if ((m = IMG.exec(block))) {
          return (
            <figure key={k} className="my-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m[2]} alt={m[1]} loading="lazy" className="w-full rounded-xl" />
              {m[1] ? <figcaption className="mt-1.5 text-center text-[12.5px] text-ink/50">{m[1]}</figcaption> : null}
            </figure>
          );
        }
        if (RULE.test(block)) return <hr key={k} className="my-6 border-ink/10" />;
        if (block.split("\n").every((l) => BULLET_LINE.test(l))) {
          const items = block.split("\n").map((l) => BULLET_LINE.exec(l)![1]);
          return (
            <ul key={k} className="mt-4 list-disc space-y-1.5 pl-5 text-[16.5px] leading-[1.7] text-ink/90">
              {items.map((item, ii) => <li key={ii}>{inline(item, k + "i" + ii, onMention, onHashtag)}</li>)}
            </ul>
          );
        }
        if (block.split("\n").every((l) => NUMBERED_LINE.test(l))) {
          const items = block.split("\n").map((l) => NUMBERED_LINE.exec(l)![1]);
          return (
            <ol key={k} className="mt-4 list-decimal space-y-1.5 pl-5 text-[16.5px] leading-[1.7] text-ink/90">
              {items.map((item, ii) => <li key={ii}>{inline(item, k + "i" + ii, onMention, onHashtag)}</li>)}
            </ol>
          );
        }
        if (block.split("\n").every((l) => QUOTE.test(l))) {
          const inner = block.split("\n").map((l) => (QUOTE.exec(l) ?? ["", ""])[1]).join("\n");
          return <blockquote key={k} className="my-4 border-l-[3px] border-pearl pl-4 text-[16px] italic leading-relaxed text-ink/75">{inline(inner, k, onMention, onHashtag)}</blockquote>;
        }
        // a paragraph; single newlines inside it stay as line breaks
        const lines = block.split("\n");
        return (
          <p key={k} className="mt-4 whitespace-pre-wrap text-[16.5px] leading-[1.7] text-ink/90 first:mt-0">
            {lines.map((l, li) => (
              <span key={li}>{inline(l, k + "l" + li, onMention, onHashtag)}{li < lines.length - 1 ? <br /> : null}</span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
