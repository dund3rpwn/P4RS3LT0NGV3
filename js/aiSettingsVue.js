/*!
 * aiSettingsVue.js - Vue 2 mixin for the AI Settings tab.
 *
 * One home for provider, endpoint, key and model. Every AI feature in the app
 * reads from here instead of hiding its own key field.
 *
 * The API key deliberately binds to the app's existing `openaiApiKey` property
 * (localStorage 'openai_api_key'), which the Anti-Classifier tab already owns.
 * That keeps the two tabs in sync automatically and means this feature adds no
 * new key storage and requires no changes to the Anti-Classifier tab.
 *
 * Every provider here speaks the OpenAI chat-completions request shape, so
 * there is no per-provider request code: switching provider only changes a URL.
 * That reaches Claude, Gemini and Llama (via OpenRouter) plus local servers.
 *
 * Keys are namespaced `ai*` so they cannot collide with anything upstream adds.
 *
 * Part of a fork of P4RS3LT0NGV3 - AGPL-3.0.
 */
(function (global) {
  'use strict';

  var OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  var STORE_KEY = 'p4_ai_settings_v1';

  // Endpoint + suggested models only. Both fields stay editable in the UI,
  // because hardcoded model lists go stale - which is exactly how the app
  // ended up defaulting to 'gpt-4'.
  var PRESETS = {
    openai: {
      label: 'OpenAI',
      url: OPENAI_URL,
      models: ['gpt-4o-mini', 'gpt-4o'],
      keyHint: 'sk-...',
      help: 'https://platform.openai.com/api-keys',
      helpLabel: 'OpenAI Platform'
    },
    openrouter: {
      label: 'OpenRouter (Claude, Gemini, Llama...)',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      models: [
        'anthropic/claude-sonnet-5',
        'anthropic/claude-haiku-4-5',
        'google/gemini-2.0-flash-001',
        'meta-llama/llama-3.3-70b-instruct'
      ],
      keyHint: 'sk-or-...',
      help: 'https://openrouter.ai/keys',
      helpLabel: 'OpenRouter'
    },
    groq: {
      label: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      keyHint: 'gsk_...',
      help: 'https://console.groq.com/keys',
      helpLabel: 'Groq Console'
    },
    together: {
      label: 'Together AI',
      url: 'https://api.together.xyz/v1/chat/completions',
      models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
      keyHint: 'your Together key',
      help: 'https://api.together.xyz/settings/api-keys',
      helpLabel: 'Together AI'
    },
    local: {
      label: 'Local (Ollama / LM Studio)',
      url: 'http://localhost:11434/v1/chat/completions',
      // llama3.2 first on purpose: a reasoning model like qwen3 spends its
      // budget thinking before it answers, which on CPU can exceed the
      // request timeout entirely. Measured: qwen3:4b 600s+, llama3.2:3b 15s.
      models: ['llama3.2:3b', 'llama3.2', 'mistral', 'qwen3:4b'],
      keyHint: 'usually not required',
      keyOptional: true,
      help: 'https://ollama.com',
      helpLabel: 'Ollama',
      note: 'Serve this page over http://localhost so the browser allows a local endpoint ' +
            '(an https-hosted copy cannot reach it). Reasoning models such as qwen3 think ' +
            'before answering - on CPU that can exceed the 5-minute budget. Very small ' +
            'models (1B) answer fast but rate by position rather than by content, which ' +
            'looks like it is working and is not. 3B is the realistic floor; 7B or larger ' +
            'if the ordering actually matters. ' +
            'Ollama serves one request at a time.'
    },
    custom: {
      label: 'Custom endpoint...',
      url: '',
      models: [],
      keyHint: 'provider key',
      help: '',
      helpLabel: ''
    }
  };

  // True only when the URL's HOST is a loopback address.
  //
  // Prefix-matching the URL is wrong: "https://localhost.evil.com/" starts
  // with "https://localhost", so a registered domain would inherit local
  // treatment. Compare the parsed hostname exactly.
  function isLoopbackUrl(url) {
    if (!url) return false;
    var host;
    try { host = new URL(url).hostname.toLowerCase(); }
    catch (e) { return false; }
    return host === 'localhost' || host === '127.0.0.1' ||
           host === '[::1]' || host === '::1' ||
           /(^|\.)localhost$/.test(host);
  }

  global.aiSettingsVueMixin = {
    data: function () {
      return {
        aiProvider: 'openai',
        aiEndpoint: OPENAI_URL,
        aiModel: 'gpt-4o-mini',
        aiMaxTokens: 2000,
        aiTemperature: 0.7,
        aiTesting: false,
        aiTestResult: null,     // { ok, message }
        aiDiscovered: [],       // models reported by the endpoint itself
        aiDiscovering: false
      };
    },

    computed: {
      aiPresetList: function () {
        return Object.keys(PRESETS).map(function (k) {
          return { key: k, label: PRESETS[k].label };
        });
      },

      aiPreset: function () { return PRESETS[this.aiProvider] || PRESETS.custom; },

      aiKeyOptional: function () { return !!this.aiPreset.keyOptional; },

      aiIsLocal: function () {
        return isLoopbackUrl(this.aiEndpoint);
      },

      // Withhold the key from localhost: a local server never needs a hosted
      // provider's credential, so sending it only widens where it can leak.
      aiAuthHeaders: function () {
        var h = {};
        if (this.openaiApiKey && !this.aiIsLocal) h['Authorization'] = 'Bearer ' + this.openaiApiKey;
        return h;
      },

      // True when this page is served from a real origin rather than the
      // developer's machine - i.e. the GitHub Pages case. Keys typed into a
      // hosted copy live in that public origin's localStorage.
      aiPageIsHosted: function () {
        if (typeof location === 'undefined') return false;
        if (location.protocol === 'file:') return false;
        return !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
      },

      // A page on https cannot reach http://localhost - the browser blocks it
      // as mixed content, so the Local preset silently cannot work there.
      aiLocalUnreachable: function () {
        return this.aiIsLocal && typeof location !== 'undefined' && location.protocol === 'https:';
      },

      // Once the endpoint has told us what it serves, a typed name that is not
      // on the list is a request that will 404 at run time.
      aiModelUnknown: function () {
        return this.aiDiscovered.length > 0 && this.aiModel &&
               this.aiDiscovered.indexOf(this.aiModel) === -1;
      },

      aiIsConfigured: function () {
        var hasKey = !!(this.openaiApiKey && String(this.openaiApiKey).trim());
        return !!(this.aiEndpoint && (hasKey || this.aiKeyOptional));
      },

      // Shown on other tabs so a disabled AI feature can say why.
      aiSummary: function () {
        if (!this.aiIsConfigured) return 'Not configured';
        return this.aiPreset.label + ' · ' + (this.aiModel || 'default model');
      }
    },

    methods: {
      aiLoad: function () {
        try {
          if (!global.localStorage) return;
          var raw = global.localStorage.getItem(STORE_KEY);
          if (!raw) return;
          var cfg = JSON.parse(raw);
          if (cfg.provider && PRESETS[cfg.provider]) this.aiProvider = cfg.provider;
          if (cfg.endpoint) this.aiEndpoint = cfg.endpoint;
          if (cfg.model) this.aiModel = cfg.model;
          if (cfg.maxTokens) this.aiMaxTokens = cfg.maxTokens;
          if (typeof cfg.temperature === 'number') this.aiTemperature = cfg.temperature;
        } catch (e) { /* corrupt or blocked - fall back to defaults */ }
      },

      aiSave: function () {
        try {
          if (!global.localStorage) return;
          global.localStorage.setItem(STORE_KEY, JSON.stringify({
            provider: this.aiProvider,
            endpoint: this.aiEndpoint,
            model: this.aiModel,
            maxTokens: this.aiMaxTokens,
            temperature: this.aiTemperature
          }));
        } catch (e) { /* quota or private mode - settings just won't persist */ }
      },

      // Switching provider fills in that provider's endpoint and first model,
      // but never locks them - both inputs stay editable.
      aiSelectProvider: function () {
        var p = this.aiPreset;
        if (p.url) this.aiEndpoint = p.url;
        if (p.models && p.models.length) this.aiModel = p.models[0];
        this.aiDiscovered = [];
        this.aiTestResult = null;
        this.aiSave();
        this.aiFetchModels(true);     // quiet: a keyed provider will fail until a key is entered
      },

      aiEndpointChanged: function () {
        this.aiSave();
        this.aiDiscovered = [];
        this.aiFetchModels(true);
      },

      aiUseModel: function (m) { this.aiModel = m; this.aiSave(); },

      aiTestConnection: function () {
        var self = this;
        if (!this.aiEndpoint) {
          this.aiTestResult = { ok: false, message: 'Enter an endpoint URL first.' };
          return;
        }
        this.aiTesting = true;
        this.aiTestResult = null;

        var headers = { 'Content-Type': 'application/json' };
        var auth = this.aiAuthHeaders;
        for (var k in auth) headers[k] = auth[k];

        var isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(this.aiEndpoint);
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctl) ctl.abort(); }, isLocal ? 180000 : 15000);

        fetch(this.aiEndpoint, {
          method: 'POST',
          headers: headers,
          signal: ctl ? ctl.signal : undefined,
          body: JSON.stringify({
            model: this.aiModel,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1
          })
        })
          .then(function (res) {
            clearTimeout(timer);
            if (res.ok) {
              self.aiTestResult = { ok: true, message: 'Connected · ' + self.aiModel };
              return;
            }
            // Distinguishing these is the whole point of the button: a wrong
            // key and a wrong endpoint look identical without it.
            if (res.status === 401 || res.status === 403) {
              self.aiTestResult = { ok: false, message: 'Rejected (' + res.status + ') - the API key looks wrong or lacks access.' };
            } else if (res.status === 404) {
              self.aiTestResult = { ok: false, message: 'Not found (404) - check the endpoint URL and the model name.' };
            } else if (res.status === 429) {
              self.aiTestResult = { ok: false, message: 'Rate limited (429) - the key works, but you are over quota.' };
            } else {
              self.aiTestResult = { ok: false, message: 'Endpoint returned HTTP ' + res.status + '.' };
            }
          })
          .catch(function (err) {
            clearTimeout(timer);
            var aborted = err && err.name === 'AbortError';
            self.aiTestResult = {
              ok: false,
              message: aborted
                ? 'Timed out - the endpoint did not respond in time.'
                : 'Could not reach the endpoint. This is usually a wrong URL, no network, or the server refusing browser requests (CORS).'
            };
          })
          .then(function () { self.aiTesting = false; });
      },

      // Every OpenAI-compatible server exposes /v1/models, so the real model
      // list can be read from the endpoint instead of guessed. This is how a
      // local Ollama reports what is actually pulled, and it keeps the tool
      // useful as hosted model names change.
      aiFetchModels: function (quiet) {
        var self = this;
        if (!this.aiEndpoint) return;
        this.aiDiscovering = true;
        this.aiDiscovered = [];

        var url = this.aiEndpoint.replace(/\/chat\/completions\/?$/, '/models');

        fetch(url, { headers: this.aiAuthHeaders })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            var list = (d && d.data) || [];
            self.aiDiscovered = list.map(function (m) { return m.id; })
                                    .filter(Boolean).sort().slice(0, 40);
            if (!self.aiDiscovered.length && !quiet) {
              self.aiTestResult = { ok: false, message: 'The endpoint returned no model list.' };
            }
            // keep a discovered model selected rather than leaving a stale one
            if (self.aiDiscovered.length && self.aiDiscovered.indexOf(self.aiModel) === -1) {
              var preferred = (self.aiPreset.models || []).filter(function (m) {
                return self.aiDiscovered.indexOf(m) !== -1;
              })[0];
              self.aiModel = preferred || self.aiDiscovered[0];
              self.aiSave();
            }
          })
          .catch(function () {
            if (!quiet) self.aiTestResult = { ok: false, message: 'Could not read a model list from this endpoint.' };
          })
          .then(function () { self.aiDiscovering = false; });
      },

      aiGoToSettings: function () { this.switchToTab('aisettings'); }
    },

    mounted: function () {
      this.aiLoad();
      this.aiFetchModels(true);       // populate the model list for the saved endpoint
    }
  };
})(typeof window !== 'undefined' ? window : this);
