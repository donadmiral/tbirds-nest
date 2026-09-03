/**
 * ArticleBody (phone)
 *
 * Renders an article body written in the same small markup subset the web
 * writer produces: headings, bold, italic, quotes, links and images. Plain
 * text with no markup still renders fine as paragraphs, so a post someone
 * wrote before this existed looks exactly as it always did.
 *
 * Ported line-for-line from web's src/components/ArticleBody.tsx (same
 * regex grammar, same block-then-inline two-pass parse) so an article looks
 * and reads the same on both platforms. Divergence from web, stated
 * plainly: web tells an internal link (same origin) from an external one
 * and keeps internal links in-app; phone has no equivalent route map to
 * check against, so every link opens through the system browser. Everything
 * else matches.
 */
import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

const NAVY = '#0B1E3D';
const PEARL = '#C9BFB0';

const H1 = /^# (.+)$/;
const H2 = /^## (.+)$/;
const QUOTE = /^> ?(.*)$/;
const IMG = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/;
const RULE = /^---+$/;
const BULLET_LINE = /^- (.+)$/;
const NUMBERED_LINE = /^\d+\. (.+)$/;
const INLINE = /(\*\*[^*]+\*\*)|(_[^_]+_)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|([@#][\w.]+)/g;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

function inline(
  text: string,
  keyBase: string,
  onMention?: (u: string) => void,
  onHashtag?: (t: string) => void,
): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  const re = new RegExp(INLINE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(<Text key={keyBase + 'i' + i++} style={ab.bold}>{tok.slice(2, -2)}</Text>);
    } else if (tok.startsWith('_')) {
      out.push(<Text key={keyBase + 'i' + i++} style={ab.italic}>{tok.slice(1, -1)}</Text>);
    } else if (tok.startsWith('#') && onHashtag) {
      out.push(
        <Text key={keyBase + 'i' + i++} style={ab.hashtag} suppressHighlighting onPress={() => onHashtag(tok.slice(1))}>
          {tok}
        </Text>,
      );
    } else if (tok.startsWith('@') && onMention) {
      out.push(
        <Text key={keyBase + 'i' + i++} style={ab.mention} suppressHighlighting onPress={() => onMention(tok.slice(1))}>
          {tok}
        </Text>,
      );
    } else if (tok.startsWith('@') || tok.startsWith('#')) {
      out.push(tok);
    } else {
      const lm = LINK.exec(tok);
      if (lm) {
        out.push(
          <Text key={keyBase + 'i' + i++} style={ab.link} suppressHighlighting onPress={() => Linking.openURL(lm[2]).catch(() => {})}>
            {lm[1]}
          </Text>,
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function ArticleBody({
  text,
  onMention,
  onHashtag,
}: {
  text: string;
  onMention?: (u: string) => void;
  onHashtag?: (t: string) => void;
}) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <View>
      {blocks.map((raw, bi) => {
        const block = raw.trim();
        if (!block) return null;
        const k = 'b' + bi;
        let m: RegExpExecArray | null;
        if ((m = H1.exec(block))) return <Text key={k} style={ab.h1}>{inline(m[1], k, onMention, onHashtag)}</Text>;
        if ((m = H2.exec(block))) return <Text key={k} style={ab.h2}>{inline(m[1], k, onMention, onHashtag)}</Text>;
        if ((m = IMG.exec(block))) {
          return (
            <View key={k} style={ab.figure}>
              <ExpoImage source={{ uri: m[2] }} style={ab.figureImg} contentFit="cover" />
              {m[1] ? <Text style={ab.caption}>{m[1]}</Text> : null}
            </View>
          );
        }
        if (RULE.test(block)) return <View key={k} style={ab.rule} />;
        if (block.split('\n').every((l) => BULLET_LINE.test(l))) {
          const items = block.split('\n').map((l) => BULLET_LINE.exec(l)![1]);
          return (
            <View key={k} style={ab.list}>
              {items.map((item, ii) => (
                <View key={ii} style={ab.listRow}>
                  <Text style={ab.listBullet}>{'\u2022'}</Text>
                  <Text style={ab.listText}>{inline(item, k + 'i' + ii, onMention, onHashtag)}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.split('\n').every((l) => NUMBERED_LINE.test(l))) {
          const items = block.split('\n').map((l) => NUMBERED_LINE.exec(l)![1]);
          return (
            <View key={k} style={ab.list}>
              {items.map((item, ii) => (
                <View key={ii} style={ab.listRow}>
                  <Text style={ab.listNum}>{ii + 1}.</Text>
                  <Text style={ab.listText}>{inline(item, k + 'i' + ii, onMention, onHashtag)}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.split('\n').every((l) => QUOTE.test(l))) {
          const inner = block.split('\n').map((l) => (QUOTE.exec(l) ?? ['', ''])[1]).join('\n');
          return (
            <View key={k} style={ab.quoteWrap}>
              <Text style={ab.quote}>{inline(inner, k, onMention, onHashtag)}</Text>
            </View>
          );
        }
        const lines = block.split('\n');
        return (
          <Text key={k} style={ab.p}>
            {lines.map((l, li) => (
              <Text key={li}>
                {inline(l, k + 'l' + li, onMention, onHashtag)}
                {li < lines.length - 1 ? '\n' : ''}
              </Text>
            ))}
          </Text>
        );
      })}
    </View>
  );
}

const ab = StyleSheet.create({
  h1: { marginTop: 22, fontSize: 21, fontWeight: '800', color: NAVY, lineHeight: 27 },
  h2: { marginTop: 18, fontSize: 17, fontWeight: '700', color: NAVY, lineHeight: 23 },
  p: { marginTop: 14, fontSize: 16, lineHeight: 25, color: 'rgba(11,30,61,0.88)' },
  bold: { fontWeight: '700', color: NAVY },
  italic: { fontStyle: 'italic' },
  link: { color: '#2563EB', textDecorationLine: 'underline' },
  quoteWrap: { marginTop: 14, borderLeftWidth: 3, borderLeftColor: PEARL, paddingLeft: 14 },
  quote: { fontSize: 16, lineHeight: 24, fontStyle: 'italic', color: 'rgba(11,30,61,0.7)' },
  figure: { marginTop: 18, marginBottom: 4 },
  figureImg: { width: '100%', height: 220, borderRadius: 14, backgroundColor: '#F2F3F5' },
  caption: { marginTop: 6, textAlign: 'center', fontSize: 12.5, color: 'rgba(11,30,61,0.5)' },
  rule: { marginTop: 22, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(11,30,61,0.15)' },
  list: { marginTop: 14 },
  listRow: { flexDirection: 'row', marginTop: 6 },
  listBullet: { width: 18, fontSize: 16, color: NAVY, lineHeight: 25 },
  listNum: { width: 22, fontSize: 16, fontWeight: '700', color: NAVY, lineHeight: 25 },
  listText: { flex: 1, fontSize: 16, lineHeight: 25, color: 'rgba(11,30,61,0.88)' },
  mention: { color: NAVY, fontWeight: '700' },
  hashtag: { color: '#2563EB', fontWeight: '700' },
});
