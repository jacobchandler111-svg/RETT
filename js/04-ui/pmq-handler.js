// FILE: js/04-ui/pmq-handler.js
// Pre-Meeting Questionnaire panel — two drop zones:
//
//   1. Tax Document Import (left)
//      Accepts W-2 / 1040 PDF or image. Sends to Gemini API
//      (google ai.google.dev) via REST, extracts structured tax
//      fields, and populates the matching Page-1 inputs.
//      API key stored in localStorage — never sent to any server
//      other than generativelanguage.googleapis.com.
//
//   2. Client Questionnaire (right)
//      Accepts the completed JSON questionnaire the client
//      filled out from the downloaded template. Maps each answer
//      one-for-one to the Page-1 inputs.
//
// Questionnaire questions are defined in PMQ_QUESTIONS below.
// Each entry declares: id, label, type, and targetField (the
// Page-1 input id it populates). Add questions here when ready.

(function (root) {
  'use strict';

  // ----------------------------------------------------------------
  // Questionnaire questions — one entry per question.
  // type: 'usd' | 'yesno' | 'text' | 'select'
  // targetField: id of the Page-1 input to populate on import.
  // ----------------------------------------------------------------
  var PMQ_QUESTIONS = [
    // Questions to be defined — add here.
    // Example shape (uncomment and fill in when ready):
    // { id: 'q_wages',       label: 'Estimated W-2 wages this year',    type: 'usd',    targetField: 'w2-wages' },
    // { id: 'q_filing',      label: 'Filing status',                     type: 'select', options: ['single','mFJ','mFS','HoH'], targetField: 'filing-status' },
  ];

  // Gemini model to use for document extraction.
  var GEMINI_MODEL  = 'gemini-2.0-flash';
  var GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                        GEMINI_MODEL + ':generateContent';

  // Prompt sent alongside the uploaded tax document.
  var TAX_EXTRACT_PROMPT = [
    'You are a tax-document parser. Extract the following fields from',
    'this W-2 or 1040 document and return ONLY valid JSON — no',
    'markdown, no prose — matching this exact schema:',
    '{',
    '  "filingStatus":            "single"|"mfj"|"mfs"|"hoh"|null,',
    '  "wages":                   number|null,',
    '  "federalTaxWithheld":      number|null,',
    '  "seIncome":                number|null,',
    '  "businessRevenue":         number|null,',
    '  "rentalIncome":            number|null,',
    '  "dividendIncome":          number|null,',
    '  "retirementDistributions": number|null,',
    '  "shortTermGain":           number|null,',
    '  "state":                   "two-letter state code"|null',
    '}',
    'Use null for any field not found in the document.',
    'All numeric values must be in whole dollars (no cents).',
  ].join('\n');

  // Map from Gemini JSON keys → Page-1 input ids.
  var TAX_FIELD_MAP = {
    filingStatus:            'filing-status',
    wages:                   'w2-wages',
    seIncome:                'se-income',
    businessRevenue:         'biz-revenue',
    rentalIncome:            'rental-income',
    dividendIncome:          'dividend-income',
    retirementDistributions: 'retirement-distributions',
    shortTermGain:           'short-term-gain',
    state:                   'state-code'
  };

  // ----------------------------------------------------------------
  // Utilities
  // ----------------------------------------------------------------
  var LS_KEY_GEMINI = 'rett_pmq_gemini_key';

  function _setInputValue(id, value) {
    var el = document.getElementById(id);
    if (!el || value == null) return;
    el.value = String(value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function _showStatus(hostId, type, msg) {
    var el = document.getElementById(hostId);
    if (!el) return;
    el.textContent = msg;
    el.className = 'pmq-status pmq-status-' + type;
    el.hidden = false;
  }

  function _clearStatus(hostId) {
    var el = document.getElementById(hostId);
    if (el) el.hidden = true;
  }

  function _setDropzoneState(dropEl, state) {
    dropEl.classList.remove('pmq-drop-active', 'pmq-drop-loading', 'pmq-drop-done', 'pmq-drop-error');
    if (state) dropEl.classList.add('pmq-drop-' + state);
  }

  function _fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload  = function (e) { resolve(e.target.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ----------------------------------------------------------------
  // Gemini API call
  // ----------------------------------------------------------------
  function _callGemini(apiKey, base64Data, mimeType) {
    var body = JSON.stringify({
      contents: [{
        parts: [
          { text: TAX_EXTRACT_PROMPT },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json' }
    });

    return fetch(GEMINI_ENDPOINT + '?key=' + encodeURIComponent(apiKey), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    body
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data.error) throw new Error(data.error.message || 'Gemini API error');
      var text = (data.candidates &&
                  data.candidates[0] &&
                  data.candidates[0].content &&
                  data.candidates[0].content.parts &&
                  data.candidates[0].content.parts[0].text) || '{}';
      return JSON.parse(text);
    });
  }

  // ----------------------------------------------------------------
  // Tax document handler
  // ----------------------------------------------------------------
  function _processTaxFile(file) {
    var dropEl    = document.getElementById('pmq-tax-drop');
    var statusId  = 'pmq-tax-status';
    var apiKey    = (document.getElementById('pmq-gemini-key') || {}).value || '';

    if (!apiKey) {
      _showStatus(statusId, 'error', 'Enter your Gemini API key first (get a free key at ai.google.dev).');
      return;
    }

    _setDropzoneState(dropEl, 'loading');
    _showStatus(statusId, 'info', 'Reading document with Gemini AI…');

    _fileToBase64(file).then(function (b64) {
      return _callGemini(apiKey, b64, file.type || 'application/pdf');
    }).then(function (fields) {
      var populated = [];
      Object.keys(TAX_FIELD_MAP).forEach(function (key) {
        if (fields[key] != null) {
          _setInputValue(TAX_FIELD_MAP[key], fields[key]);
          populated.push(key);
        }
      });
      _setDropzoneState(dropEl, 'done');
      var label = document.querySelector('#pmq-tax-drop .pmq-drop-label');
      if (label) label.textContent = '✓ ' + file.name;
      _showStatus(statusId, 'success',
        'Imported ' + populated.length + ' field' + (populated.length !== 1 ? 's' : '') +
        ' from ' + file.name + '. Review the values below before continuing.');
      // Persist key for next time (advisor convenience).
      try { localStorage.setItem(LS_KEY_GEMINI, apiKey); } catch (e) { /* */ }
    }).catch(function (err) {
      _setDropzoneState(dropEl, 'error');
      _showStatus(statusId, 'error', 'Gemini error: ' + (err.message || String(err)));
    });
  }

  // ----------------------------------------------------------------
  // Questionnaire file handler
  // ----------------------------------------------------------------
  function _processQuestionnaireFile(file) {
    var dropEl   = document.getElementById('pmq-questionnaire-drop');
    var statusId = 'pmq-questionnaire-status';

    _setDropzoneState(dropEl, 'loading');
    _showStatus(statusId, 'info', 'Reading questionnaire…');

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var answers = JSON.parse(e.target.result);
        var populated = 0;
        PMQ_QUESTIONS.forEach(function (q) {
          if (answers[q.id] != null && q.targetField) {
            _setInputValue(q.targetField, answers[q.id]);
            populated++;
          }
        });
        _setDropzoneState(dropEl, 'done');
        var label = document.querySelector('#pmq-questionnaire-drop .pmq-drop-label');
        if (label) label.textContent = '✓ ' + file.name;
        _showStatus(statusId, 'success',
          'Imported ' + populated + ' answer' + (populated !== 1 ? 's' : '') + ' from questionnaire.');
      } catch (err) {
        _setDropzoneState(dropEl, 'error');
        _showStatus(statusId, 'error', 'Could not parse questionnaire file: ' + (err.message || String(err)));
      }
    };
    reader.onerror = function () {
      _setDropzoneState(dropEl, 'error');
      _showStatus(statusId, 'error', 'File read failed.');
    };
    reader.readAsText(file);
  }

  // ----------------------------------------------------------------
  // Template download
  // ----------------------------------------------------------------
  function _downloadTemplate() {
    var template = {};
    PMQ_QUESTIONS.forEach(function (q) { template[q.id] = q.type === 'yesno' ? false : q.type === 'usd' ? 0 : ''; });
    var blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'brookhaven-questionnaire.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ----------------------------------------------------------------
  // Drag / drop + file input wiring
  // ----------------------------------------------------------------
  function _wireDropzone(dropId, fileInputId, handler) {
    var dropEl = document.getElementById(dropId);
    var fileEl = document.getElementById(fileInputId);
    if (!dropEl || !fileEl) return;

    ['dragenter','dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        _setDropzoneState(dropEl, 'active');
      });
    });
    ['dragleave','dragend'].forEach(function (ev) {
      dropEl.addEventListener(ev, function () {
        _setDropzoneState(dropEl, null);
      });
    });
    dropEl.addEventListener('drop', function (e) {
      e.preventDefault();
      _setDropzoneState(dropEl, null);
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handler(file);
    });
    // Clicking the dropzone triggers the hidden file input
    dropEl.addEventListener('click', function (e) {
      if (e.target.tagName === 'LABEL' || e.target.tagName === 'INPUT') return;
      fileEl.click();
    });
    fileEl.addEventListener('change', function () {
      if (fileEl.files && fileEl.files[0]) handler(fileEl.files[0]);
    });
  }

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------
  function _init() {
    _wireDropzone('pmq-tax-drop',          'pmq-tax-file',          _processTaxFile);
    _wireDropzone('pmq-questionnaire-drop','pmq-questionnaire-file', _processQuestionnaireFile);

    // Restore saved API key
    try {
      var saved = localStorage.getItem(LS_KEY_GEMINI);
      var keyEl = document.getElementById('pmq-gemini-key');
      if (saved && keyEl) keyEl.value = saved;
    } catch (e) { /* */ }

    // API key save-on-blur
    var keyEl = document.getElementById('pmq-gemini-key');
    if (keyEl) {
      keyEl.addEventListener('blur', function () {
        try { if (keyEl.value) localStorage.setItem(LS_KEY_GEMINI, keyEl.value); } catch (e) { /* */ }
      });
    }

    // Download template button
    var dlBtn = document.getElementById('pmq-download-btn');
    if (dlBtn) dlBtn.addEventListener('click', _downloadTemplate);

    // The PMQ used to be a collapsible <details> on Page 1; the
    // +/- glyph swap is no longer needed now that it's a dedicated
    // page.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  root.pmqProcessTaxFile           = _processTaxFile;
  root.pmqProcessQuestionnaireFile = _processQuestionnaireFile;
  root.PMQ_QUESTIONS               = PMQ_QUESTIONS;

})(window);
