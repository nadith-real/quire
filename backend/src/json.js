export function extractJson(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty model response");
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model did not return JSON");
  }
  return parseLoose(raw.slice(start, end + 1));
}

export function parseLoose(input) {
  const attempts = [input, repairJson(input)];
  let lastErr;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Invalid JSON");
}

export function repairJson(text) {
  let s = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");

  s = quoteBareKeys(s);
  s = escapeBrokenStrings(s);
  s = s.replace(/,\s*([}\]])/g, "$1");
  s = balance(s);
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s;
}

function quoteBareKeys(s) {
  return s.replace(/([,{[]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}

function isValueEnd(ch) {
  return ch === "," || ch === "}" || ch === "]" || ch === ":" || ch === undefined;
}

function escapeBrokenStrings(s) {
  let out = "";
  let inStr = false;
  let escape = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }

    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      if (isValueEnd(s[j])) {
        out += '"';
        inStr = false;
      } else {
        out += '\\"';
      }
      continue;
    }

    out += ch;
  }

  if (inStr) out += '"';
  return out;
}

function balance(s) {
  const stack = [];
  let inStr = false;
  let escape = false;
  for (const ch of s) {
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.length && stack[stack.length - 1] === ch) stack.pop();
    }
  }
  if (inStr) s += '"';
  return s + stack.reverse().join("");
}
