/* ============================================================
 * voice.js — webkitSpeechRecognition（中文）+ speechSynthesis（zh-CN）
 * 无麦克风时全部能力仍可通过输入框与按钮使用。
 * ============================================================ */
(function (global) {
  'use strict';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognitionSupported = !!SR;

  let recognition = null;
  let listening = false;

  function ensureRec() {
    if (recognition || !SR) return recognition;
    recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    return recognition;
  }

  function listen(handlers) {
    if (!recognitionSupported) { handlers.onError && handlers.onError('unsupported'); return false; }
    ensureRec();
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      handlers.onResult && handlers.onResult(text);
    };
    recognition.onerror = (e) => {
      listening = false;
      handlers.onError && handlers.onError(e.error);
    };
    recognition.onend = () => {
      listening = false;
      handlers.onEnd && handlers.onEnd();
    };
    try {
      recognition.start();
      listening = true;
    } catch (e) {
      listening = false;
      handlers.onError && handlers.onError('start-failed');
    }
    return true;
  }
  function stopListen() {
    if (recognition && listening) { try { recognition.stop(); } catch (e) {} }
    listening = false;
  }

  /* ---------- 语音合成 ---------- */
  let zhVoice = null;
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    zhVoice =
      voices.find((v) => v.lang === 'zh-CN') ||
      voices.find((v) => v.lang && v.lang.toLowerCase().indexOf('zh') === 0) ||
      null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    // addEventListener 避免覆盖其他处理器（onvoiceschanged 直接赋值会互相顶掉）
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  const ttsSupported = 'speechSynthesis' in window;

  /* 单条 utterance 过长会被浏览器截断，按标点分句后合并为 <200 字的段 */
  const TTS_MAX_CHARS = 200;
  const TTS_SENT_ENDS = '。！？!?；;，,、\n';
  function splitSegments(text, maxLen) {
    const sentences = [];
    let buf = '';
    for (const ch of String(text)) {
      buf += ch;
      if (TTS_SENT_ENDS.indexOf(ch) >= 0) { sentences.push(buf); buf = ''; }
    }
    if (buf) sentences.push(buf);

    const segs = [];
    let cur = '';
    for (let s of sentences) {
      // 单句仍超长时硬切，保证每段 < maxLen
      while (s.length > maxLen) {
        if (cur) { segs.push(cur); cur = ''; }
        segs.push(s.slice(0, maxLen));
        s = s.slice(maxLen);
      }
      if ((cur + s).length > maxLen) {
        if (cur) segs.push(cur);
        cur = s;
      } else {
        cur += s;
      }
    }
    if (cur) segs.push(cur);
    return segs;
  }

  /* 串行播报队列：cancel 后立即 speak 在部分浏览器偶发丢句，
     故延迟入队，并逐段 speak 串行播放，全部结束后再回调 onEnd。 */
  let speakQueue = [];
  let speaking = false;
  let speakEndCb = null;

  function speak(text, onEnd) {
    if (!ttsSupported || !text) { onEnd && onEnd(); return; }
    speechSynthesis.cancel(); // 打断旧播报
    speakQueue = splitSegments(text, TTS_MAX_CHARS);
    // 顶掉未完成的播报时先释放旧回调，避免回调丢失
    if (speaking && speakEndCb) { const old = speakEndCb; speakEndCb = null; old(); }
    speakEndCb = onEnd || null;
    speaking = true;
    setTimeout(pumpSpeak, 80); // cancel 后延迟入队，规避丢句
  }

  function pumpSpeak() {
    if (!speaking) return;
    if (!speakQueue.length) {
      speaking = false;
      const cb = speakEndCb;
      speakEndCb = null;
      if (cb) cb();
      return;
    }
    const u = new SpeechSynthesisUtterance(speakQueue.shift());
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = 1.05; u.pitch = 1; u.volume = 1;
    let done = false;
    const next = () => {
      if (done) return;
      done = true;
      if (!speaking) return; // 已被 cancelSpeak 取消
      setTimeout(pumpSpeak, 40); // 串行播放下一段
    };
    u.onend = next;
    u.onerror = next;
    speechSynthesis.speak(u);
  }

  function cancelSpeak() {
    speakQueue = [];
    speaking = false;
    speakEndCb = null;
    if (ttsSupported) speechSynthesis.cancel();
  }

  global.Voice = {
    recognitionSupported, ttsSupported,
    isListening: () => listening,
    listen, stopListen, speak, cancelSpeak,
  };
})(window);
