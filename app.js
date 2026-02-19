'use strict';

/**
 * Verb-Drill — Phase switchable (Phase 1 & Phase 2 ready)
 * - 20 verbs per session (random sample)
 * - For each verb:
 *   - pronouns: ich, du, er, sie(3sg), es, Sie (6)
 *   - PLUS noun3sg (1) => total 7 questions per verb
 * - 4-choice answers (forms from the same verb)
 * - Templates JSON:
 *   - ich templates: {subject:"ich", verb_infinitive, text}
 *   - noun templates: {subject_type:"noun", person_key:"er|sie|es", subject_text, verb_infinitive, text}
 * - Rule:
 *   - sie(3sg) pronoun must not be sentence-initial -> auto rearrange when needed
 */

const DATA_BY_PHASE = {
  1: { verbsUrl: './data/verbs_phase1.json', templatesUrl: './data/templates_phase1.json' },
  2: { verbsUrl: './data/verbs_phase2.json', templatesUrl: './data/templates_phase2.json' },
  3: { verbsUrl: './data/verbs_phase3.json', templatesUrl: './data/templates_phase3.json' } // future
};

const PERSONS_BASE = ['ich', 'du', 'er', 'sie', 'es', 'Sie']; // singular pronouns
const PERSONS_3SG = ['er', 'sie', 'es'];                     // for noun template selection
const QUESTIONS_PER_VERB = PERSONS_BASE.length + 1;          // + noun3sg => 7
const SESSION_VERB_COUNT = 20;

let state = {
  phase: 1,
  verbs: [],
  templates: [],
  sessionVerbIds: [],
  queue: [],            // [{verbId, type:'pronoun'|'noun3sg', person? }]
  current: null,
  setIndex: 0,
  withinSetIndex: 0,
  correctCount: 0,
  totalCount: 0,
  locked: false
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const startBtn = $('startBtn');
const resetBtn = $('resetBtn');
const nextBtn = $('nextBtn');

const phase1Btn = $('phase1Btn');
const phase2Btn = $('phase2Btn');
const phase3Btn = $('phase3Btn');

const meta = $('meta');
const setInfo = $('setInfo');
const qInfo = $('qInfo');
const scoreInfo = $('scoreInfo');
const sentenceEl = $('sentence');
const choicesEl = $('choices');
const feedbackEl = $('feedback');

// ---------- Utils ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sample(arr, n) { return shuffle(arr).slice(0, Math.min(n, arr.length)); }
function uniq(arr) { return [...new Set(arr)]; }

function setFeedback(msg, kind) {
  feedbackEl.textContent = msg || '';
  feedbackEl.className = 'feedback' + (kind ? ` ${kind}` : '');
}
function disableChoices(disabled) {
  [...choicesEl.querySelectorAll('button')].forEach(btn => btn.disabled = disabled);
}

// ---------- Data loading ----------
async function loadDataForPhase(phase) {
  const conf = DATA_BY_PHASE[phase];
  if (!conf) throw new Error(`Unknown phase: ${phase}`);

  const [verbsRes, templatesRes] = await Promise.all([
    fetch(conf.verbsUrl, { cache: 'no-store' }),
    fetch(conf.templatesUrl, { cache: 'no-store' })
  ]);

  if (!verbsRes.ok) throw new Error('verbs JSON load failed');
  if (!templatesRes.ok) throw new Error('templates JSON load failed');

  const verbsJson = await verbsRes.json();
  const templatesJson = await templatesRes.json();

  state.verbs = verbsJson.verbs || [];
  state.templates = templatesJson.templates || [];
}

function findVerbById(id) {
  return state.verbs.find(v => v.id === id);
}

// ---------- Session building ----------
function buildSession() {
  const phaseVerbs = state.verbs.filter(v => v.phase === state.phase);
  const picked = sample(phaseVerbs, SESSION_VERB_COUNT);
  state.sessionVerbIds = picked.map(v => v.id);

  state.queue = [];
  state.sessionVerbIds.forEach(verbId => {
    const personsShuffled = shuffle(PERSONS_BASE);
    personsShuffled.forEach(person => state.queue.push({ verbId, type: 'pronoun', person }));
    state.queue.push({ verbId, type: 'noun3sg' });
  });

  state.correctCount = 0;
  state.totalCount = 0;
  state.setIndex = 0;
  state.withinSetIndex = 0;
  state.current = null;
  state.locked = false;
  updateHeader();
}

function computeSetIndices(queueIndex) {
  const setIndex = Math.floor(queueIndex / QUESTIONS_PER_VERB);
  const within = queueIndex % QUESTIONS_PER_VERB;
  return { setIndex, within };
}

function updateHeader() {
  meta.textContent = `Phase: ${state.phase}`;
  const setNo = state.setIndex + 1;
  const qNo = state.totalCount + 1;
  setInfo.textContent = `${setNo}/${SESSION_VERB_COUNT}`;
  qInfo.textContent = `${qNo}/${SESSION_VERB_COUNT * QUESTIONS_PER_VERB}`;
  scoreInfo.textContent = `${state.correctCount}/${state.totalCount}`;
}

// ---------- Templates: choose ich template then derive pronoun template ----------
function pickIchTemplateText(verb) {
  const candidates = state.templates.filter(t =>
    t.phase === state.phase &&
    t.subject === 'ich' &&
    t.verb_infinitive === verb.infinitive
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)].text;
}

function derivePronounTemplateFromIch(ichText, person) {
  let s = ichText;

  // sentence-initial "Ich"
  if (/^Ich\b/.test(s)) {
    if (person === 'ich') s = s.replace(/^Ich\b/, 'Ich');
    else if (person === 'du') s = s.replace(/^Ich\b/, 'Du');
    else if (person === 'er') s = s.replace(/^Ich\b/, 'Er');
    else if (person === 'es') s = s.replace(/^Ich\b/, 'Es');
    else if (person === 'Sie') s = s.replace(/^Ich\b/, 'Sie'); // formal Sie
    else if (person === 'sie') s = s.replace(/^Ich\b/, 'sie'); // temporary, will be fixed
  }

  // replace standalone "ich" (word boundary)
  if (person !== 'ich') {
    const repl = (person === 'Sie') ? 'Sie' : person;
    s = s.replace(/\bich\b/g, repl);
  }

  // 3sg pronoun "sie" must not be sentence-initial
  if (person === 'sie') s = fixSentenceInitialSie(s);

  return s;
}

function fixSentenceInitialSie(text) {
  const m = text.match(/^(sie|Sie)\s+___\s+(.*)$/);
  if (m) {
    const rest = m[2].trim();
    return `Heute ___ sie ${rest}`;
  }
  if (/^(sie|Sie)\b/.test(text)) {
    const tail = text.replace(/^(sie|Sie)\b\s*/, '').trim();
    if (tail.includes('___')) return `Heute ${tail}`;
  }
  return text;
}

function pickSentenceTemplateForPronoun(verb, person) {
  const ichText = pickIchTemplateText(verb);

  if (ichText) {
    if (person === 'sie') {
      const candidates = state.templates.filter(t =>
        t.phase === state.phase &&
        t.subject === 'ich' &&
        t.verb_infinitive === verb.infinitive &&
        !/^Ich\b/.test(t.text.trim())
      );
      const chosen = (candidates.length > 0)
        ? candidates[Math.floor(Math.random() * candidates.length)].text
        : ichText;

      return derivePronounTemplateFromIch(chosen, person);
    }

    return derivePronounTemplateFromIch(ichText, person);
  }

  // absolute fallback
  if (person === 'sie') return 'Heute ___ sie.';
  if (person === 'Sie') return 'Heute ___ Sie.';
  const cap = person[0].toUpperCase() + person.slice(1);
  return `${cap} ___ heute.`;
}

// ---------- noun3sg templates ----------
function pickNoun3sgTemplate(verb) {
  const candidates = state.templates.filter(t =>
    t.phase === state.phase &&
    t.subject_type === 'noun' &&
    t.verb_infinitive === verb.infinitive &&
    PERSONS_3SG.includes(t.person_key)
  );
  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const fallbackByKey = {
    er: { subject_text: 'der Mann', text: 'Heute ___ der Mann zu Hause.' },
    sie: { subject_text: 'die Frau', text: 'Heute ___ die Frau zu Hause.' },
    es: { subject_text: 'das Kind', text: 'Heute ___ das Kind zu Hause.' }
  };
  const key = PERSONS_3SG[Math.floor(Math.random() * PERSONS_3SG.length)];
  return {
    id: 'fallback_noun',
    phase: state.phase,
    subject_type: 'noun',
    person_key: key,
    subject_text: fallbackByKey[key].subject_text,
    verb_infinitive: verb.infinitive,
    text: fallbackByKey[key].text
  };
}

function renderSentence(templateText, chosenForm) {
  return templateText.replace('___', chosenForm);
}

// ---------- Choices generation ----------
function buildChoices(verb, answerPersonKey) {
  const forms = verb.present_sg;
  const correct = forms[answerPersonKey];

  const otherPersons = PERSONS_BASE.filter(p => p !== answerPersonKey);
  const distractors = shuffle(otherPersons)
    .map(p => forms[p])
    .filter(f => f && f !== correct);

  const options = [correct, ...distractors];
  const uniqueOptions = uniq(options);

  let i = 0;
  while (uniqueOptions.length < 4 && i < otherPersons.length) {
    const f = forms[otherPersons[i++]];
    if (f && !uniqueOptions.includes(f)) uniqueOptions.push(f);
  }

  const commonWrong = [
    correct.replace(/e$/, ''),
    correct + 't',
    correct + 'st'
  ].filter(f => f && f !== correct);

  i = 0;
  while (uniqueOptions.length < 4 && i < commonWrong.length) {
    if (!uniqueOptions.includes(commonWrong[i])) uniqueOptions.push(commonWrong[i]);
    i++;
  }

  return { correct, choices: shuffle(uniqueOptions.slice(0, 4)) };
}

// ---------- Question flow ----------
function nextQuestion() {
  setFeedback('', null);
  nextBtn.disabled = true;

  const queueIndex = state.totalCount;
  if (queueIndex >= state.queue.length) {
    sentenceEl.textContent = 'Fertig! 🎉';
    choicesEl.innerHTML = '';
    setFeedback(`Score: ${state.correctCount}/${state.totalCount}`, 'ok');
    startBtn.disabled = false;
    return;
  }

  const { setIndex, within } = computeSetIndices(queueIndex);
  state.setIndex = setIndex;
  state.withinSetIndex = within;

  const item = state.queue[queueIndex];
  const verb = findVerbById(item.verbId);

  let answerPersonKey;
  let templateText;
  let label;

  if (item.type === 'pronoun') {
    answerPersonKey = item.person;
    templateText = pickSentenceTemplateForPronoun(verb, item.person);
    label = `${verb.infinitive} · ${item.person}`;
  } else {
    const nounTpl = pickNoun3sgTemplate(verb);
    answerPersonKey = nounTpl.person_key;
    templateText = nounTpl.text;
    label = `${verb.infinitive} · ${nounTpl.subject_text}`;
  }

  const { correct, choices } = buildChoices(verb, answerPersonKey);

  state.current = {
    verb,
    type: item.type,
    answerPersonKey,
    templateText,
    sentenceWithBlank: templateText,
    sentenceWithAnswer: renderSentence(templateText, correct),
    correct,
    choices,
    label
  };

  renderCurrent();
  updateHeader();
}

function renderCurrent() {
  const c = state.current;
  if (!c) return;

  sentenceEl.textContent = c.sentenceWithBlank + `  (${c.label})`;

  choicesEl.innerHTML = '';
  c.choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = choice;
    btn.addEventListener('click', () => onChoose(choice));
    choicesEl.appendChild(btn);
  });

  state.locked = false;
  disableChoices(false);
}

function onChoose(choice) {
  if (state.locked) return;
  state.locked = true;
  disableChoices(true);

  const c = state.current;
  const ok = (choice === c.correct);

  if (ok) {
    state.correctCount += 1;
    setFeedback('Richtig ✓', 'ok');
  } else {
    setFeedback(`Falsch ✗  → ${c.correct}`, 'ng');
  }

  sentenceEl.textContent = c.sentenceWithAnswer + `  (${c.label})`;

  state.totalCount += 1;
  scoreInfo.textContent = `${state.correctCount}/${state.totalCount}`;
  nextBtn.disabled = false;
}

// ---------- Controls ----------
function start() {
  startBtn.disabled = true;
  buildSession();
  nextQuestion();
}
function reset() { window.location.reload(); }

// Phase switch: load JSON and reset to Start
async function setPhase(p) {
  state.phase = p;

  [phase1Btn, phase2Btn, phase3Btn].forEach(btn => btn.classList.remove('active'));
  if (p === 1) phase1Btn.classList.add('active');
  if (p === 2) phase2Btn.classList.add('active');
  if (p === 3) phase3Btn.classList.add('active');

  meta.textContent = `Phase: ${state.phase}`;

  setFeedback('データ読み込み中…', null);
  startBtn.disabled = true;
  nextBtn.disabled = true;

  try {
    await loadDataForPhase(state.phase);

    // Reset state and wait for Start
    state.sessionVerbIds = [];
    state.queue = [];
    state.current = null;
    state.correctCount = 0;
    state.totalCount = 0;
    state.setIndex = 0;
    state.withinSetIndex = 0;
    state.locked = false;

    sentenceEl.textContent = 'Start drücken';
    choicesEl.innerHTML = '';
    setFeedback('', null);

    startBtn.disabled = false;
    updateHeader();
  } catch (e) {
    console.error(e);
    setFeedback('データ読み込みに失敗しました（JSONファイル名/パスを確認）', 'ng');
  }
}

// ---------- Init ----------
async function init() {
  setFeedback('データ読み込み中…', null);
  try {
    await loadDataForPhase(state.phase);
    setFeedback('', null);
  } catch (e) {
    console.error(e);
    setFeedback('データ読み込みに失敗しました（Live Server / GitHub Pages で開いてください）', 'ng');
    return;
  }

  startBtn.addEventListener('click', start);
  nextBtn.addEventListener('click', nextQuestion);
  resetBtn.addEventListener('click', reset);

  phase1Btn.addEventListener('click', () => setPhase(1));

  phase2Btn.disabled = false;
  phase2Btn.addEventListener('click', () => setPhase(2));

  // Phase3: later enable when JSON exists
  // phase3Btn.disabled = false;
  // phase3Btn.addEventListener('click', () => setPhase(3));
}

init();
