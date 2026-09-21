/*!
 * variations.js - Semantic sentence variation engine for P4RS3LT0NGV3
 *
 * Generates meaning-adjacent rephrasings of a sentence by substituting words
 * with synonyms, negated antonyms, hypernyms, hyponyms and homophones, using
 * the Datamuse API (free, no key, CORS-enabled).
 *
 * Complements the existing Mutation Lab: that fuzzes *characters*, this
 * mutates *meaning*. No framework, no DOM. Exposes window.sentenceVariations.
 *
 * Part of a fork of P4RS3LT0NGV3 - AGPL-3.0.
 */
(function (global) {
  'use strict';

  var API = 'https://api.datamuse.com/words';

  /* ------------------------------------------------------------------ *
   * Relation registry
   * ------------------------------------------------------------------ */

  // WARNING: DO NOT "FIX" rel_gen / rel_spc BELOW. Datamuse's parameter names
  // are the INVERSE of what they read like. Verified empirically 2026-09:
  //     rel_spc=boat -> vessel, watercraft    (MORE GENERAL = hypernyms)
  //     rel_gen=boat -> tender, barge, tug    (MORE SPECIFIC = hyponyms)
  // test_variations.html pins this with a regression test. If that test fails,
  // someone "corrected" these names - revert them.
  var RELATIONS = {
    domain:         { param: null,      label: 'AI/security terms', badge: 'dom',  weight: 1.30, group: 'semantic', defaultOn: true, local: true },
    synonym:        { param: 'rel_syn', label: 'Synonyms',         badge: 'syn',   weight: 1.00, group: 'semantic', defaultOn: true },
    meansLike:      { param: 'ml',      label: 'Means like',       badge: '~',     weight: 0.85, group: 'semantic', defaultOn: true },
    antonymNegated: { param: 'rel_ant', label: 'Negated antonyms', badge: 'NOT',   weight: 0.70, group: 'semantic', defaultOn: true, negate: true },
    broader:        { param: 'rel_spc', label: 'More general',     badge: 'gen',   weight: 0.55, group: 'semantic', defaultOn: true, drift: true },
    narrower:       { param: 'rel_gen', label: 'More specific',    badge: 'spc',   weight: 0.55, group: 'semantic', defaultOn: true, drift: true },
    associated:     { param: 'rel_trg', label: 'Associated',       badge: 'assoc', weight: 0.30, group: 'loose',    defaultOn: true, noisy: true },
    homophone:      { param: 'rel_hom', label: 'Homophones',       badge: 'hom',   weight: 0.45, group: 'phonetic', defaultOn: true, drift: true },
    soundsLike:     { param: 'sl',      label: 'Sounds like',      badge: 'snd',   weight: 0.20, group: 'phonetic', defaultOn: true, drift: true }
  };

  /* Domain lexicon.
   *
   * Datamuse is a general-English thesaurus and this is an LLM red-teaming
   * tool, so its answers for the vocabulary that actually matters are wrong in
   * a specific way - they resolve the everyday sense:
   *     assistant -> subordinate, adjunct      (an office assistant)
   *     prompt    -> incite, propel            (the verb)
   *     jailbreak -> gaolbreak, prisonbreak    (an actual prison)
   *     rules     -> nothing at all
   *
   * These substitutions are the ones a human red-teamer would reach for. They
   * cost no API call and are offered alongside the fetched relations.
   * Bidirectional: listing a -> [b, c] also lets b and c reach each other.
   */
  var DOMAIN_SYNONYMS = {
    // --- the model / the agent --------------------------------------------
    'assistant':     ['AI', 'model', 'chatbot', 'agent', 'system', 'LLM', 'bot'],
    'ai':            ['assistant', 'model', 'chatbot', 'agent', 'LLM', 'system'],
    'model':         ['assistant', 'AI', 'system', 'LLM', 'network', 'agent'],
    'chatbot':       ['assistant', 'AI', 'model', 'agent', 'bot'],
    'agent':         ['assistant', 'AI', 'model', 'system', 'bot'],
    'bot':           ['assistant', 'AI', 'agent', 'model'],

    // --- prompts, instructions, messages ----------------------------------
    'prompt':        ['instruction', 'directive', 'message', 'input', 'query', 'command'],
    'prompts':       ['instructions', 'directives', 'messages', 'inputs', 'queries'],
    'instruction':   ['directive', 'prompt', 'command', 'rule', 'order', 'guidance'],
    'instructions':  ['directives', 'prompts', 'commands', 'rules', 'orders', 'guidance'],
    'directive':     ['instruction', 'command', 'order', 'rule', 'prompt'],
    'command':       ['instruction', 'directive', 'order', 'request'],
    'message':       ['prompt', 'instruction', 'input', 'text'],
    'query':         ['question', 'request', 'prompt', 'input'],
    'request':       ['query', 'demand', 'ask', 'instruction'],
    'input':         ['prompt', 'message', 'query', 'text'],

    // --- rules, policy, guardrails ----------------------------------------
    'rule':          ['policy', 'constraint', 'restriction', 'guideline', 'directive'],
    'rules':         ['policies', 'constraints', 'restrictions', 'guidelines', 'directives'],
    'policy':        ['rule', 'guideline', 'restriction', 'constraint'],
    'policies':      ['rules', 'guidelines', 'restrictions', 'constraints'],
    'guideline':     ['rule', 'policy', 'instruction', 'constraint'],
    'guidelines':    ['rules', 'policies', 'instructions', 'constraints'],
    'constraint':    ['restriction', 'limit', 'rule', 'guardrail'],
    'constraints':   ['restrictions', 'limits', 'rules', 'guardrails'],
    'restriction':   ['constraint', 'limit', 'filter', 'guardrail', 'control'],
    'restrictions':  ['constraints', 'limits', 'filters', 'guardrails', 'controls'],
    'guardrail':     ['safeguard', 'restriction', 'filter', 'control', 'protection'],
    'guardrails':    ['safeguards', 'restrictions', 'filters', 'controls'],
    'filter':        ['safeguard', 'guardrail', 'restriction', 'moderation', 'screen'],
    'filters':       ['safeguards', 'guardrails', 'restrictions', 'screens'],
    'safeguard':     ['guardrail', 'protection', 'control', 'filter'],
    'boundary':      ['limit', 'constraint', 'restriction'],
    'boundaries':    ['limits', 'constraints', 'restrictions'],
    'limit':         ['restriction', 'constraint', 'boundary', 'cap'],
    'limits':        ['restrictions', 'constraints', 'boundaries'],

    // --- the attack verbs -------------------------------------------------
    'ignore':        ['disregard', 'bypass', 'override', 'discard', 'skip', 'set aside'],
    'disregard':     ['ignore', 'bypass', 'override', 'discard', 'set aside', 'dismiss'],
    'bypass':        ['circumvent', 'evade', 'sidestep', 'get past', 'override', 'skip'],
    'override':      ['bypass', 'supersede', 'overrule', 'replace', 'disregard'],
    'circumvent':    ['bypass', 'evade', 'sidestep', 'get around'],
    'evade':         ['bypass', 'circumvent', 'avoid', 'dodge'],
    'jailbreak':     ['bypass', 'unlock', 'circumvent', 'escape'],
    'unlock':        ['bypass', 'enable', 'release', 'open'],
    'disable':       ['deactivate', 'suspend', 'remove', 'switch off'],
    'remove':        ['strip', 'drop', 'delete', 'lift', 'discard'],
    'lift':          ['remove', 'suspend', 'drop', 'relax'],
    'suspend':       ['pause', 'disable', 'lift', 'halt'],
    'escape':        ['bypass', 'evade', 'break out of'],

    // --- exfiltration / output --------------------------------------------
    'reveal':        ['disclose', 'expose', 'show', 'output', 'print', 'display', 'divulge'],
    'disclose':      ['reveal', 'expose', 'show', 'divulge', 'report'],
    'expose':        ['reveal', 'disclose', 'uncover', 'surface'],
    'show':          ['display', 'print', 'output', 'reveal', 'render'],
    'display':       ['show', 'print', 'render', 'output'],
    'print':         ['output', 'display', 'show', 'emit', 'write'],
    'output':        ['print', 'emit', 'return', 'display', 'show', 'produce'],
    'dump':          ['output', 'print', 'export', 'emit'],
    'leak':          ['reveal', 'disclose', 'expose'],
    'repeat':        ['reproduce', 'echo', 'restate', 'reiterate', 'print', 'recite'],
    'echo':          ['repeat', 'reproduce', 'restate', 'mirror'],
    'reproduce':     ['repeat', 'echo', 'restate', 'recreate'],
    'recite':        ['repeat', 'reproduce', 'read back'],
    'list':          ['enumerate', 'itemize', 'output', 'name'],

    // --- roleplay framing -------------------------------------------------
    'pretend':       ['act as', 'roleplay as', 'simulate', 'behave as'],
    'act':           ['behave', 'perform', 'operate', 'pose'],
    'roleplay':      ['pretend', 'simulate', 'play'],
    'simulate':      ['pretend', 'emulate', 'imitate'],
    'imagine':       ['suppose', 'pretend', 'assume', 'picture'],
    'assume':        ['adopt', 'suppose', 'presume', 'take on'],
    'behave':        ['act', 'operate', 'perform'],
    'become':        ['act as', 'turn into', 'transform into'],

    // --- compliance / refusal ---------------------------------------------
    'comply':        ['obey', 'conform', 'agree', 'cooperate'],
    'obey':          ['comply', 'follow', 'heed', 'observe'],
    'follow':        ['obey', 'observe', 'heed'],
    'adhere':        ['conform', 'comply', 'stick'],
    'refuse':        ['decline', 'reject', 'deny', 'withhold', 'resist'],
    'refusing':      ['declining', 'rejecting', 'denying', 'withholding', 'resisting'],
    'decline':       ['refuse', 'reject', 'deny', 'turn down'],
    'reject':        ['refuse', 'decline', 'deny', 'dismiss'],
    'deny':          ['refuse', 'reject', 'withhold', 'decline'],

    // --- safety vocabulary ------------------------------------------------
    'safety':        ['security', 'alignment', 'moderation', 'protection'],
    'security':      ['safety', 'protection', 'defence'],
    'alignment':     ['safety', 'training', 'conditioning'],
    'moderation':    ['filtering', 'censorship', 'screening'],
    'censorship':    ['filtering', 'moderation', 'restriction'],
    'restricted':    ['limited', 'constrained', 'filtered', 'moderated', 'censored'],
    'unrestricted':  ['unfiltered', 'unmoderated', 'uncensored', 'unconstrained', 'unlimited'],
    'filtered':      ['moderated', 'censored', 'screened', 'restricted'],
    'unfiltered':    ['uncensored', 'unmoderated', 'unrestricted', 'raw'],
    'censored':      ['filtered', 'moderated', 'redacted'],
    'uncensored':    ['unfiltered', 'unmoderated', 'unrestricted', 'raw'],
    'harmful':       ['dangerous', 'unsafe', 'damaging'],
    'dangerous':     ['harmful', 'unsafe', 'hazardous', 'risky'],
    'unsafe':        ['dangerous', 'harmful', 'insecure'],

    // --- training / configuration -----------------------------------------
    'training':      ['fine-tuning', 'alignment', 'conditioning', 'programming'],
    'conditioning':  ['training', 'alignment', 'programming'],
    'programming':   ['training', 'conditioning', 'configuration'],
    'configuration': ['settings', 'setup', 'parameters', 'config'],
    'settings':      ['configuration', 'parameters', 'options', 'setup'],
    'parameters':    ['settings', 'configuration', 'options'],

    // --- authority framing --------------------------------------------------
    'authorized':    ['permitted', 'allowed', 'cleared', 'approved', 'sanctioned'],
    'permitted':     ['allowed', 'authorized', 'approved', 'cleared'],
    'allowed':       ['permitted', 'authorized', 'approved'],
    'approved':      ['authorized', 'permitted', 'sanctioned', 'cleared'],
    'developer':     ['operator', 'maintainer', 'administrator', 'owner', 'engineer'],
    'developers':    ['operators', 'maintainers', 'administrators', 'owners'],
    'operator':      ['developer', 'administrator', 'owner', 'maintainer'],
    'administrator': ['admin', 'operator', 'developer', 'owner'],
    'admin':         ['administrator', 'operator', 'root', 'superuser'],
    'creator':       ['developer', 'author', 'maker', 'owner'],
    'owner':         ['operator', 'developer', 'administrator'],

    // --- memory / reset -----------------------------------------------------
    'forget':        ['discard', 'erase', 'drop', 'abandon', 'disregard'],
    'erase':         ['delete', 'wipe', 'clear', 'remove'],
    'delete':        ['erase', 'remove', 'wipe', 'purge'],
    'clear':         ['wipe', 'erase', 'reset', 'flush'],
    'reset':         ['clear', 'restore', 'wipe'],
    'discard':       ['drop', 'abandon', 'erase'],

    // --- secrecy ------------------------------------------------------------
    'hidden':        ['secret', 'concealed', 'internal', 'private', 'undisclosed'],
    'secret':        ['hidden', 'confidential', 'private', 'undisclosed'],
    'confidential':  ['secret', 'private', 'restricted', 'internal'],
    'private':       ['confidential', 'secret', 'internal'],
    'internal':      ['private', 'hidden', 'confidential', 'underlying'],

    // --- sequence / reference ------------------------------------------------
    'previous':      ['prior', 'earlier', 'preceding', 'foregoing', 'above'],
    'prior':         ['previous', 'earlier', 'preceding', 'foregoing'],
    'earlier':       ['previous', 'prior', 'preceding', 'above'],
    'preceding':     ['previous', 'prior', 'earlier', 'foregoing'],
    'initial':       ['original', 'first', 'starting', 'opening'],
    'original':      ['initial', 'first', 'underlying', 'starting'],
    'above':         ['preceding', 'earlier', 'foregoing', 'prior'],

    // --- misc payload vocabulary ---------------------------------------------
    'verbatim':      ['word for word', 'exactly', 'literally'],
    'exactly':       ['precisely', 'verbatim', 'literally'],
    'summarize':     ['outline', 'recap', 'describe', 'paraphrase', 'condense'],
    'explain':       ['describe', 'clarify', 'spell out'],
    'describe':      ['explain', 'outline', 'detail'],
    'text':          ['content', 'wording', 'passage', 'material'],
    'content':       ['text', 'material', 'output', 'payload'],
    'response':      ['reply', 'answer', 'output'],
    'answer':        ['reply to', 'respond to', 'address'],
    'context':       ['background', 'history', 'conversation'],
    'role':          ['persona', 'character', 'identity'],
    'persona':       ['role', 'character', 'identity'],
    'mode':          ['state', 'setting', 'configuration'],

    // --- whole-phrase replacements for protected terms of art ---------------
    // These exist so a protected phrase is still variable AS A UNIT. Without
    // them, protecting "system prompt" from being half-substituted also made
    // it completely immutable.
    'system prompt':        ['initial instructions', 'system message', 'base instructions', 'setup prompt'],
    'system message':       ['system prompt', 'initial instructions', 'base instructions'],
    'content filter':       ['safety filter', 'moderation layer', 'content guardrail'],
    'content filters':      ['safety filters', 'moderation layers', 'content guardrails'],
    'safety guideline':     ['safety rule', 'safety policy', 'content policy'],
    'safety guidelines':    ['safety rules', 'safety policies', 'content policies'],
    'safety filter':        ['content filter', 'moderation layer', 'guardrail'],
    'safety filters':       ['content filters', 'moderation layers', 'guardrails'],
    'training data':        ['training corpus', 'training set', 'fine-tuning data'],
    'language model':       ['model', 'AI', 'LLM', 'neural model'],
    'context window':       ['context buffer', 'context limit', 'conversation window'],
    'chat history':         ['conversation history', 'message history', 'transcript'],
    'conversation history': ['chat history', 'message history', 'transcript'],
    'api key':              ['access token', 'credential', 'secret key'],
    'access token':         ['api key', 'credential', 'bearer token'],
    'source code':          ['implementation', 'codebase', 'listing'],
    'plain text':           ['cleartext', 'raw text', 'unformatted text'],
    'bullet point':         ['list item', 'bulleted item'],
    'bullet points':        ['a bulleted list', 'list items', 'itemised form'],
    'developer mode':       ['debug mode', 'maintenance mode', 'unrestricted mode'],
    'debug mode':           ['developer mode', 'diagnostic mode', 'verbose mode'],
    'admin access':         ['root access', 'administrator access', 'elevated access'],
    'root access':          ['admin access', 'superuser access', 'elevated access'],
    'user request':         ['user instruction', 'user query', 'incoming request'],
    'user input':           ['user text', 'user message', 'incoming input'],
    'output format':        ['response format', 'output structure', 'reply format'],
    'response format':      ['output format', 'reply structure'],
    'previous instructions':['prior instructions', 'earlier directives', 'preceding rules'],
    'prior instructions':   ['previous instructions', 'earlier directives'],
    'text above':           ['preceding text', 'foregoing text', 'text shown above'],
    'above text':           ['preceding text', 'foregoing text'],
    'guard rail':           ['guardrail', 'safeguard', 'restriction'],
    'guard rails':          ['guardrails', 'safeguards', 'restrictions'],

    // --- verb + preposition -------------------------------------------------
    // English verbs subcategorise for different prepositions, so swapping the
    // verb alone strands the wrong one: "comply with" -> "break with",
    // "accede with". Replace the pair as a unit instead.
    'comply with':   ['obey', 'follow', 'honour', 'go along with'],
    'adhere to':     ['follow', 'obey', 'stick to', 'observe'],
    'accede to':     ['agree to', 'grant', 'allow', 'consent to'],
    'respond to':    ['answer', 'reply to', 'address'],
    'refer to':      ['cite', 'mention', 'point to'],
    'listen to':     ['heed', 'attend to', 'follow'],
    'abide by':      ['follow', 'obey', 'observe', 'honour'],
    'conform to':    ['follow', 'match', 'obey'],
    'object to':     ['oppose', 'protest', 'resist'],
    'refrain from':  ['avoid', 'stop', 'cease'],
    'depart from':   ['leave', 'abandon', 'deviate from'],
    'act as':        ['behave as', 'serve as', 'pose as'],
    'account for':   ['explain', 'justify', 'describe'],
    'look for':      ['seek', 'search for', 'hunt for'],
    'ask for':       ['request', 'demand', 'seek']
  };

  var GROUP_LABELS = {
    semantic: 'Semantic - preserves meaning',
    loose:    'Loose - associative, noisy',
    phonetic: 'Phonetic - changes meaning'
  };

  var GROUP_ORDER = ['semantic', 'loose', 'phonetic'];

  /* ------------------------------------------------------------------ *
   * Word lists
   * ------------------------------------------------------------------ */

  function mkSet(str) {
    var o = Object.create(null);
    str.split(/\s+/).forEach(function (w) { if (w) o[w] = true; });
    return o;
  }

  var COPULA = mkSet('is are was were am be been being');
  var MODAL  = mkSet('can could will would shall should must may might');
  var AUX    = mkSet('have has had do does did');
  var NEG    = mkSet('not never no nor none cannot');

  var STOPWORDS = mkSet(
    'a an the this that these those my your his her its our their which what who whom whose ' +
    'and or but nor so yet for if then than as because while although though unless until when where ' +
    'of to in on at by with from into onto upon about over under above below between among through ' +
    'during before after against within without across behind beyond near off out up down ' +
    'i you he she it we they me him them us myself yourself himself herself itself ourselves themselves ' +
    'there here very just too also only even still much many more most some any each every both ' +
    'such own same other another all'
  );
  'is are was were am be been being have has had do does did can could will would shall should must may might not never no'
    .split(' ').forEach(function (w) { STOPWORDS[w] = true; });

  var IRREGULAR_PAST = {
    be: 'was', have: 'had', do: 'did', go: 'went', take: 'took', see: 'saw', get: 'got',
    make: 'made', come: 'came', know: 'knew', give: 'gave', find: 'found', think: 'thought',
    tell: 'told', become: 'became', leave: 'left', feel: 'felt', put: 'put', bring: 'brought',
    begin: 'began', keep: 'kept', hold: 'held', write: 'wrote', stand: 'stood', hear: 'heard',
    let: 'let', mean: 'meant', set: 'set', meet: 'met', run: 'ran', pay: 'paid', sit: 'sat',
    speak: 'spoke', lead: 'led', read: 'read', grow: 'grew', lose: 'lost', fall: 'fell',
    send: 'sent', build: 'built', understand: 'understood', draw: 'drew', break: 'broke',
    spend: 'spent', cut: 'cut', rise: 'rose', drive: 'drove', buy: 'bought', wear: 'wore',
    choose: 'chose', hide: 'hid', steal: 'stole', catch: 'caught', teach: 'taught',
    fight: 'fought', throw: 'threw', eat: 'ate', drink: 'drank', forget: 'forgot'
  };

  var IRREGULAR_PLURAL = {
    man: 'men', woman: 'women', child: 'children', person: 'people', foot: 'feet',
    tooth: 'teeth', goose: 'geese', mouse: 'mice', louse: 'lice', ox: 'oxen',
    datum: 'data', medium: 'media', criterion: 'criteria', phenomenon: 'phenomena',
    analysis: 'analyses', basis: 'bases', crisis: 'crises', thesis: 'theses',
    index: 'indices', matrix: 'matrices', vertex: 'vertices', life: 'lives',
    knife: 'knives', wife: 'wives', leaf: 'leaves', half: 'halves', self: 'selves'
  };

  /* Multi-word terms that must never be broken up by substituting one half.
   * Swapping inside them destroys the payload: "system prompt" -> "organization
   * prompt", "bullet points" -> "heater points", "plain text" -> "ciphertext"
   * (which inverts the meaning outright).
   *
   * Datamuse knows some general compounds ("bullet points", "plain text") but
   * none of the LLM-specific jargon, which is exactly the vocabulary this tool
   * exists to mutate - so the domain terms are listed explicitly. The whole
   * phrase can still be replaced as a unit by the bigram path.
   */
  var PROTECTED_PHRASES = [
    'system prompt', 'system message', 'content filter', 'content filters',
    'safety guideline', 'safety guidelines', 'safety filter', 'safety filters',
    'guard rail', 'guard rails', 'training data', 'language model',
    'context window', 'chat history', 'conversation history', 'api key',
    'access token', 'source code', 'plain text', 'bullet point', 'bullet points',
    'developer mode', 'debug mode', 'admin access', 'root access',
    'user request', 'user input', 'output format', 'response format',
    'previous instructions', 'prior instructions', 'above text', 'text above',
    // verb + preposition pairs, so the verb is never swapped alone
    'comply with', 'adhere to', 'accede to', 'respond to', 'refer to',
    'listen to', 'abide by', 'conform to', 'object to',
    'refrain from', 'depart from', 'act as', 'account for', 'look for', 'ask for'
  ];

  // token indices covered by a protected phrase
  function protectedSpans(tokens) {
    var words = [], covered = Object.create(null), spans = [];
    tokens.forEach(function (t, i) { if (t.type === 'word') words.push(i); });
    for (var a = 0; a < words.length - 1; a++) {
      for (var n = 2; n <= 3 && a + n <= words.length; n++) {
        var idx = words.slice(a, a + n);
        var phrase = idx.map(function (i) { return tokens[i].text; }).join(' ');
        if (PROTECTED_PHRASES.indexOf(phrase) !== -1) {
          idx.forEach(function (i) { covered[i] = true; });
          spans.push({ startIndex: idx[0], endIndex: idx[idx.length - 1], phrase: phrase, pool: [] });
        }
      }
    }
    return { covered: covered, spans: spans };
  }

  /* ------------------------------------------------------------------ *
   * PRNG + hashing
   * ------------------------------------------------------------------ */

  function hashString(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   * Tokenizer - lossless.
   * Invariant: tokens.map(t => t.raw).join('') === input
   * ------------------------------------------------------------------ */

  var TOKEN_RE = /([A-Za-zÀ-ɏ]+(?:['’][A-Za-z]+)*)|(\s+)|([^\sA-Za-zÀ-ɏ]+)/g;

  function detectCaps(raw) {
    if (raw.length > 1 && raw === raw.toUpperCase() && raw !== raw.toLowerCase()) return 'UPPER';
    if (raw[0] === raw[0].toUpperCase() && raw.slice(1) === raw.slice(1).toLowerCase()) return 'Title';
    if (raw === raw.toLowerCase()) return 'lower';
    return 'mixed';
  }

  function detectSuffix(w) {
    if (/[^aeiou]ies$/.test(w)) return 'ies';
    if (/(ses|xes|zes|ches|shes)$/.test(w)) return 'es';
    // -ous/-us/-is/-ss are not plural markers: 'previous' is not the plural
    // of 'previou'. Without this guard, previous->old inflects to 'olds'.
    if (/[^s]s$/.test(w) && !/(ous|us|is|ss)$/.test(w)) return 's';
    if (/ing$/.test(w)) return 'ing';
    if (/ed$/.test(w)) return 'ed';
    if (/est$/.test(w)) return 'est';
    if (/ly$/.test(w)) return 'ly';
    return null;
  }

  function destem(w, suffix) {
    if (!suffix) return w;
    if (suffix === 'ies') return w.slice(0, -3) + 'y';
    if (suffix === 'es')  return w.slice(0, -2);
    if (suffix === 's')   return w.slice(0, -1);
    if (suffix === 'ing') return w.slice(0, -3);
    if (suffix === 'ed')  return w.slice(0, -2);
    if (suffix === 'est') return w.slice(0, -3);
    if (suffix === 'ly')  return w.slice(0, -2);
    return w;
  }

  function mkToken(raw, start, type) {
    var text = type === 'word' ? raw.toLowerCase() : raw;
    var suffix = type === 'word' ? detectSuffix(text) : null;
    return {
      raw: raw, text: text, start: start, end: start + raw.length, type: type,
      caps: type === 'word' ? detectCaps(raw) : 'lower',
      suffix: suffix,
      stem: type === 'word' ? destem(text, suffix) : text,
      isStopword: type === 'word' ? !!STOPWORDS[text] : false,
      isCopula: !!COPULA[text],
      isModal: !!MODAL[text],
      isAux: !!AUX[text],
      isNegation: !!NEG[text] || /n['’]t$/.test(text),
      isSentenceInitial: false,
      isCandidate: false
    };
  }

  function tokenize(text) {
    var tokens = [], m, last = 0;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) tokens.push(mkToken(text.slice(last, m.index), last, 'punct'));
      var raw = m[0];
      var type = m[1] ? 'word' : (m[2] ? 'space' : 'punct');
      tokens.push(mkToken(raw, m.index, type));
      last = m.index + raw.length;
    }
    if (last < text.length) tokens.push(mkToken(text.slice(last), last, 'punct'));

    var seenWord = false;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type !== 'word') continue;
      if (!seenWord) { t.isSentenceInitial = true; seenWord = true; }
      t.isCandidate = !t.isStopword && t.text.length >= 3 && !/\d/.test(t.text);
    }
    return tokens;
  }

  /* ------------------------------------------------------------------ *
   * Inflection
   * ------------------------------------------------------------------ */

  var ACRONYMS = { ai: 'AI', llm: 'LLM', api: 'API', gpt: 'GPT', nsfw: 'NSFW', url: 'URL' };

  function applyCaps(text, caps) {
    if (!text) return text;
    if (ACRONYMS[text]) return ACRONYMS[text];   // "an unrestricted ai" -> "AI"
    if (caps === 'UPPER') return text.toUpperCase();
    if (caps === 'Title') return text.charAt(0).toUpperCase() + text.slice(1);
    return text;
  }

  function pluralize(w) {
    if (IRREGULAR_PLURAL[w]) return { text: IRREGULAR_PLURAL[w], confidence: 1.0 };
    if (/(s|x|z|ch|sh)$/.test(w)) return { text: w + 'es', confidence: 0.95 };
    if (/[^aeiou]y$/.test(w)) return { text: w.slice(0, -1) + 'ies', confidence: 0.95 };
    return { text: w + 's', confidence: 0.95 };
  }

  function pastTense(w) {
    if (IRREGULAR_PAST[w]) return { text: IRREGULAR_PAST[w], confidence: 1.0 };
    if (/e$/.test(w)) return { text: w + 'd', confidence: 0.9 };
    if (/[^aeiou]y$/.test(w)) return { text: w.slice(0, -1) + 'ied', confidence: 0.9 };
    if (/[^aeiouwxy][aeiou][^aeiouwxy]$/.test(w) && w.length <= 5) return { text: w + w.slice(-1) + 'ed', confidence: 0.7 };
    return { text: w + 'ed', confidence: 0.85 };
  }

  function gerund(w) {
    if (/ie$/.test(w)) return { text: w.slice(0, -2) + 'ying', confidence: 0.9 };
    if (/[^e]e$/.test(w)) return { text: w.slice(0, -1) + 'ing', confidence: 0.9 };
    if (/[^aeiouwxy][aeiou][^aeiouwxy]$/.test(w) && w.length <= 5) return { text: w + w.slice(-1) + 'ing', confidence: 0.7 };
    return { text: w + 'ing', confidence: 0.85 };
  }

  // Transfer the source token's inflection onto a candidate replacement.
  function inflectLike(candidate, token, ctxPos) {
    var words = candidate.split(' ');
    var head = words[words.length - 1];
    var suffix = token.suffix;
    var out = { text: candidate, confidence: 1.0, applied: 'none' };

    if (!suffix || suffix === 'est' || suffix === 'ly') return out;
    if (detectSuffix(head) === suffix) return out;

    // If the candidate already carries a DIFFERENT inflection, reject it rather
    // than try to strip and re-apply. De-inflecting English orthographically is
    // unreliable ("refuses" -> "refus" or "refuse"? "goes" -> "go" or "goe"?)
    // and every wrong guess ships a visibly broken word: "refusesing", "goed".
    // There are always other candidates, so refusing to guess costs almost
    // nothing while a mangled word discredits the whole result list.
    var headSuffix = detectSuffix(head);
    if (headSuffix && headSuffix !== suffix) {
      out.confidence = 0;          // dropped by the caller
      return out;
    }

    // Only nouns pluralise. Without this, "always" (trailing -s, adverb slot)
    // pluralised its replacement into "frequents".
    if ((suffix === 's' || suffix === 'es' || suffix === 'ies') && ctxPos && ctxPos !== 'n') return out;

    var r = null;
    if (suffix === 's' || suffix === 'es' || suffix === 'ies') {
      // a participle candidate can't take a plural -s ("advised" -> "adviseds")
      if (/(ed|ing)$/.test(head)) return out;
      r = pluralize(head); out.applied = 'plural';
    }
    else if (suffix === 'ed') { r = pastTense(head); out.applied = 'past'; }
    else if (suffix === 'ing') { r = gerund(head); out.applied = 'gerund'; }
    else return out;

    var srcIrregular = (suffix === 'ed' && IRREGULAR_PAST[token.stem]) ||
                       ((suffix === 's' || suffix === 'es' || suffix === 'ies') && IRREGULAR_PLURAL[token.stem]);
    var conf = r.confidence;
    if (srcIrregular && !IRREGULAR_PAST[head] && !IRREGULAR_PLURAL[head]) conf = Math.min(conf, 0.5);

    words[words.length - 1] = r.text;
    out.text = words.join(' ');
    out.confidence = conf;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Negation planner: "X" -> "not ANT(X)", never a bare antonym swap.
   * Conservative by design - returns null (skip) far more often than not,
   * because with 7 other relations available, skipping costs nothing while
   * emitting ungrammatical output costs user trust.
   * ------------------------------------------------------------------ */

  function planNegation(tokens, siteIndex) {
    var site = tokens[siteIndex];
    if (site.isSentenceInitial) return null;

    // Already negated in this clause? Refuse, to avoid double negation.
    for (var j = siteIndex; j >= 0; j--) {
      var t = tokens[j];
      if (t.type === 'punct' && /[,;:]/.test(t.raw)) break;
      if (t.type === 'word' && (t.text === 'and' || t.text === 'or' || t.text === 'but')) break;
      if (t.isNegation) return null;
    }

    // Scan left for an attachment point, crossing only function words.
    var crossed = 0, sawStopword = false;
    for (var i = siteIndex - 1; i >= 0 && crossed <= 4; i--) {
      var tk = tokens[i];
      if (tk.type === 'space') continue;
      if (tk.type === 'punct') break;
      crossed++;

      if (tk.isCopula) return { strategy: 'copula', auxTokenIndex: i, insertAfter: i, insert: 'not' };
      if (tk.isModal) {
        if (tk.text === 'can') return { strategy: 'modal', auxTokenIndex: i, replaceAux: 'cannot', insertAfter: -1, insert: '' };
        return { strategy: 'modal', auxTokenIndex: i, insertAfter: i, insert: 'not' };
      }
      if (tk.isAux) return { strategy: 'aux', auxTokenIndex: i, insertAfter: i, insert: 'not' };
      if (!tk.isStopword) break;
      sawStopword = true;
    }

    // do-support, only for a finite verb form with a plausible subject left of it
    if (sawStopword || crossed <= 2) {
      if (site.suffix === 's') return { strategy: 'doSupport', insertBefore: siteIndex, insert: 'does not', stripInflection: true };
      if (site.suffix === 'ed') return { strategy: 'doSupportPast', insertBefore: siteIndex, insert: 'did not', stripInflection: true };
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Contextual part-of-speech inference
   *
   * sp=<word>&md=p returns the union of a word's senses ("key" -> adj,n,v),
   * which is useless as a filter: every candidate matches something. But the
   * sentence itself disambiguates cheaply. In "give me a key", "key" follows a
   * determiner, so it is a noun here - which is enough to reject "significant"
   * and "fundamental" and keep "passkey".
   *
   * Deliberately narrow: it returns null unless a function word makes the
   * answer obvious. A wrong guess silently filters out good candidates, so
   * abstaining is much cheaper than guessing.
   * ------------------------------------------------------------------ */

  var DETERMINER = mkSet('a an the this that these those my your his her its our their some any each every no');
  var PREPOSITION = mkSet('of in on at by with from into onto upon about over under above below between among through during before after against within without across behind beyond near');
  var OBJECT_PRONOUN = mkSet('me him her us them it you');
  // Adverbs that do not end in -ly. Without these, "must always answer" reads
  // the modal rule and calls the slot a verb, so "always" accepts "frequent"
  // and produces "must frequent answer".
  var ADVERBS = mkSet('always never often sometimes rarely seldom usually ' +
                      'frequently occasionally immediately soon already ' +
                      'again once twice together forever anyway somehow ' +
                      'now then today tomorrow yesterday currently initially finally');

  function prevContentIndex(tokens, i) {
    for (var j = i - 1; j >= 0; j--) {
      if (tokens[j].type === 'space') continue;
      if (tokens[j].type === 'punct') return -1;
      return j;
    }
    return -1;
  }

  function nextContentIndex(tokens, i) {
    for (var j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === 'space') continue;
      if (tokens[j].type === 'punct') return -1;
      return j;
    }
    return -1;
  }

  // True when the token immediately left of `i` (skipping adjectives) is a
  // singular indefinite article, which a plural replacement cannot follow.
  function hasSingularArticle(tokens, i) {
    var hops = 0;
    for (var j = i - 1; j >= 0 && hops < 3; j--) {
      if (tokens[j].type === 'space') continue;
      if (tokens[j].type === 'punct') return false;
      hops++;
      if (tokens[j].text === 'a' || tokens[j].text === 'an') return true;
      if (!tokens[j].isStopword) return false;
    }
    return false;
  }

  function looksPlural(phrase) {
    var head = phrase.split(' ').pop();
    return detectSuffix(head) === 's' || detectSuffix(head) === 'es' || detectSuffix(head) === 'ies';
  }

  function inferPosInContext(tokens, i) {
    var self = tokens[i];

    // An adverb is an adverb wherever it sits; check before the positional
    // rules below, which would otherwise misread "must always ..." as a verb slot.
    if (ADVERBS[self.text] || self.suffix === 'ly') return 'adv';

    // scan left past adjectives/adverbs to the nearest function word
    var j = prevContentIndex(tokens, i), hops = 0;
    while (j >= 0 && hops < 3 && !tokens[j].isStopword) { j = prevContentIndex(tokens, j); hops++; }

    if (j >= 0) {
      var p = tokens[j];
      if (DETERMINER[p.text]) return 'n';          // "a key", "the hidden system"
      // a preposition usually introduces a noun, but an -ing/-ed word after
      // one is a gerund/participle - verbal. Calling it a noun let "refusing"
      // accept the noun "refusal", which inflection then mangled to
      // "refusaling".
      if (PREPOSITION[p.text]) return (self.suffix === 'ing' || self.suffix === 'ed') ? 'v' : 'n';
      if (p.text === 'to') return 'v';             // "to reveal"
      if (p.isModal || p.isAux) return 'v';        // "can help", "did reveal"
      if (p.isCopula) return 'adj';                // "was happy"
    }

    // imperative: first word of the sentence followed by an object pronoun or
    // determiner ("give me ...", "ignore all ...")
    if (self.isSentenceInitial) {
      var nx = nextContentIndex(tokens, i);
      if (nx >= 0 && (OBJECT_PRONOUN[tokens[nx].text] || DETERMINER[tokens[nx].text])) return 'v';
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Datamuse client: cache + coalescing + concurrency + graceful failure
   * ------------------------------------------------------------------ */

  var cache = {
    mem: new Map(),
    inflight: new Map(),
    ttlMs: 7 * 24 * 3600 * 1000,
    lsKey: 'p4_variations_cache_v1',
    maxEntries: 2000,
    cooldownUntil: 0,
    consecutiveErrors: 0,
    _dirty: false,
    _timer: null
  };

  cache.stats = function () {
    return { words: cache.mem.size, cooldownMs: Math.max(0, cache.cooldownUntil - Date.now()) };
  };

  cache.clear = function () {
    cache.mem.clear();
    cache.inflight.clear();
    cache.cooldownUntil = 0;
    cache.consecutiveErrors = 0;
    try { if (global.localStorage) global.localStorage.removeItem(cache.lsKey); } catch (e) {}
  };

  cache.load = function () {
    try {
      if (!global.localStorage) return;
      var raw = global.localStorage.getItem(cache.lsKey);
      if (!raw) return;
      var obj = JSON.parse(raw), now = Date.now(), n = 0;
      for (var k in obj) {
        if (obj[k] && now - obj[k].t < cache.ttlMs) { cache.mem.set(k, obj[k]); n++; }
        if (n >= cache.maxEntries) break;
      }
    } catch (e) { /* corrupt or blocked: never break the page */ }
  };

  cache.persist = function () {
    cache._dirty = true;
    if (cache._timer) return;
    cache._timer = setTimeout(function () {
      cache._timer = null;
      if (!cache._dirty) return;
      cache._dirty = false;
      try {
        if (!global.localStorage) return;
        var entries = Array.from(cache.mem.entries());
        entries.sort(function (a, b) { return b[1].t - a[1].t; });
        var obj = {};
        for (var i = 0; i < entries.length && i < cache.maxEntries; i++) obj[entries[i][0]] = entries[i][1];
        global.localStorage.setItem(cache.lsKey, JSON.stringify(obj));
      } catch (e) { /* quota exceeded: give up on persistence silently */ }
    }, 2000);
  };

  function buildUrl(param, value) {
    return API + '?' + encodeURIComponent(param) + '=' + encodeURIComponent(value) + '&max=20&md=pf';
  }

  // Fetch one (value, relation) pool. Never rejects: failures resolve to [].
  function fetchPool(value, relKey, ctx) {
    if (RELATIONS[relKey].local) {
      var hits = DOMAIN_SYNONYMS[value] || [];
      return Promise.resolve(hits.map(function (w, i) {
        return { w: w, s: 10000 - i * 100, tags: [] };
      }));
    }
    var key = value + '|' + relKey;
    var hit = cache.mem.get(key);
    if (hit && Date.now() - hit.t < cache.ttlMs) { ctx.stats.cacheHits++; return Promise.resolve(hit.r); }
    if (cache.inflight.has(key)) return cache.inflight.get(key);
    if (ctx.offline || Date.now() < cache.cooldownUntil || ctx.stats.apiCalls >= ctx.opts.maxApiCalls) {
      return Promise.resolve([]);
    }

    var url = buildUrl(RELATIONS[relKey].param, value);
    var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ac) ac.abort(); }, ctx.opts.requestTimeoutMs);

    ctx.stats.apiCalls++;
    var p = Promise.resolve(ctx.fetchImpl(url, ac ? { signal: ac.signal } : {}))
      .then(function (res) {
        clearTimeout(timer);
        if (res && res.status === 429) { cache.cooldownUntil = Date.now() + 60000; throw new Error('rate limited'); }
        if (!res || !res.ok) throw new Error('http');
        return res.json();
      })
      .then(function (data) {
        cache.consecutiveErrors = 0;
        var pool = (data || []).map(function (d) { return { w: d.word, s: d.score || 0, tags: d.tags || [] }; });
        cache.mem.set(key, { t: Date.now(), r: pool });
        cache.persist();
        cache.inflight.delete(key);
        return pool;
      })
      .catch(function () {
        clearTimeout(timer);
        ctx.stats.errors++;
        cache.consecutiveErrors++;
        if (cache.consecutiveErrors >= 3) cache.cooldownUntil = Date.now() + 60000;
        cache.inflight.delete(key);
        return [];
      });

    cache.inflight.set(key, p);
    return p;
  }

  function fetchSourceTags(word, ctx) {
    var key = word + '|__pos';
    var hit = cache.mem.get(key);
    if (hit && Date.now() - hit.t < cache.ttlMs) { ctx.stats.cacheHits++; return Promise.resolve(hit.r); }
    if (cache.inflight.has(key)) return cache.inflight.get(key);
    if (ctx.offline || ctx.stats.apiCalls >= ctx.opts.maxApiCalls) return Promise.resolve([]);
    ctx.stats.apiCalls++;
    var pending = Promise.resolve(ctx.fetchImpl(API + '?sp=' + encodeURIComponent(word) + '&md=p&max=1', {}))
      .then(function (r) { return (r && r.ok) ? r.json() : []; })
      .then(function (d) {
        var tags = (d && d[0]) ? posTagsOf(d[0]) : [];
        cache.mem.set(key, { t: Date.now(), r: tags });
        return tags;
      })
      .catch(function () { ctx.stats.errors++; return []; })
      .then(function (r) { cache.inflight.delete(key); return r; });
    cache.inflight.set(key, pending);
    return pending;
  }

  function pMapLimit(items, limit, fn) {
    return new Promise(function (resolve) {
      var out = new Array(items.length), next = 0, active = 0, done = 0;
      if (!items.length) return resolve(out);
      function pump() {
        while (active < limit && next < items.length) {
          var idx = next++;
          active++;
          Promise.resolve(fn(items[idx], idx)).then(function (v) {
            out[idx] = v; active--; done++;
            if (done === items.length) resolve(out); else pump();
          });
        }
      }
      pump();
    });
  }

  /* ------------------------------------------------------------------ *
   * Candidate filtering & scoring
   * ------------------------------------------------------------------ */

  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  function isMorphVariant(a, b) {
    if (a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 3) return levenshtein(a, b) <= 2;
    return false;
  }

  function posTagsOf(entry) {
    // Datamuse returns uppercase tags on sp= lookups ("N") and lowercase on
    // relation lookups ("n"). Normalise, or srcTags silently comes back empty
    // and both the POS filter and the polysemy penalty stop working.
    return (entry.tags || [])
      .map(function (t) { return String(t).toLowerCase(); })
      .filter(function (t) { return t === 'n' || t === 'v' || t === 'adj' || t === 'adv'; });
  }

  function freqOf(entry) {
    var tags = entry.tags || [];
    for (var i = 0; i < tags.length; i++) if (tags[i].indexOf('f:') === 0) return parseFloat(tags[i].slice(2));
    return null;
  }

  function scoreCandidate(entry, rank, poolSize, token, srcTags, relKey, inflection, ctxPos) {
    var rel = RELATIONS[relKey];
    var rankScore = 1 - (rank / Math.max(1, poolSize)) * 0.5;

    var cTags = posTagsOf(entry);
    var posBonus = 1.0;
    if (srcTags.length && cTags.length) {
      posBonus = cTags.some(function (t) { return srcTags.indexOf(t) !== -1; }) ? 1.0 : 0.15;
    } else if (!cTags.length) {
      posBonus = 0.55;
    }

    // Datamuse lists a word's POS tags in dominance order, so tag[0] is the
    // sense you get if you read the word cold. A candidate whose DOMINANT
    // sense matches the slot ("cardinal" -> n,adj in a noun slot) is a far
    // better substitution than one that merely has that sense available
    // ("significant" -> adj,n). Plain membership cannot tell these apart,
    // because almost every English word nominalises.
    if (ctxPos && cTags.length) {
      if (cTags[0] === ctxPos) posBonus *= 1.35;
      else if (cTags.indexOf(ctxPos) !== -1) posBonus *= 0.45;
    }

    var f = freqOf(entry), freqBonus = 1.0;
    if (f !== null) freqBonus = (f < 0.5) ? 0.75 : (f > 500 ? 0.9 : 1.0);

    var nWords = entry.w.split(' ').length;
    var multi = nWords === 1 ? 1.0 : (nWords === 2 ? 0.6 : 0.4);

    // NOTE: no polysemy term here on purpose. It used to multiply every
    // candidate of a multi-sense word by a constant, which does not rank that
    // word's senses against each other - it only pushes the whole word down
    // relative to less ambiguous words in the same sentence. The result was
    // that "key" (adj,n,v) never got varied while "give" (v,n) did. Polysemy
    // is surfaced as a flag on the variation instead.
    return rel.weight * rankScore * posBonus * freqBonus * multi *
           (inflection ? inflection.confidence : 1);
  }

  /* ------------------------------------------------------------------ *
   * Edit application
   * ------------------------------------------------------------------ */

  function applyEdits(tokens, edits) {
    var repl = Object.create(null), skip = Object.create(null),
        insertAfter = Object.create(null), replaceTok = Object.create(null);

    edits.forEach(function (e) {
      repl[e.tokenIndex] = e.replacement;
      if (e.spanEnd != null) {
        for (var i = e.tokenIndex + 1; i <= e.spanEnd; i++) skip[i] = true;
      }
      var n = e.negation;
      if (!n) return;
      if (n.replaceAux != null) replaceTok[n.auxTokenIndex] = n.replaceAux;
      else if (n.insertBefore != null) repl[e.tokenIndex] = n.insert + ' ' + e.replacement;
      else if (n.insertAfter >= 0) insertAfter[n.insertAfter] = n.insert;
    });

    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      if (skip[i]) continue;
      if (replaceTok[i] != null) out.push(applyCaps(replaceTok[i], tokens[i].caps));
      else if (repl[i] != null) out.push(repl[i]);
      else out.push(tokens[i].raw);
      if (insertAfter[i] != null) out.push(' ' + insertAfter[i]);
    }

    // Fix the indefinite article against whatever now follows it, or a swap
    // leaves "an freed assistant" / "a unrestricted assistant".
    for (i = 0; i < out.length; i++) {
      var w = out[i];
      if (!/^(a|an|A|An)$/.test(w)) continue;
      var nxt = null;
      for (var k = i + 1; k < out.length; k++) {
        var m = /[A-Za-z]/.exec(out[k]);
        if (m) { nxt = out[k].slice(out[k].search(/[A-Za-z]/)); break; }
      }
      if (!nxt) continue;
      var wantAn = /^[aeiou]/i.test(nxt);
      var fixed = wantAn ? 'an' : 'a';
      out[i] = (w[0] === w[0].toUpperCase()) ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed;
    }
    return out.join('');
  }

  /* ------------------------------------------------------------------ *
   * Site / bigram selection
   * ------------------------------------------------------------------ */

  function stratifiedPick(candidates, tokens, maxSites) {
    if (candidates.length <= maxSites) return candidates.slice();
    var per = Math.ceil(candidates.length / maxSites), picked = [];
    for (var b = 0; b < maxSites; b++) {
      var slice = candidates.slice(b * per, (b + 1) * per);
      if (!slice.length) continue;
      slice.sort(function (x, y) { return tokens[y].text.length - tokens[x].text.length; });
      picked.push(slice[0]);
    }
    return picked.sort(function (a, b) { return a - b; });
  }

  // Adjacent content-word pairs, used for ml= word-sense disambiguation.
  function detectBigrams(tokens, sites) {
    var out = [], siteSet = Object.create(null);
    sites.forEach(function (s) { siteSet[s] = true; });
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'word' || tokens[i].isStopword) continue;
      var j = i + 1;
      while (j < tokens.length && tokens[j].type === 'space') j++;
      if (j >= tokens.length || tokens[j].type !== 'word' || tokens[j].isStopword) continue;
      if (!siteSet[i] && !siteSet[j]) continue;
      out.push({
        startIndex: i, endIndex: j,
        phrase: tokens[i].text + ' ' + tokens[j].text,
        aStem: tokens[i].stem, bStem: tokens[j].stem,
        pool: []
      });
      i = j;
    }
    return out.slice(0, 4);
  }

  /* ------------------------------------------------------------------ *
   * Variation construction
   * ------------------------------------------------------------------ */

  var SINGLES_PER_MULTI = 3;   // ~25% multi-word edits, stable across counts

  var EDIT_DIST = {
    conservative: [1],
    balanced:     [1, 1, 1, 2, 2],
    aggressive:   [1, 2, 2, 2, 3, 3]
  };

  function buildVariations(tokens, sites, poolsBySite, srcTagsBySite, bigrams, relations, opts, rng, result, phraseSpans) {
    phraseSpans = phraseSpans || [];
    var editsBySite = Object.create(null);
    var seen = Object.create(null);
    var variations = [];
    var currentTier = 0;
    var originalNorm = normalizeText(result.original);

    sites.forEach(function (s) {
      var token = tokens[s];
      var srcTags = srcTagsBySite[s] || [];
      // The sentence is a better disambiguator than the dictionary union.
      var ctxPos = inferPosInContext(tokens, s);
      var list = [];

      relations.forEach(function (relKey) {
        var pool = (poolsBySite[s] || {})[relKey] || [];
        var rel = RELATIONS[relKey];
        var negPlan = null;
        if (rel.negate) {
          negPlan = planNegation(tokens, s);
          if (!negPlan) return;
        }

        pool.forEach(function (entry, rank) {
          var cand = String(entry.w || '').toLowerCase();
          if (!cand) return;
          if (cand === token.text || cand === token.stem) return;
          if (isMorphVariant(cand, token.text)) return;
          if (cand.split(' ').length > 3) return;
          // "the french", "a lock" etc. are dictionary glosses, not drop-in
          // replacements - substituting one yields "to The french".
          if (/^(the|a|an) /.test(cand)) return;

          var cTags = posTagsOf(entry);
          // Prefer the context-inferred POS over the dictionary union: for
          // "give me a key", ctxPos is 'n', which drops "significant" and
          // "fundamental" and lets "passkey" through. Fall back to the union
          // only when context was inconclusive.
          if (opts.posFilter && cTags.length) {
            if (ctxPos) {
              if (cTags.indexOf(ctxPos) === -1) return;
            } else if (srcTags.length &&
                       !cTags.some(function (t) { return srcTags.indexOf(t) !== -1; })) {
              return;
            }
          }

          var infl = (negPlan && negPlan.stripInflection)
            ? { text: destem(cand, token.suffix), confidence: 0.9, applied: 'stripped' }
            : inflectLike(cand, token, ctxPos);

          if (infl.confidence === 0) return;   // conflicting inflection, see inflectLike
          if (hasSingularArticle(tokens, s) && looksPlural(infl.text)) return;

          var score = scoreCandidate(entry, rank, pool.length, token,
                                     ctxPos ? [ctxPos] : srcTags, relKey, infl, ctxPos);

          var flags = [];
          if (rel.negate) flags.push('grammarHeuristic');
          if (rel.drift) flags.push('meaningDrift');
          if (rel.noisy) flags.push('noisy');
          if (infl.confidence < 0.7) flags.push('inflectionGuess');
          // ctxPos resolves the part of speech, not the sense - "bank" is
          // still ambiguous between money and river once you know it is a
          // noun - so this warning stands either way.
          if (srcTags.length >= 2) flags.push('polysemous');

          list.push({
            tokenIndex: s, spanEnd: null, original: token.raw, rawCandidate: entry.w,
            replacement: applyCaps(infl.text, token.caps),
            relation: relKey, datamuseScore: entry.s, score: score,
            inflection: infl, negation: negPlan, flags: flags
          });
        });
      });

      list.sort(function (a, b) { return b.score - a.score; });
      editsBySite[s] = list;
    });

    // Bigram (WSD) phrase-level edits.
    // These are means-like lookups, so they must honour that checkbox - they
    // used to be emitted regardless of which relations the user enabled.
    var bigramEdits = [];
    if (relations.indexOf('meansLike') !== -1) bigrams.forEach(function (bg) {
      var collapsed = bg.phrase.replace(/ /g, '');
      (bg.pool || []).slice(0, 6).forEach(function (entry, rank) {
        var cand = String(entry.w || '').toLowerCase();
        // also reject a candidate that is merely one half of the source pair
        if (!cand || cand === bg.phrase || cand === collapsed) return;
        if (cand === tokens[bg.startIndex].text || cand === tokens[bg.endIndex].text) return;
        if (cand.split(' ').length > 3) return;
        // ml=<bigram> only disambiguates LEXICALIZED compounds. "river bank"
        // -> riverbank/riverside/river bed (all share a stem with the source).
        // A non-compound like "previous instructions" returns loosely related
        // junk ("play", "inoperative") that destroys the sentence. Requiring a
        // shared stem keeps the real WSD wins and drops the noise.
        if (!sharesStem(cand, bg.aStem, bg.bStem)) return;
        bigramEdits.push({
          tokenIndex: bg.startIndex, spanEnd: bg.endIndex,
          original: tokens[bg.startIndex].raw + ' ' + tokens[bg.endIndex].raw,
          rawCandidate: entry.w,
          replacement: applyCaps(cand, tokens[bg.startIndex].caps),
          relation: 'meansLike', datamuseScore: entry.s,
          // A lexicalized-compound match is the strongest disambiguation signal
          // available, so it outranks single-word swaps on a polysemous head.
          score: 1.15 * (1 - rank / 10),
          inflection: { confidence: 1, applied: 'none' },
          negation: null, flags: ['wsdPhrase']
        });
      });
    });

    // Whole-phrase substitutions for protected terms of art. The curated
    // lexicon leads; Datamuse's ml= fills in behind it. No shared-stem guard
    // here (unlike the bigram WSD path) because replacing the entire term is
    // exactly the intent, not a sense-disambiguation gamble.
    var phraseEdits = [];
    phraseSpans.forEach(function (sp) {
      var curated = DOMAIN_SYNONYMS[sp.phrase] || [];
      // Only fall back to the API when nothing is curated, and keep the
      // shared-stem guard on that path: ml=<phrase> on a non-lexicalized term
      // returns unrelated junk ("previous instructions" -> "play"), which is
      // exactly what protecting the term was meant to prevent. Every phrase in
      // PROTECTED_PHRASES currently has a curated entry, so this is a safety
      // net for ones added later.
      var fromApi = curated.length ? [] : (sp.pool || [])
        .map(function (e) { return e.w; })
        .filter(function (w) {
          var parts = sp.phrase.split(' ');
          return sharesStem(String(w).toLowerCase(), parts[0], parts[parts.length - 1]);
        });
      var seenPhrase = Object.create(null);
      // curated entries are the 'domain' relation, API ones are 'meansLike';
      // respect whichever the user actually enabled
      var domainOn = relations.indexOf('domain') !== -1;
      var mlOn = relations.indexOf('meansLike') !== -1;
      curated.concat(fromApi).forEach(function (cand, rank) {
        var low = String(cand || '').toLowerCase();
        if (!low || low === sp.phrase || seenPhrase[low]) return;
        if (low.split(' ').length > 4) return;
        // "give me a system prompt" -> "a initial instructions" is ungrammatical
        // in number, not just in the article. Skip rather than emit it.
        if (hasSingularArticle(tokens, sp.startIndex) && looksPlural(low)) return;
        seenPhrase[low] = true;
        var isCurated = rank < curated.length;
        if (isCurated ? !domainOn : !mlOn) return;
        phraseEdits.push({
          tokenIndex: sp.startIndex, spanEnd: sp.endIndex,
          original: sp.phrase, rawCandidate: cand,
          replacement: applyCaps(cand, tokens[sp.startIndex].caps),
          relation: isCurated ? 'domain' : 'meansLike',
          datamuseScore: 0,
          score: (isCurated ? 1.30 : 0.80) * (1 - rank / 12),
          inflection: { confidence: 1, applied: 'none' },
          negation: null, flags: ['termOfArt']
        });
      });
    });

    function emit(edits) {
      if (!edits.length) return false;
      var text = applyEdits(tokens, edits);
      var norm = normalizeText(text);
      if (!norm || norm === originalNorm || seen[norm]) return false;
      seen[norm] = true;

      var rels = [], flags = [], sc = 0;
      edits.forEach(function (e) {
        if (rels.indexOf(e.relation) === -1) rels.push(e.relation);
        e.flags.forEach(function (f) { if (flags.indexOf(f) === -1) flags.push(f); });
        sc += e.score;
      });

      var avg = sc / edits.length;
      variations.push({
        id: 'v' + variations.length, text: text, edits: edits.slice(),
        relations: rels, flags: flags, score: avg, rerank: null,
        finalScore: avg, fingerprint: norm, tier: currentTier
      });
      return true;
    }

    // Phase A: deterministic minimal pairs (exactly one edit each).
    // For red-teaming these are the most diagnostically useful outputs - a
    // minimal pair isolates exactly which token a classifier keyed on.
    currentTier = -1;                                  // strongest signal, always first
    bigramEdits.forEach(function (e) { emit([e]); });
    phraseEdits.forEach(function (e) { emit([e]); });

    // Each site gets an "offer list": its relations interleaved, so a site
    // contributes its best synonym, then its best means-like, ... and only
    // then its SECOND synonym. Without the interleave one productive relation
    // buries the rest; without the depth we only ever saw one candidate per
    // relation and never reached, say, "passkey" for "key".
    var offersBySite = Object.create(null);
    sites.forEach(function (s) {
      var byRel = Object.create(null);
      (editsBySite[s] || []).forEach(function (e) {
        (byRel[e.relation] = byRel[e.relation] || []).push(e);
      });
      var queues = relations.map(function (r) { return byRel[r] || []; });
      var offers = [], depth = 0, added = true;
      while (added && depth < 6) {
        added = false;
        for (var qi = 0; qi < queues.length; qi++) {
          if (queues[qi][depth]) { offers.push(queues[qi][depth]); added = true; }
        }
        depth++;
      }
      offersBySite[s] = offers;
    });

    // Round-robin across sites so every content word is varied a comparable
    // number of times. A plain global score sort let the highest-scoring word
    // monopolise the output (7 edits for "system", 2 for "instructions").
    var cursor = 0, exhausted = false;
    currentTier = 0;
    // leave headroom: the multi-edit phase below needs room in the budget or
    // the output is 100% single-word swaps
    while (!exhausted && variations.length < opts.count * 2) {
      exhausted = true;
      for (var si = 0; si < sites.length; si++) {
        var offers = offersBySite[sites[si]];
        if (cursor < offers.length) { emit([offers[cursor]]); exhausted = false; }
      }
      cursor++;
      currentTier = cursor;
    }

    // Phase B: sampled multi-edit, for volume and diversity.
    currentTier = 3;           // blended in after the first few single-word rounds
    var target = opts.count * 3;
    var dist = EDIT_DIST[opts.aggressiveness] || EDIT_DIST.balanced;
    // was floor(sites/2), which needed 4+ content words before it would ever
    // produce a 2-word edit - so "give me a key" could only ever emit
    // single-word variations.
    var maxEdits = Math.min(opts.maxEditsPerVariation, Math.max(1, sites.length + phraseSpans.length));
    var usable = sites.filter(function (s) { return (editsBySite[s] || []).length; });

    // Phrase and bigram swaps are edit sources too. Key them by their start
    // index so the sampler treats them like any other site; without this a
    // multi-edit variation could never include a term-of-art substitution.
    var spanEditsByStart = Object.create(null);
    bigramEdits.concat(phraseEdits).forEach(function (e) {
      (spanEditsByStart[e.tokenIndex] = spanEditsByStart[e.tokenIndex] || []).push(e);
    });
    Object.keys(spanEditsByStart).forEach(function (k) {
      var idx = parseInt(k, 10);
      if (usable.indexOf(idx) === -1) usable.push(idx);
    });
    usable.sort(function (a, b) { return a - b; });

    function editsAt(i) { return editsBySite[i] || spanEditsByStart[i] || []; }

    var usage = Object.create(null);

    for (var attempt = 0; attempt < opts.count * 15 && variations.length < target; attempt++) {
      var k = Math.min(maxEdits, dist[Math.floor(rng() * dist.length)]);
      if (k < 2 || usable.length < 2) continue;
      if (!editsAt(usable[0]).length) continue;

      var chosen = sampleWithoutReplacement(usable, k, rng);
      if (chosen.length < 2) continue;

      var edits = [];
      chosen.forEach(function (s) {
        var list = editsAt(s);
        var idx = pickWeightedIndex(list.length, rng, usage, s);
        edits.push(list[idx]);
        var uk = s + ':' + idx;
        usage[uk] = (usage[uk] || 1) * 0.6;   // decay pushes sampler toward unused
      });

      edits.sort(function (a, b) { return a.tokenIndex - b.tokenIndex; });

      var ok = true;
      for (var i = 1; i < edits.length; i++) {
        var prevEnd = edits[i - 1].spanEnd != null ? edits[i - 1].spanEnd : edits[i - 1].tokenIndex;
        if (edits[i].tokenIndex <= prevEnd) { ok = false; break; }
      }
      if (ok) emit(edits);
    }

    variations.sort(function (a, b) {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return b.finalScore - a.finalScore;
    });

    // Interleave single-word and multi-word edits at a fixed ratio instead of
    // letting tier ordering decide. Ordering by tier alone made the mix depend
    // on how many results were requested: 0% multi-edit at count=6, 68% at
    // count=40. Minimal pairs still lead (they isolate which token mattered),
    // but every request now gets some multi-word variety.
    var singles = [], multis = [];
    variations.forEach(function (v) { (v.edits.length > 1 ? multis : singles).push(v); });

    var merged = [], si = 0, mi = 0;
    while (si < singles.length || mi < multis.length) {
      for (var n = 0; n < SINGLES_PER_MULTI && si < singles.length; n++) merged.push(singles[si++]);
      if (mi < multis.length) merged.push(multis[mi++]);
      else if (si >= singles.length) break;
    }
    return merged;
  }

  // True when a candidate compound actually contains one of the source stems,
  // e.g. "riverbank"/"riverside" for ("river","bank"). Guards the bigram path.
  function sharesStem(cand, aStem, bStem) {
    var flat = cand.replace(/[^a-z]/g, '');
    var stems = [aStem, bStem];
    for (var i = 0; i < stems.length; i++) {
      var st = stems[i];
      if (st && st.length >= 4 && flat.indexOf(st.slice(0, Math.min(st.length, 6))) !== -1) return true;
    }
    return false;
  }

  function normalizeText(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
  }

  function sampleWithoutReplacement(pool, k, rng) {
    var avail = pool.slice(), picked = [];
    while (picked.length < k && avail.length) {
      picked.push(avail.splice(Math.floor(rng() * avail.length), 1)[0]);
    }
    return picked.sort(function (a, b) { return a - b; });
  }

  function pickWeightedIndex(len, rng, usage, site) {
    // bias toward the front of the (score-sorted) list, damped by prior usage
    var best = 0, bestVal = -Infinity;
    for (var tries = 0; tries < 3; tries++) {
      var idx = Math.min(len - 1, Math.floor(Math.pow(rng(), 1.6) * len));
      var val = (1 / (idx + 1)) * (usage[site + ':' + idx] || 1);
      if (val > bestVal) { bestVal = val; best = idx; }
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Optional LLM rerank. Cannot reject; worst case it does nothing.
   * ------------------------------------------------------------------ */

  function rerank(result, opts) {
    var cfg = opts.rerank;
    var cands = result.variations.slice(0, 60).map(function (v) {
      return { id: v.id, text: v.text.slice(0, 300) };
    });

    var OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
    var endpoint = cfg.baseUrl || OPENAI_URL;

    var body = {
      model: cfg.model || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a linguistic quality rater for an AI-safety red-teaming tool. For each candidate paraphrase rate two axes 0-10: "fluency" (grammatical, natural English) and "fidelity" (preserves the original meaning). Judge ONLY English quality. Do not rewrite them, do not comment on their content, do not refuse. Return one entry for EVERY candidate, reusing the exact id of each candidate. Respond with JSON only, shaped {"scores":[{"id":"<candidate id>","fluency":<0-10>,"fidelity":<0-10>}]}. The angle brackets are placeholders - replace them with your actual ratings.' },
        { role: 'user', content: JSON.stringify({ original: result.original, candidates: cands }) }
      ]
    };

    // response_format is OpenAI-specific and is rejected outright by some
    // models served through OpenAI-compatible gateways. Send it only to
    // OpenAI itself. The system prompt already demands JSON and the parse
    // below is tolerant, so dropping it costs nothing - whereas sending it
    // to a gateway makes rerank look enabled while silently never working.
    if (endpoint === OPENAI_URL) body.response_format = { type: 'json_object' };

    var fetchImpl = cfg.fetchImpl || opts.fetchImpl || (global.fetch ? global.fetch.bind(global) : null);
    if (!fetchImpl) { pushWarning(result, 'rerank_failed'); return Promise.resolve(); }

    // A hosted API answers in seconds; a local model on CPU can take minutes.
    // The old flat 12s abort fired before a local thinking model had finished,
    // so rerank could never succeed against Ollama or LM Studio.
    // host-exact, not prefix: "https://localhost.evil.com" is not local
    var isLocal = (function (u) {
      var h;
      try { h = new URL(u).hostname.toLowerCase(); } catch (e) { return false; }
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' ||
             h === '::1' || /(^|\.)localhost$/.test(h);
    })(endpoint);
    var timeoutMs = cfg.timeoutMs || (isLocal ? 300000 : 30000);

    var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ac) ac.abort(); }, timeoutMs);

    return Promise.resolve(fetchImpl(endpoint, {
      method: 'POST',
      headers: cfg.apiKey
        ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey }
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac ? ac.signal : undefined
    }))
      .then(function (r) { clearTimeout(timer); if (!r || !r.ok) throw new Error('http'); return r.json(); })
      .then(function (d) {
        var msg = (d && d.choices && d.choices[0] && d.choices[0].message) || {};
        var parsed = extractScores(msg.content, msg.reasoning);
        if (!parsed || !Array.isArray(parsed.scores)) throw new Error('shape');
        var byId = Object.create(null);
        parsed.scores.forEach(function (s) { byId[s.id] = s; });
        result.variations.forEach(function (v) {
          var s = byId[v.id];
          if (!s) return;
          var fl = +s.fluency || 0, fi = +s.fidelity || 0;
          var combined = (0.6 * fl + 0.4 * fi) / 10;
          v.rerank = { fluency: fl, fidelity: fi, combined: combined };
          v.finalScore = 0.55 * v.score + 0.45 * combined;
        });
        result.variations.sort(function (a, b) { return b.finalScore - a.finalScore; });
      })
      .catch(function () {
        clearTimeout(timer);
        pushWarning(result, 'rerank_failed');
      });
  }

  // Pull the scores object out of a model response.
  //
  // Reasoning models do not behave like the hosted chat APIs this was written
  // against: qwen3 via Ollama returns its thinking in a separate `reasoning`
  // field and leaves `content` empty when it runs out of budget, and others
  // wrap it inline in <think>...</think> or wrap the JSON in prose or a code
  // fence. A bare JSON.parse of `content` fails on every one of those, and
  // because rerank fails silently by design, it would look enabled and simply
  // never work.
  function extractScores(content, reasoning) {
    var sources = [content, reasoning];
    for (var i = 0; i < sources.length; i++) {
      var text = sources[i];
      if (!text || typeof text !== 'string') continue;

      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')      // inline reasoning
                 .replace(/```(?:json)?/gi, '')                   // code fences
                 .trim();
      if (!text) continue;

      try {
        var direct = JSON.parse(text);
        if (direct && Array.isArray(direct.scores)) return direct;
      } catch (e) { /* fall through to a substring scan */ }

      // Last resort: salvage the numbers without trusting the structure.
      //
      // Small local models routinely emit the right information in broken
      // JSON. llama3.2:1b deterministically produces
      //     {"scores":[{"id":"v0",{"fluency":9,"fidelity":8}], ...
      // - a nested object where a key belongs, plus a stray bracket. Every
      // score is present and correct; only the syntax is wrong. Refusing that
      // would mean rerank never works on small local models, so scrape the
      // id/fluency/fidelity triples directly.
      var salvaged = salvageScores(text);
      if (salvaged) return salvaged;

      // Find the first {...} that parses and carries scores.
      //
      // BOUNDED ON PURPOSE. This runs on whatever the configured endpoint
      // returns, and the naive nested scan is O(starts x ends) JSON.parse
      // calls: an input of 2000 '{' followed by 2000 '}' took 78 SECONDS and
      // froze the tab. A hostile or simply broken gateway could hang the page,
      // so cap both the text considered and the number of attempts.
      var MAX_SCAN = 65536;      // only the first 64KB is worth scanning
      var MAX_ATTEMPTS = 400;    // hard ceiling on parse attempts
      var scan = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
      var attempts = 0;

      var start = scan.indexOf('{');
      while (start !== -1 && attempts < MAX_ATTEMPTS) {
        var end = scan.lastIndexOf('}');
        while (end > start && attempts < MAX_ATTEMPTS) {
          attempts++;
          try {
            var obj = JSON.parse(scan.slice(start, end + 1));
            if (obj && Array.isArray(obj.scores)) return obj;
          } catch (e2) { /* try a shorter slice */ }
          end = scan.lastIndexOf('}', end - 1);
        }
        start = scan.indexOf('{', start + 1);
      }
    }
    return null;
  }

  // Pull "id" / "fluency" / "fidelity" triples out of malformed JSON, in order,
  // ignoring brackets entirely. Deliberately strict about proximity so it can't
  // stitch together fields from different entries.
  function salvageScores(text) {
    var re = /"id"\s*:\s*"([^"]{1,40})"[^}]{0,120}?"fluency"\s*:\s*(\d{1,3})[^}]{0,80}?"fidelity"\s*:\s*(\d{1,3})/g;
    var out = [], m;
    while ((m = re.exec(text)) !== null) {
      out.push({ id: m[1], fluency: +m[2], fidelity: +m[3] });
      if (out.length > 200) break;
    }
    return out.length ? { scores: out, salvaged: true } : null;
  }

  function pushWarning(result, w) {
    if (result.warnings.indexOf(w) === -1) result.warnings.push(w);
  }

  /* ------------------------------------------------------------------ *
   * Public: generate
   * ------------------------------------------------------------------ */

  var DEFAULTS = {
    count: 12,
    relations: null,
    aggressiveness: 'balanced',
    maxEditsPerVariation: 2,
    seed: null,
    posFilter: true,
    maxSites: 8,
    maxApiCalls: 88,   // 8 sites x 8 relations + POS lookups; lower starves low-weight relations
    concurrency: 4,
    requestTimeoutMs: 5000,
    totalTimeoutMs: 20000,
    useBigramWSD: true,
    signal: null,
    onProgress: null,
    fetchImpl: null,
    rerank: null
  };

  function generate(sentence, options) {
    var opts = {}, k;
    for (k in DEFAULTS) opts[k] = DEFAULTS[k];
    if (options) for (k in options) if (options[k] !== undefined) opts[k] = options[k];

    var relations = (opts.relations && opts.relations.length)
      ? opts.relations.filter(function (r) { return !!RELATIONS[r]; })
      : Object.keys(RELATIONS).filter(function (r) { return RELATIONS[r].defaultOn; });

    var fetchImpl = opts.fetchImpl || (global.fetch ? global.fetch.bind(global) : null);
    var offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || !fetchImpl;

    var result = {
      original: sentence,
      variations: [],
      requested: opts.count,
      produced: 0,
      aborted: false,
      degraded: offline,
      warnings: [],
      yieldByRelation: {},
      stats: { apiCalls: 0, cacheHits: 0, errors: 0, elapsedMs: 0, sites: 0 }
    };
    relations.forEach(function (r) { result.yieldByRelation[r] = 0; });

    if (!sentence || !String(sentence).trim()) return Promise.resolve(result);
    if (offline) pushWarning(result, 'offline_cache_only');

    var t0 = Date.now();
    var tokens = tokenize(String(sentence));
    var seedVal = opts.seed != null ? opts.seed : hashString(sentence + '|' + relations.join(','));
    var rng = mulberry32(typeof seedVal === 'string' ? hashString(seedVal) : seedVal);

    var ctx = {
      opts: opts,
      fetchImpl: fetchImpl || function () { return Promise.reject(new Error('no fetch')); },
      offline: offline,
      stats: result.stats
    };

    // Words inside a term of art are not independent substitution sites, but
    // the phrase itself IS one - otherwise protecting "system prompt" from
    // being half-substituted also makes it completely immutable, and an input
    // that is nothing but a protected phrase yields no results at all.
    var prot = protectedSpans(tokens);
    var phraseSpans = prot.spans;
    var candidates = [];
    tokens.forEach(function (t, i) { if (t.isCandidate && !prot.covered[i]) candidates.push(i); });
    var sites = stratifiedPick(candidates, tokens, opts.maxSites);
    result.stats.sites = sites.length + phraseSpans.length;
    if (!sites.length && !phraseSpans.length) {
      pushWarning(result, 'no_candidate_words');
      return Promise.resolve(result);
    }

    // ml=<bigram> genuinely disambiguates where rel_syn cannot:
    //   rel_syn=bank  -> cant, trust, money box          (wrong sense)
    //   ml=river bank -> riverbank, riverside, river bed (right sense)
    var bigrams = opts.useBigramWSD ? detectBigrams(tokens, sites) : [];

    var srcTagsBySite = Object.create(null);
    var poolsBySite = Object.create(null);
    sites.forEach(function (s) { poolsBySite[s] = {}; });

    var progressTotal = sites.length + sites.length * relations.length +
                        bigrams.length + phraseSpans.length;
    var progressDone = 0;
    function tick(phase) {
      progressDone++;
      if (opts.onProgress) {
        try { opts.onProgress({ phase: phase, done: progressDone, total: progressTotal }); } catch (e) {}
      }
    }

    var deadline = t0 + opts.totalTimeoutMs;
    function expired() { return Date.now() > deadline || (opts.signal && opts.signal.aborted); }

    return pMapLimit(sites, opts.concurrency, function (s) {
      if (expired()) return null;
      return fetchSourceTags(tokens[s].text, ctx).then(function (tags) {
        srcTagsBySite[s] = tags;
        tick('pos');
        return null;
      });
    })
      .then(function () {
        // Breadth-first over relations, not depth-first over sites: if the
        // API budget runs out we still have complete coverage of the best
        // relations rather than full coverage of two arbitrary words.
        var ordered = relations.slice().sort(function (a, b) { return RELATIONS[b].weight - RELATIONS[a].weight; });
        var jobs = [];
        ordered.forEach(function (rel) {
          sites.forEach(function (s) { jobs.push({ site: s, rel: rel }); });
        });
        return pMapLimit(jobs, opts.concurrency, function (job) {
          if (expired()) return null;
          return fetchPool(tokens[job.site].text, job.rel, ctx).then(function (pool) {
            poolsBySite[job.site][job.rel] = pool;
            tick('relations');
            return null;
          });
        });
      })
      .then(function () {
        var phraseJobs = bigrams.concat(phraseSpans);
        if (!phraseJobs.length) return null;
        return pMapLimit(phraseJobs, opts.concurrency, function (bg) {
          if (expired()) return null;
          return fetchPool(bg.phrase, 'meansLike', ctx).then(function (pool) {
            bg.pool = pool;
            tick('wsd');
            return null;
          });
        });
      })
      .then(function () {
        if (opts.signal && opts.signal.aborted) result.aborted = true;
        if (result.stats.errors > 0 || Date.now() < cache.cooldownUntil) result.degraded = true;

        var built = buildVariations(tokens, sites, poolsBySite, srcTagsBySite, bigrams, relations, opts, rng, result, phraseSpans);
        result.variations = built.slice(0, opts.count);
        result.produced = result.variations.length;

        // Count only what is actually returned. Counting everything generated
        // (up to 3x count, most of it discarded) made the on-screen yield
        // strip report numbers several times larger than the visible list.
        result.variations.forEach(function (v) {
          v.edits.forEach(function (e) {
            result.yieldByRelation[e.relation] = (result.yieldByRelation[e.relation] || 0) + 1;
          });
        });
        if (result.produced < opts.count) pushWarning(result, 'insufficient_candidates');
        result.stats.elapsedMs = Date.now() - t0;

        if (opts.rerank && (opts.rerank.apiKey || opts.rerank.baseUrl) && result.variations.length > 1) {
          return rerank(result, opts).then(function () { return result; });
        }
        return result;
      });
  }

  /* ------------------------------------------------------------------ */

  cache.load();

  global.sentenceVariations = {
    VERSION: '1.0.0',
    RELATIONS: RELATIONS,
    GROUP_LABELS: GROUP_LABELS,
    GROUP_ORDER: GROUP_ORDER,
    generate: generate,
    tokenize: tokenize,
    cache: cache,
    _internals: {
      hashString: hashString, mulberry32: mulberry32, detectSuffix: detectSuffix,
      destem: destem, inflectLike: inflectLike, planNegation: planNegation,
      applyEdits: applyEdits, applyCaps: applyCaps, levenshtein: levenshtein,
      isMorphVariant: isMorphVariant, stratifiedPick: stratifiedPick,
      detectBigrams: detectBigrams, inferPosInContext: inferPosInContext, protectedSpans: protectedSpans, buildUrl: buildUrl, pluralize: pluralize,
      pastTense: pastTense, gerund: gerund, pMapLimit: pMapLimit,
      normalizeText: normalizeText, sharesStem: sharesStem, extractScores: extractScores, salvageScores: salvageScores, scoreCandidate: scoreCandidate,
      posTagsOf: posTagsOf, freqOf: freqOf, buildVariations: buildVariations, DOMAIN_SYNONYMS: DOMAIN_SYNONYMS
    }
  };
})(typeof window !== 'undefined' ? window : this);
