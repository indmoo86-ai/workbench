import {Converter} from './vendor/opencc-t2cn.js';

// Vendored browser build of the already installed opencc-js 1.4.2; no CDN or model request.
const convert = Converter({from:'t',to:'cn'});
const protectedText = /(`+)[^\n]*?\1|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019|\u300c[^\u300d]*\u300d|\u300e[^\u300f]*\u300f|https?:\/\/[^\s<>]+|\]\([^\n)]*\)/g;
const token = /[^\s\u3000\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f<>`]+/g;
const command = /^\s*(?:[$>]\s+|(?:sudo|env|git|cat|rg|grep|find|sed|awk|echo|printf|python\d*|node|npm|npx|pnpm|yarn|bash|sh|zsh|curl|wget|ssh|scp|rsync|docker|kubectl|systemctl|apt(?:-get)?|pip\d*|claude|grok|agy|codex|mkdir|rm|mv|cp|chmod|chown|touch|ls|cd|pwd|test|export|source|make|cmake|gradle|gradlew|mvn|cargo|go|dotnet|composer|uv|java|javac|ruby|perl|powershell|pwsh|pytest|const|let|var|function|class|import)\b|[A-Za-z_][\w]*=|[{}\[\]]|#!)/;

/** Convert only a display copy of CLI prose; keep quoted input, executable text and resource identifiers exact. */
export function simplifiedCliOutput(text) {
  if (typeof text !== 'string' || !text) return text;
  let fence = null;
  const prose = value => value.replace(token, part => /[._/@=\\]/.test(part) ? part : convert(part));
  return text.match(/[^\n]*\n|[^\n]+$/g).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      const value = marker[1];
      if (!fence) fence = value;
      else if (value[0] === fence[0] && value.length >= fence.length) fence = null;
      return line;
    }
    const markdownLink = /^\s*\[[^\]\n]+\]\(/.test(line);
    if (fence || /^(?: {4}|\t|\s*>)/.test(line) || !markdownLink && command.test(line)) return line;
    let offset = 0, result = '';
    for (const match of line.matchAll(protectedText)) {
      result += prose(line.slice(offset, match.index)) + match[0];
      offset = match.index + match[0].length;
    }
    return result + prose(line.slice(offset));
  }).join('');
}
